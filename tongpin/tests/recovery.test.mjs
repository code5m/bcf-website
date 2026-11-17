import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdtemp,rm,stat} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {SocialStore} from "../store.mjs";
const empty=()=>({version:1,users:[],sessions:[],connections:[],messages:[],reports:[],invites:[],studyPlans:[],
 appeals:[],adminAudit:[],readStates:[],recoveryCodes:[]});
function execute(script,args){
 return new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,[script,...args],{cwd:process.cwd()});
   let stdout="",stderr="";
   child.stdout.on("data",c=>stdout+=c);
   child.stderr.on("data",c=>stderr+=c);
   child.once("close",code=>code===0?resolve(stdout):reject(new Error(stderr||"exit_"+code)));
 });
}
test("online WAL backup restores verified account and messages without overwriting live database",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"tongpin-recovery-"));
 try{
  const active=join(dir,"source","social.sqlite"),backup=join(dir,"backups","snapshot.sqlite");
  const restored=join(dir,"new","social.sqlite");
  const source=new SocialStore(join(dir,"source"),empty);
  const row=source.begin();
  row.users.push({id:"test-user",handle:"test"});
  row.messages.push({id:"test-message",from:"test-user",to:"peer",text:"private-message",
    createdAt:"2026-11-17T00:00:00.000Z"});
  source.commit(row);
  await execute("scripts/backup-social.mjs",[active,backup]);
  await stat(backup);
  await assert.rejects(execute("scripts/backup-social.mjs",[active,backup]),/backup_already_exists/);
  await execute("scripts/restore-social.mjs",[backup,restored]);
  await assert.rejects(execute("scripts/restore-social.mjs",[backup,restored]),/restore_target_exists/);
  const after=new SocialStore(join(dir,"new"),empty);
  assert.equal(after.read().users[0].id,"test-user");
  assert.equal(after.messagesForUser("test-user")[0].text,"private-message");
  assert.equal(after.integrity(),"ok");
  after.close();source.close();
 }finally{await rm(dir,{recursive:true,force:true});}
});


test("two restore attempts to the same destination never overwrite the winner",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"tongpin-restore-race-"));
 try{
   const active=join(dir,"live","social.sqlite"),snap=join(dir,"backup","snapshot.sqlite");
   const target=join(dir,"restored","social.sqlite");
   const source=new SocialStore(join(dir,"live"),empty);
   const state=source.begin();state.users.push({id:"owner",handle:"owner"});source.commit(state);
   await execute("scripts/backup-social.mjs",[active,snap]);
   const outcomes=await Promise.allSettled([
     execute("scripts/restore-social.mjs",[snap,target]),
     execute("scripts/restore-social.mjs",[snap,target])
   ]);
   assert.equal(outcomes.filter(x=>x.status==="fulfilled").length,1);
   assert.equal(outcomes.filter(x=>x.status==="rejected").length,1);
   const restored=new SocialStore(join(dir,"restored"),empty);
   assert.equal(restored.read().users[0].handle,"owner");
   assert.equal(restored.integrity(),"ok");
   restored.close();source.close();
 }finally{await rm(dir,{recursive:true,force:true});}
});

test("two concurrent online backups to the same final path cannot overwrite",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"tongpin-backup-race-"));
 try{
   const active=join(dir,"live","social.sqlite"),snap=join(dir,"snapshots","same.sqlite");
   const source=new SocialStore(join(dir,"live"),empty);
   const item=source.begin();item.users.push({id:"race",handle:"race"});source.commit(item);
   const outcomes=await Promise.allSettled([
     execute("scripts/backup-social.mjs",[active,snap]),
     execute("scripts/backup-social.mjs",[active,snap])
   ]);
   assert.equal(outcomes.filter(x=>x.status==="fulfilled").length,1);
   assert.equal(outcomes.filter(x=>x.status==="rejected").length,1);
   await stat(snap);
   const check=new SocialStore(join(dir,"live"),empty);
   assert.equal(check.integrity(),"ok");
   check.close();source.close();
 }finally{await rm(dir,{recursive:true,force:true});}
});
