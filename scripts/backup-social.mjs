import {DatabaseSync, backup} from "node:sqlite";
import {mkdir,link,chmod,stat,unlink} from "node:fs/promises";
import {dirname,resolve} from "node:path";
import {randomUUID} from "node:crypto";
// Use SQLite's online backup API; copying an active WAL database file alone is unsafe.
const [source,destination]=process.argv.slice(2);
if(!source||!destination)throw Error("usage: node scripts/backup-social.mjs <social.sqlite> <backup.sqlite>");
const from=resolve(source),to=resolve(destination);
if(from===to)throw Error("backup_destination_must_differ");
const size=await stat(from);
if(!size.isFile())throw Error("source_not_database");
await mkdir(dirname(to),{recursive:true,mode:0o700});
try{await stat(to);throw Error("backup_already_exists");}catch(error){if(error.code!=="ENOENT")throw error;}
const db=new DatabaseSync(from,{readOnly:true});
const temp=to+"."+randomUUID()+".tmp";
try{
 await backup(db,temp);
 const check=new DatabaseSync(temp,{readOnly:true});
 try{if(check.prepare("PRAGMA integrity_check").get().integrity_check!=="ok")throw Error("backup_corrupt");}
 finally{check.close();}
 await chmod(temp,0o600);
 // link() creates the final name atomically and fails with EEXIST even if another process wins.
 await link(temp,to);
 await unlink(temp);
 console.log(JSON.stringify({ok:true,backup:to}));
}finally{db.close();await unlink(temp).catch(()=>{});}
