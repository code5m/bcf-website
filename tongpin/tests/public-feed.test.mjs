import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createSocialApi} from "../api.mjs";

test("public video feed displays only actively discoverable opt-in showcases, never private notes",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"tongpin-optin-feed-"));
  const api=createSocialApi({dataDir:dir});
  const server=createServer((req,res)=>api(req,res,new URL(req.url,"http://"+req.headers.host)));
  await new Promise(ok=>server.listen(0,"127.0.0.1",ok));
  const base="http://127.0.0.1:"+server.address().port;
  const call=async(path,method="GET",payload,cookie="")=>{
    const response=await fetch(base+"/api/social"+path,{
      method,headers:{"Origin":base,"Content-Type":"application/json",
        "X-Tongpin-Request":"1",...(cookie?{"Cookie":cookie}:{})},
      body:payload===undefined?undefined:JSON.stringify(payload)});
    return {status:response.status,data:await response.json(),
      cookie:(response.headers.get("set-cookie")||"").split(";")[0]};
  };
  try{
    const first=await call("/feed");
    assert.equal(first.status,200);
    assert.deepEqual(first.data.items,[]);
    const register=await call("/register","POST",{
      handle:"video_curator",password:"safe-password-123",adult:true,acceptTerms:true,displayName:"电影爱好者"});
    assert.equal(register.status,201);
    const cookie=register.cookie;
    const item={bvid:"BV1234567890",title:"真实用户选择的视频",tags:["电影"],
      caption:"希望有人一起看",notes:"ULTRA_PRIVATE_NOTE"};
    assert.equal((await call("/showcase","PUT",{items:[item]},cookie)).status,200);
    assert.deepEqual((await call("/feed")).data.items,[],"showcase alone must not opt in to public discovery");
    assert.equal((await call("/me","PUT",{
      displayName:"电影爱好者",bio:"只聊视频",topics:["电影"],discoverable:true
    },cookie)).status,200);
    const published=await call("/feed");
    assert.equal(published.status,200);
    assert.equal(published.data.items.length,1);
    assert.equal(published.data.items[0].title,item.title);
    assert.equal(published.data.items[0].curator.handle,"video_curator");
    assert.equal(published.data.items[0].source,"user-curated");
    assert.equal(published.data.items[0].notes,undefined);
    assert.ok(!JSON.stringify(published.data).includes("ULTRA_PRIVATE_NOTE"));
    assert.equal((await call("/me","PUT",{
      displayName:"电影爱好者",bio:"只聊视频",topics:["电影"],discoverable:false
    },cookie)).status,200);
    assert.deepEqual((await call("/feed")).data.items,[]);
  }finally{
    await new Promise(ok=>server.close(ok));
    await rm(dir,{recursive:true,force:true});
  }
});
