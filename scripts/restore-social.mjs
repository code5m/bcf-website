import {DatabaseSync} from "node:sqlite";
import {mkdir,copyFile,link,chmod,stat,unlink} from "node:fs/promises";
import {dirname,resolve} from "node:path";
import {randomUUID} from "node:crypto";
// Never overwrite an existing live database. Stop all application instances before restoring.
const [backup,target]=process.argv.slice(2);
if(!backup||!target)throw Error("usage: node scripts/restore-social.mjs <backup.sqlite> <new-social.sqlite>");
const from=resolve(backup),to=resolve(target);
if(from===to)throw Error("restore_source_must_differ");
await stat(from);
try{await stat(to);throw Error("restore_target_exists_stop_app_and_move_database_first");}
catch(error){if(error.code!=="ENOENT")throw error;}
await mkdir(dirname(to),{recursive:true,mode:0o700});
const temporary=to+"."+randomUUID()+".tmp";
try{
 await copyFile(from,temporary);
 const db=new DatabaseSync(temporary,{readOnly:true});
 try{
   if(db.prepare("PRAGMA integrity_check").get().integrity_check!=="ok")throw Error("backup_corrupt");
   const format=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_meta'").get();
   const legacy=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='social_state'").get();
   if(!format&&!legacy)throw Error("not_tongpin_database");
 }finally{db.close();}
 await chmod(temporary,0o600);
 // Never overwrite a path created after the preliminary existence check.
 await link(temporary,to);
 await unlink(temporary);
 console.log(JSON.stringify({ok:true,restored:to}));
}finally{await unlink(temporary).catch(()=>{});}
