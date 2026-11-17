import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createSocialApi} from "../api.mjs";
import {normalizeImported, normalizeShowcase, matchPublic} from "../core.js";

test("local import deduplicates and keeps private notes out of curated publication", () => {
  const {items, duplicates} = normalizeImported({state: {
    videos: {"BV1234567890": {bvid:"BV1234567890", title:"Hello", notes:"private note", tags:["AI"]}},
    library:{categories:{"BV1234567890":"编程"}}
  }});
  assert.equal(items.length, 1);
  assert.equal(duplicates, 0);
  const [published] = normalizeShowcase([{...items[0], caption:"公开推荐"}]);
  assert.equal(published.notes, undefined);
  assert.equal(published.url, "https://www.bilibili.com/video/BV1234567890");
});
test("matching uses only public collections, not private notes", () => {
  const a = {showcase:[{bvid:"BV1234567890",tags:["AI"]}],profile:{topics:["电影"]}};
  const b = {showcase:[{bvid:"BV1234567890",tags:["AI"]}],profile:{topics:["电影"]}};
  assert.deepEqual(matchPublic(a,b), {score:8,sharedVideos:["BV1234567890"],sharedTopics:["电影"],sharedTags:["AI"]});
});
test("real API: private by default, opt-in, mutual friend consent, message, block and delete", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tongpin-"));
  const route = createSocialApi({dataDir:dir});
  const server = createServer(async (req,res) => {
    const url = new URL(req.url, "http://" + req.headers.host);
    await route(req,res,url);
  });
  await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const req = async (path, method = "GET", payload, cookie = "") => {
    const r = await fetch(base + "/api/social" + path, {
      method, headers: {Origin: base, "Content-Type": "application/json", "X-Tongpin-Request": "1", ...(cookie ? {Cookie:cookie} : {})},
      body: payload === undefined ? undefined : JSON.stringify(payload)
    });
    return {status:r.status, body:await r.json(), cookie:(r.headers.get("set-cookie") || "").split(";")[0]};
  };
  const profile = (displayName, discoverable) => ({displayName, bio:"", topics:["AI","音乐"], city:"", discoverable});
  const showcase = bvid => ({items:[{bvid,title:"测试视频",tags:["AI"]}]});
  try {
    const a = await req("/register","POST",{handle:"alice",password:"strongpass-123",adult:true,acceptTerms:true,displayName:"Alice"});
    const b = await req("/register","POST",{handle:"bob_1",password:"strongpass-456",adult:true,acceptTerms:true,displayName:"Bob"});
    assert.equal(a.status,201);
    assert.equal(b.status,201);
    assert.equal((await req("/logout","POST",{})).status,200);
    assert.ok((await req("/session","GET",undefined,a.cookie)).body.user);
    assert.ok((await req("/session","GET",undefined,b.cookie)).body.user);
    assert.equal((await req("/people","GET",undefined,a.cookie)).body.people.length,0);
    assert.equal((await req("/me","PUT",profile("Alice",true),a.cookie)).status,409);
    assert.equal((await req("/showcase","PUT",showcase("BV1234567890"),a.cookie)).status,200);
    assert.equal((await req("/showcase","PUT",showcase("BV1234567890"),b.cookie)).status,200);
    assert.equal((await req("/me","PUT",profile("Alice",true),a.cookie)).status,200);
    assert.equal((await req("/me","PUT",profile("Bob",true),b.cookie)).status,200);
    const people = await req("/people","GET",undefined,a.cookie);
    assert.equal(people.body.people.length,1);
    assert.equal(people.body.people[0].match.sharedVideos.length,1);
    const peer = people.body.people[0].id;
    assert.equal((await req("/messages?peer="+peer,"GET",undefined,a.cookie)).status,403);
    const invite = await req("/connections","POST",{targetId:peer},a.cookie);
    assert.equal(invite.status,201);
    assert.equal((await req("/connections/" + invite.body.id,"PUT",{action:"accept"},b.cookie)).status,200);
    const message = await req("/messages","POST",{peerId:peer,text:"一起学习吗？"},a.cookie);
    assert.equal(message.status,201);
    assert.equal((await req("/messages?peer="+peer,"GET",undefined,a.cookie)).body.messages.length,1);
    assert.equal((await req("/blocks","POST",{targetId:peer},a.cookie)).status,200);
    assert.equal((await req("/messages?peer="+peer,"GET",undefined,a.cookie)).status,403);
    const wrongOrigin = await fetch(base + "/api/social/me",{
      method:"PUT", headers:{Origin:"https://evil.example","Content-Type":"application/json","X-Tongpin-Request":"1",Cookie:a.cookie},
      body:JSON.stringify(profile("Alice",true))
    });
    assert.equal(wrongOrigin.status,403);
    assert.equal((await req("/account","DELETE",{password:"strongpass-123"},a.cookie)).status,200);
    assert.equal((await req("/session","GET",undefined,a.cookie)).body.user,null);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dir,{recursive:true,force:true});
  }
});

