import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {mkdtemp,readFile,writeFile,stat,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {SocialStore} from "../store.mjs";
const empty=()=>({version:1,users:[],sessions:[],connections:[],messages:[],reports:[],invites:[],studyPlans:[],
  appeals:[],adminAudit:[],readStates:[],recoveryCodes:[]});
test("relational message index reads across two accounts and persists",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"tongpin-store-"));
 try{
  const store=new SocialStore(dir,empty);
  const draft=store.begin();
  draft.users.push({id:"alice",handle:"alice"},{id:"bob",handle:"bob"});
  draft.messages.push({id:"m1",from:"alice",to:"bob",text:"hello",createdAt:"2026-11-17T01:00:00.000Z"});
  store.commit(draft);
  assert.equal(store.messagesBetween("alice","bob").messages.length,1);
  assert.equal(store.messagesForUser("bob").length,1);
  assert.equal(store.unreadForUser("bob",[])[0].count,1);
  assert.equal(store.integrity(),"ok");
  store.close();
  const reopened=new SocialStore(dir,empty);
  assert.equal(reopened.messagesBetween("alice","bob").messages.length,1);
  reopened.close();
 }finally{await rm(dir,{recursive:true,force:true});}
});
test("legacy JSON migrates atomically without leaving old private copy",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"tongpin-legacy-"));
 try{
  const old=empty();
  old.users.push({id:"legacy",handle:"legacy"});
  old.messages.push({id:"msg",from:"legacy",to:"other",text:"private",createdAt:"2026-11-16T01:00:00.000Z"});
  await writeFile(join(dir,"social.json"),JSON.stringify(old),{mode:0o600});
  const store=new SocialStore(dir,empty);
  assert.equal(store.read().users.length,1);
  assert.equal(store.messagesForUser("legacy").length,1);
  assert.equal(store.integrity(),"ok");
  store.close();
  await assert.rejects(stat(join(dir,"social.json")),{code:"ENOENT"});
  await assert.rejects(stat(join(dir,"social.json.migrated")),{code:"ENOENT"});
 }finally{await rm(dir,{recursive:true,force:true});}
});
test("old monolithic SQLite state migrates transactionally into domain tables",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"tongpin-migrate-"));
 try{
  const file=join(dir,"social.sqlite");
  const db=new DatabaseSync(file);
  db.exec("CREATE TABLE social_state(id INTEGER PRIMARY KEY,version INTEGER,body TEXT)");
  const old=empty();
  old.users.push({id:"legacy",handle:"legacy"});
  old.connections.push({id:"c1",from:"legacy",to:"friend",status:"accepted",createdAt:"2026-11-17T00:00:00.000Z"});
  db.prepare("INSERT INTO social_state VALUES(1,1,?)").run(JSON.stringify(old));
  db.close();
  const newStore=new SocialStore(dir,empty);
  assert.equal(newStore.read().connections.length,1);
  assert.equal(newStore.db.prepare("SELECT name FROM sqlite_master WHERE name='social_state'").get(),undefined);
  assert.equal(newStore.integrity(),"ok");
  newStore.close();
 }finally{await rm(dir,{recursive:true,force:true});}
});
