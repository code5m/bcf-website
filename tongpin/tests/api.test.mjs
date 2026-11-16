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