test("invite-only deployment: admin issues single-use codes, reports and suspensions retain export rights", async()=>{
  const prev={invite:process.env.TONGPIN_INVITE_ONLY,admin:process.env.TONGPIN_ADMIN_TOKEN};
  process.env.TONGPIN_INVITE_ONLY="1";
  process.env.TONGPIN_ADMIN_TOKEN="a".repeat(64);
  const dir=await mkdtemp(join(tmpdir(),"tongpin-invites-"));
  const route=createSocialApi({dataDir:dir});
  const server=createServer((req,res)=>route(req,res,new URL(req.url,"http://"+req.headers.host)));
  await new Promise(done=>server.listen(0,"127.0.0.1",done));
  const base="http://127.0.0.1:"+server.address().port;
  const request=async(path,method="GET",data,auth="",token="")=>{
    const r=await fetch(base+"/api/social"+path,{
      method,headers:{Origin:base,"Content-Type":"application/json","X-Tongpin-Request":"1",
        ...(auth?{Cookie:auth}:{}),...(token?{Authorization:"Bearer "+token}:{})},
      body:data===undefined?undefined:JSON.stringify(data)
    });
    return {code:r.status,body:await r.json(),cookie:(r.headers.get("set-cookie")||"").split(";")[0]};
  };
  const create=(handle,inviteCode)=>request("/register","POST",{
    handle,password:"long-password-123",adult:true,acceptTerms:true,inviteCode
  });
  try{
    assert.equal((await create("first_user","")).code,403);
    assert.equal((await request("/moderation/invites","POST",{count:2})).code,403);
    const admin=await request("/moderation/invites","POST",{count:2},"",process.env.TONGPIN_ADMIN_TOKEN);
    assert.equal(admin.code,201);assert.equal(admin.body.codes.length,2);
    const first=await create("first_user",admin.body.codes[0]);
    assert.equal(first.code,201);
    assert.equal((await create("reused",admin.body.codes[0])).code,403);
    const second=await create("second_user",admin.body.codes[1]);
    assert.equal(second.code,201);
    const report=await request("/reports","POST",{
      targetId:second.body.user.id,reason:"spam",details:"test report"
    },first.cookie);
    assert.equal(report.code,201);
    const reports=await request("/moderation/reports","GET",undefined,"",process.env.TONGPIN_ADMIN_TOKEN);
    assert.equal(reports.code,200);
    assert.equal(reports.body.reports.length,1);
    const reportId=reports.body.reports[0].id;
    assert.equal((await request("/moderation/reports/"+reportId,"PUT",{action:"suspend"},"",process.env.TONGPIN_ADMIN_TOKEN)).code,200);
    assert.equal((await request("/people","GET",undefined,second.cookie)).code,403);
    assert.equal((await request("/account/export","GET",undefined,second.cookie)).code,200);
    assert.equal((await request("/account","DELETE",{password:"long-password-123"},second.cookie)).code,200);
    assert.equal((await request("/session","GET",undefined,second.cookie)).body.user,null);
  }finally{
    await new Promise(done=>server.close(done));
    await rm(dir,{recursive:true,force:true});
    if(prev.invite===undefined)delete process.env.TONGPIN_INVITE_ONLY;
    else process.env.TONGPIN_INVITE_ONLY=prev.invite;
    if(prev.admin===undefined)delete process.env.TONGPIN_ADMIN_TOKEN;
    else process.env.TONGPIN_ADMIN_TOKEN=prev.admin;
  }
});

