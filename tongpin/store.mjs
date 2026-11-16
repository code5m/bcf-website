import {DatabaseSync} from "node:sqlite";
import {existsSync, readFileSync, renameSync, mkdirSync, chmodSync} from "node:fs";
import {join} from "node:path";

export class SocialStore {
  constructor(dataDir, empty) {
    mkdirSync(dataDir, {recursive:true, mode:0o700});
    this.filename=join(dataDir,"social.sqlite");
    this.db = new DatabaseSync(this.filename, {timeout:10000});
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec("PRAGMA busy_timeout=10000");
    this.db.exec("CREATE TABLE IF NOT EXISTS social_state (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, body TEXT NOT NULL)");
    const existing=this.db.prepare("SELECT version FROM social_state WHERE id=1").get();
    if(!existing){
      const legacy=join(dataDir,"social.json");
      let state=empty();
      if(existsSync(legacy)){
        state=JSON.parse(readFileSync(legacy,"utf8"));
        if(!Array.isArray(state.users)||!Array.isArray(state.sessions)) throw Error("legacy_social_invalid");
      }
      this.db.prepare("INSERT INTO social_state(id,version,body) VALUES(1,1,?)").run(JSON.stringify(state));
      if(existsSync(legacy))renameSync(legacy,legacy+".migrated");
    }
    chmodSync(this.filename,0o600);
  }
  read() {
    const row=this.db.prepare("SELECT body FROM social_state WHERE id=1").get();
    return JSON.parse(row.body);
  }
  begin() {
    this.db.exec("BEGIN IMMEDIATE");
    return this.read();
  }
  commit(state) {
    try{
      this.db.prepare("UPDATE social_state SET version=version+1, body=? WHERE id=1").run(JSON.stringify(state));
      this.db.exec("COMMIT");
    }catch(e){
      try{this.db.exec("ROLLBACK");}catch{}
      throw e;
    }
  }
  rollback(){
    try{this.db.exec("ROLLBACK");}catch{}
  }
  close(){this.db.close();}
}
