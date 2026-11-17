import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createSocialApi} from "../api.mjs";
import {SocialStore} from "../store.mjs";

test("inbox unread changes on reading a friend's messages and account export contains both sides",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"tongpin-inbox-"));
 const route=createSocialApi({dataDir:dir});
 const server=createServer((req,res)=>route(req,res,new URL(req.url,"http://"+req.headers.host)));
 await new Promise(ok=>server.listen(0,"127.0.0.1",ok));
 const base="http://127.0.0.1:"+server.address().port;
 const req=async(path,method="GET",body,cookie="")=>{
  const r=await fetch(base+"/api/social"+path,{
   method,headers:{"Origin":base,"Content-Type":"application/json","X-Tongpin-Request":"1",...(cookie?{"Cookie":cookie}:{})},
   body:body===undefined?undefined:JSON.stringify(body)});
  return {status:r.status,data:await r.json(),cookie:(r.headers.get("set-cookie")||"").split(";")[0]};
 };
 try{
  const alice=await req("/register","POST",{handle:"inbox_alice",password:"strong-password-123",adult:true,acceptTerms:true});
  const bob=await req("/register","POST",{handle:"inbox_bob",password:"strong-password-123",adult:true,acceptTerms:true});
  const a=alice.cookie,b=bob.cookie,peer=alice.data.user.id;
  const shared={items:[{bvid:"BV1234567890",title:"同一个公开视频"}]};
  await req("/showcase","PUT",shared,a);await req("/showcase","PUT",shared,b);
  await req("/me","PUT",{displayName:"A",topics:["AI"],discoverable:true},a);
  await req("/me","PUT",{displayName:"B",topics:["AI"],discoverable:true},b);
  const invitation=await req("/connections","POST",{targetId:bob.data.user.id},a);
  await req("/connections/"+invitation.data.id,"PUT",{action:"accept"},b);
  for(let i=0;i<3;i++)assert.equal((await req("/messages","POST",{peerId:bob.data.user.id,text:"消息"+i},a)).status,201);
  const notifications=await req("/notifications","GET",undefined,b);
  assert.equal(notifications.data.unread.find(x=>x.peerId===peer).count,3);
  const chat=await req("/messages?peer="+peer,"GET",undefined,b);
  assert.equal(chat.data.messages.length,3);
  assert.equal(chat.data.hasMore,false);
  assert.equal((await req("/messages/read","POST",{peerId:peer},b)).status,200);
  assert.deepEqual((await req("/notifications","GET",undefined,b)).data.unread,[]);
  const exportAccount=await req("/account/export","GET",undefined,b);
  assert.equal(exportAccount.data.messages.length,3);
  assert.ok(Array.isArray(exportAccount.data.readStates));
 }finally{
  await new Promise(ok=>server.close(ok));await rm(dir,{recursive:true,force:true});
 }
});

test("indexed SQLite cursor pages are stable with 54 messages",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"tongpin-history-"));
 try{
  const empty=()=>({version:1,users:[],sessions:[],connections:[],messages:[],reports:[],invites:[],studyPlans:[],appeals:[],adminAudit:[],readStates:[],recoveryCodes:[]});
  const store=new SocialStore(dir,empty);
  const state=store.begin();
  for(let i=0;i<54;i++)state.messages.push({
    id:"00000000-0000-4000-8000-"+String(i).padStart(12,"0"),
    from:"A",to:"B",createdAt:new Date(1763337600000+i*1000).toISOString(),text:String(i)
  });
  store.commit(state);
  const page1=store.messagesBetween("A","B",{limit:50});
  assert.equal(page1.messages.length,50);
  assert.equal(page1.hasMore,true);
  const first=page1.messages[0];
  const page2=store.messagesBetween("A","B",{limit:50,before:{createdAt:first.createdAt,id:first.id}});
  assert.equal(page2.messages.length,4);
  assert.equal(page2.hasMore,false);
  store.close();
 }finally{await rm(dir,{recursive:true,force:true});}
});