test("imports a real-shaped BFC workbench backup while retaining topic membership and progress", () => {
  const payload={type:"workbench_backup",version:1,state:{
    videos:{"BV1234567890":{bvid:"BV1234567890",title:"AI 电影实战",author:"作者A",raw:{title:"AI 电影实战",originalFolders:["默认收藏"]}}},
    library:{topics:[{id:"learn",name:"AI 电影制作",items:["BV1234567890","BV0987654321"],chapters:["入门","实践"]}],
      categories:{"BV1234567890":"电影"},watched:{"BV1234567890":true},
      notes:{"BV1234567890":"本人的私人笔记"},progress:{"BV1234567890":{percent:38}}}
  }};
  const result=normalizeImported(payload);
  assert.equal(result.kind,"bfc-backup");
  assert.equal(result.items.length,2);
  const known=result.items.find(v=>v.bvid==="BV1234567890");
  assert.equal(known.title,"AI 电影实战");
  assert.equal(known.notes,"本人的私人笔记");
  assert.equal(known.watched,true);
  assert.equal(known.progress,38);
  assert.deepEqual(known.topics,["AI 电影制作"]);
  assert.equal(result.metadataOnly,1);
  assert.equal(result.items.find(v=>v.bvid==="BV0987654321").metadataMissing,true);
  assert.equal(result.topics.length,1);
});
test("imports legacy BFC studio exports without fabricating metadata and round-trips Tongpin drafts",()=>{
  const legacy={topics:[{name:"剪辑",items:["BV1234567890"]}],categories:{"BV1234567890":"视频创作"},watched:{"BV1234567890":true}};
  const x=normalizeImported(legacy);
  assert.equal(x.kind,"bfc-topics-only");
  assert.equal(x.metadataOnly,1);
  assert.equal(x.items[0].watched,true);
  assert.match(x.items[0].title,/待补齐标题/);
  const backup={type:"tongpin_private_library",videos:x.items,
    showcaseDraft:[{bvid:"BV1234567890",title:"公开精选",tags:["电影"]}]};
  const restored=normalizeImported(backup);
  assert.equal(restored.showcaseDraft.length,1);
  assert.equal(restored.showcaseDraft[0].notes,undefined);
});
test("rejects huge imports and does not invent invalid BV identities",()=>{
  assert.throws(()=>normalizeImported({videos:Array.from({length:30001},()=>({bvid:"BV1234567890"}))}),/limit/);
  assert.equal(normalizeImported({videos:[{id:"invalid"}]}).items.length,0);
});

test("password rotation keeps current session but revokes all other sessions",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"tongpin-password-"));
  const route=createSocialApi({dataDir:dir});
  const server=createServer((req,res)=>route(req,res,new URL(req.url,"http://"+req.headers.host)));
  await new Promise(ok=>server.listen(0,"127.0.0.1",ok));
  const base="http://127.0.0.1:"+server.address().port;
  async function req(path,method,data,cookie){
    const r=await fetch(base+"/api/social"+path,{
      method,headers:{"Origin":base,"Content-Type":"application/json","X-Tongpin-Request":"1",...(cookie?{Cookie:cookie}:{})},
      body:data===undefined?undefined:JSON.stringify(data)
    });
    return {status:r.status,body:await r.json(),cookie:(r.headers.get("set-cookie")||"").split(";")[0]};
  }
  try{
    const created=await req("/register","POST",{handle:"password_user",password:"old-strong-password",adult:true,acceptTerms:true});
    assert.equal(created.status,201);
    const other=await req("/login","POST",{handle:"password_user",password:"old-strong-password"});
    assert.equal(other.status,200);
    assert.notEqual(created.cookie,other.cookie);
    assert.equal((await req("/account/password","PUT",{currentPassword:"wrongpassword",newPassword:"new-strong-pass"},created.cookie)).status,403);
    const changed=await req("/account/password","PUT",{currentPassword:"old-strong-password",newPassword:"new-strong-pass"},created.cookie);
    assert.equal(changed.status,200);
    assert.equal((await req("/people","GET",undefined,other.cookie)).status,401);
    assert.equal((await req("/people","GET",undefined,created.cookie)).status,200);
    assert.equal((await req("/login","POST",{handle:"password_user",password:"old-strong-password"})).status,401);
    assert.equal((await req("/login","POST",{handle:"password_user",password:"new-strong-pass"})).status,200);
  }finally{
    await new Promise(ok=>server.close(ok));
    await rm(dir,{recursive:true,force:true});
  }
});
test("match excludes unrelated profiles by default, even when they are discoverable",()=>{
  assert.equal(matchPublic({showcase:[{bvid:"BV1234567890"}],profile:{topics:["电影"]}},
    {showcase:[{bvid:"BV0987654321"}],profile:{topics:["英语"]}}).score,0);
});

