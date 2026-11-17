import {DatabaseSync, backup as sqliteBackup} from "node:sqlite";
import {existsSync, readFileSync, unlinkSync, mkdirSync, chmodSync} from "node:fs";
import {join, resolve} from "node:path";

// Each domain now has its own SQLite table and indexed columns.
// Existing social_state JSON and social.json files migrate exactly once in a transaction.
const DOMAINS=["users","sessions","connections","messages","reports","invites","studyPlans","appeals","adminAudit","readStates","recoveryCodes"];
const sqlName={studyPlans:"study_plans",adminAudit:"admin_audit"};
const idOf=(name,row)=>name==="sessions"?row.key:name==="invites"?row.codeHash:row.id;
const ownerOf=(name,row)=>name==="sessions"?row.userId:
  name==="studyPlans"?row.creatorId:name==="appeals"||name==="readStates"||name==="recoveryCodes"?row.userId:
  name==="messages"||name==="reports"||name==="connections"?row.from:null;
const peerOf=(name,row)=>name==="studyPlans"?row.partnerId:
  name==="messages"||name==="connections"?row.to:name==="reports"?row.target:null;
const stampOf=row=>row.createdAt||"";
const statusOf=row=>row.status||"";
const table=name=>sqlName[name]||name;
function safeState(state){
  if(!state||typeof state!=="object"||!Array.isArray(state.users)||!Array.isArray(state.sessions)){
    throw Error("legacy_social_invalid");
  }
  for(const name of DOMAINS)if(state[name]!==undefined&&!Array.isArray(state[name]))throw Error("legacy_bad_domain_"+name);
  return state;
}
function schema(db){
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA busy_timeout=10000");
  db.exec("PRAGMA secure_delete=ON");
  db.exec("CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL)");
  for(const name of DOMAINS){
    const n=table(name);
    db.exec('CREATE TABLE IF NOT EXISTS "'+n+'" ('+
      'id TEXT PRIMARY KEY NOT NULL, owner TEXT, peer TEXT, created_at TEXT, status TEXT, payload TEXT NOT NULL)');
    db.exec('CREATE INDEX IF NOT EXISTS "idx_'+n+'_pair" ON "'+n+'" (owner,peer,created_at)');
    db.exec('CREATE INDEX IF NOT EXISTS "idx_'+n+'_peer" ON "'+n+'" (peer,created_at)');
  }
}
export class SocialStore{
  constructor(dataDir,empty){
    mkdirSync(dataDir,{recursive:true,mode:0o700});
    this.filename=join(dataDir,"social.sqlite");
    this.db=new DatabaseSync(this.filename,{timeout:10000});
    this.empty=empty;
    schema(this.db);
    const completed=this.db.prepare("SELECT value FROM schema_meta WHERE key='format'").get()?.value;
    if(completed!=="relational-v2")this.migrate(dataDir);
    chmodSync(this.filename,0o600);
  }
  migrate(dataDir){
    const oldTable=this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='social_state'").get();
    const row=oldTable?this.db.prepare("SELECT body FROM social_state WHERE id=1").get():null;
    const legacy=join(dataDir,"social.json"),migrated=join(dataDir,"social.json.migrated");
    const path=existsSync(legacy)?legacy:existsSync(migrated)?migrated:null;
    const hasRows=DOMAINS.some(name=>this.db.prepare('SELECT 1 FROM "'+table(name)+'" LIMIT 1').get());
    const state=row?safeState(JSON.parse(row.body)):
      !hasRows && path?safeState(JSON.parse(readFileSync(path,"utf8"))):this.empty();
    this.db.exec("BEGIN IMMEDIATE");
    try{
      if(!hasRows){
        for(const name of DOMAINS){
          const put=this.db.prepare('INSERT INTO "'+table(name)+'"(id,owner,peer,created_at,status,payload) VALUES(?,?,?,?,?,?)');
          for(const record of state[name]||[]){
            const id=idOf(name,record);
            if(typeof id!=="string"||!id)throw Error("migration_missing_id_"+name);
            put.run(id,ownerOf(name,record),peerOf(name,record),stampOf(record),statusOf(record),JSON.stringify(record));
          }
        }
      }
      // Removes the obsolete full account snapshot from active SQLite state.
      if(oldTable)this.db.exec("DROP TABLE social_state");
      this.db.prepare("INSERT OR REPLACE INTO schema_meta(key,value) VALUES('format','relational-v2')").run();
      this.db.exec("COMMIT");
    }catch(e){this.db.exec("ROLLBACK");throw e;}
    // Cleanup only the exact legacy files made by this application, after a valid commit.
    // Site operators must separately govern snapshots taken outside this directory.
    for(const file of [legacy,migrated])if(existsSync(file))unlinkSync(file);
  }
  read({excludeMessages=false}={}){
    const state=this.empty();
    for(const name of DOMAINS){
      if(excludeMessages&&name==="messages"){state.messages=[];continue;}
      state[name]=this.db.prepare('SELECT payload FROM "'+table(name)+'" ORDER BY created_at ASC,id ASC').all()
        .map(row=>JSON.parse(row.payload));
    }
    return state;
  }
  begin(){
    this.db.exec("BEGIN IMMEDIATE");
    try{
      this.previous=this.read();
      return structuredClone(this.previous);
    }catch(e){this.db.exec("ROLLBACK");this.previous=null;throw e;}
  }
  commit(state){
    try{
      const before=this.previous||this.empty();
      for(const name of DOMAINS){
        const n=table(name);
        const existing=new Map((before[name]||[]).map(x=>[idOf(name,x),JSON.stringify(x)]));
        const now=new Set();
        const upsert=this.db.prepare('INSERT INTO "'+n+'"(id,owner,peer,created_at,status,payload) VALUES(?,?,?,?,?,?) '+
          'ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,peer=excluded.peer,'+
          'created_at=excluded.created_at,status=excluded.status,payload=excluded.payload');
        const remove=this.db.prepare('DELETE FROM "'+n+'" WHERE id=?');
        for(const record of state[name]||[]){
          const id=idOf(name,record);
          if(typeof id!=="string"||!id||now.has(id))throw Error("invalid_record_key_"+name);
          now.add(id);
          const payload=JSON.stringify(record);
          if(payload!==existing.get(id)){
            upsert.run(id,ownerOf(name,record),peerOf(name,record),stampOf(record),statusOf(record),payload);
          }
        }
        for(const id of existing.keys())if(!now.has(id))remove.run(id);
      }
      this.db.exec("COMMIT");
      this.previous=null;
    }catch(e){this.rollback();throw e;}
  }
  rollback(){
    try{this.db.exec("ROLLBACK");}catch{}
    this.previous=null;
  }
  messagesBetween(a,b,{limit=100,before=null}={}){
    const page=Math.max(1,Math.min(100,Number(limit)||100));
    const params=[a,b,b,a];
    const predicate=before?" AND (created_at < ? OR (created_at = ? AND id < ?))":"";
    if(before){params.push(before.createdAt,before.createdAt,before.id);}
    params.push(page+1);
    const rows=this.db.prepare('SELECT payload FROM messages WHERE ((owner=? AND peer=?) OR (owner=? AND peer=?))'+
      predicate+' ORDER BY created_at DESC,id DESC LIMIT ?').all(...params).map(r=>JSON.parse(r.payload));
    return {messages:rows.slice(0,page).reverse(),hasMore:rows.length>page};
  }
  appendMessage(record){
    if(!record?.id || !record.from || !record.to)throw Error("invalid_message");
    this.db.prepare("INSERT INTO messages(id,owner,peer,created_at,status,payload) VALUES(?,?,?,?,?,?)")
      .run(record.id,record.from,record.to,record.createdAt,"",JSON.stringify(record));
  }
  messagesForUser(userId){
    return this.db.prepare("SELECT payload FROM messages WHERE owner=? OR peer=? ORDER BY created_at ASC,id ASC")
      .all(userId,userId).map(r=>JSON.parse(r.payload));
  }
  unreadForUser(userId,readStates=[]){
    const state=new Map(readStates.filter(s=>s.userId===userId).map(s=>[s.peerId,s.lastReadAt||""]));
    return this.db.prepare("SELECT owner FROM messages WHERE peer=? GROUP BY owner").all(userId)
      .map(p=>({peerId:p.owner,count:this.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE owner=? AND peer=? AND created_at>?")
        .get(p.owner,userId,state.get(p.owner)||"").n})).filter(p=>p.count>0);
  }
  async backupTo(destination){
    return sqliteBackup(this.db,resolve(destination));
  }
  integrity(){
    return this.db.prepare("PRAGMA integrity_check").get().integrity_check;
  }
  close(){this.db.close();}
}
