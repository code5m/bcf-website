import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {SocialStore} from "../store.mjs";
const empty=()=>({version:1,users:[],sessions:[],connections:[],messages:[],reports:[],invites:[],studyPlans:[],
  appeals:[],adminAudit:[],readStates:[],recoveryCodes:[]});
test("ordinary transactions never load or delete 600 historical messages",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"tongpin-unbounded-history-"));
 try{
   const store=new SocialStore(dir,empty);
   const initial=store.begin();
   initial.users.push({id:"alice",handle:"alice"});
   for(let i=0;i<600;i++)initial.messages.push({
     id:"msg-"+i,from:"alice",to:"bob",createdAt:new Date(1763337600000+i*1000).toISOString(),
     text:"sensitive-test-message-"+i
   });
   store.commit(initial);
   assert.equal(store.messagesForUser("alice").length,600);
   for(let j=0;j<12;j++){
     const state=store.begin();
     assert.equal(state.messages.length,0);
     state.users[0].testValue=j;
     store.commit(state);
   }
   assert.equal(store.messagesForUser("alice").length,600);
   assert.equal(store.integrity(),"ok");
   const deleted=store.begin();
   store.deleteMessagesForUser("alice");
   deleted.users=[];
   store.commit(deleted);
   assert.equal(store.messagesForUser("alice").length,0);
   store.close();
 }finally{await rm(dir,{recursive:true,force:true});}
});
test("the writable health probe reflects a committed SQLite value",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"tongpin-writable-health-"));
 try{
   const store=new SocialStore(dir,empty);
   assert.equal(store.health(),true);
   const first=store.db.prepare("SELECT value FROM schema_meta WHERE key='health_probe'").get()?.value;
   assert.ok(first);
   assert.equal(store.health(),true);
   assert.equal(store.integrity(),"ok");
   store.close();
 }finally{await rm(dir,{recursive:true,force:true});}
});