test("consent-driven study plan only shares explicit goals with a friend, not private videos",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"tongpin-study-"));
  const handle=createSocialApi({dataDir:dir});
  const server=createServer((req,res)=>handle(req,res,new URL(req.url,"http://"+req.headers.host)));
  await new Promise(ok=>server.listen(0,"127.0.0.1",ok));
  const base="http://127.0.0.1:"+server.address().port;
  async function request(path,method="GET",payload,cookie=""){
    const r=await fetch(base+"/api/social"+path,{
      method,headers:{Origin:base,"X-Tongpin-Request":"1","Content-Type":"application/json",
        ...(cookie?{Cookie:cookie}:{})},
      body:payload===undefined?undefined:JSON.stringify(payload)});
    return {status:r.status,data:await r.json(),cookie:(r.headers.get("set-cookie")||"").split(";")[0]};
  }
  try{
    const a=await request("/register","POST",{handle:"study_alice",password:"strongpass-123",adult:true,acceptTerms:true});
    const b=await request("/register","POST",{handle:"study_bob",password:"strongpass-123",adult:true,acceptTerms:true});
    const cookieA=a.cookie,cookieB=b.cookie;
    assert.equal((await request("/study/plans","POST",{peerId:b.data.user.id,topic:"电影",goals:["写剧本"]},cookieA)).status,403);
    const demo={items:[{bvid:"BV1234567890",title:"同一个公开视频"}]};
    await request("/showcase","PUT",demo,cookieA);
    await request("/showcase","PUT",demo,cookieB);
    await request("/me","PUT",{displayName:"Alice",topics:["电影"],discoverable:true},cookieA);
    await request("/me","PUT",{displayName:"Bob",topics:["电影"],discoverable:true},cookieB);
    const friend=await request("/connections","POST",{targetId:b.data.user.id},cookieA);
    await request("/connections/"+friend.data.id,"PUT",{action:"accept"},cookieB);
    const plan=await request("/study/plans","POST",{peerId:b.data.user.id,topic:"AI 电影",goals:["做分镜","剪辑一段视频"]},cookieA);
    assert.equal(plan.status,201);
    const listB=await request("/study/plans","GET",undefined,cookieB);
    assert.equal(listB.data.plans.length,1);
    assert.equal(listB.data.plans[0].incoming,true);
    assert.equal(JSON.stringify(listB.data).includes("私人笔记"),false);
    assert.equal((await request("/study/plans/"+plan.data.id,"PUT",{action:"accept"},cookieA)).status,403);
    assert.equal((await request("/study/plans/"+plan.data.id,"PUT",{action:"accept"},cookieB)).status,200);
    const toggle=await request("/study/plans/"+plan.data.id,"PUT",{action:"toggle",goalIndex:0},cookieA);
    assert.deepEqual(toggle.data.mine,[0]);
    const list=await request("/study/plans","GET",undefined,cookieB);
    assert.deepEqual(list.data.plans[0].theirs,[0]);
    assert.equal((await request("/blocks","POST",{targetId:b.data.user.id},cookieA)).status,200);
    assert.equal((await request("/study/plans","GET",undefined,cookieB)).data.plans.length,0);
  }finally{
    await new Promise(ok=>server.close(ok));
    await rm(dir,{recursive:true,force:true});
  }
});

test("BFC topic notes, chapter order and original folder names survive round trip",()=>{
  const folder="这是一个比较长的原始收藏文件夹名称_电影学习_后期制作_导演资料";
  const topic="电影制作的高阶工作流与完整个人体系";
  const data={type:"workbench_backup",state:{
    videos:{"BV1234567890":{bvid:"BV1234567890",title:"收藏视频",originalFolders:[folder]}},
    library:{topics:[{name:topic,items:["BV1234567890"],notes:"这是专属的专题笔记",
      chapters:["写作","拍摄","后期"],sections:{"BV1234567890":"拍摄"}}]}
  }};
  const result=normalizeImported(data);
  assert.equal(result.items[0].sourceFolders[0],folder);
  assert.equal(result.topics[0].name,topic);
  assert.equal(result.topics[0].notes,"这是专属的专题笔记");
  assert.deepEqual(result.topics[0].chapters,["写作","拍摄","后期"]);
  assert.equal(result.topics[0].sections.BV1234567890,"拍摄");
});
