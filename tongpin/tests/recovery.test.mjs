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
