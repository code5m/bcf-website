import test from "node:test";
import assert from "node:assert/strict";
import {matchLocalFavorites} from "../core.js";
import {createSocialApi} from "../api.mjs";
import {createServer} from "node:http";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

test("exact local-only BV match reveals only the public title, never private notes",()=>{
  const privateItems=[
    {bvid:"BV1234567890",title:"MY SECRET",notes:"PRIVATE_NOTE_SHOULD_NOT_LEAK",
      tags:["private-note"],sourceFolders:["secret folder"]},
    {bvid:"BV0987654321",title:"Only me",notes:"DO NOT SEND"}
  ];
  const pub=[
    {id:"friend",handle:"curator",showcase:[
      {bvid:"BV1234567890",title:"Public shared film",caption:"their public caption",tags:["movie"]}]},
    {id:"not-match",handle:"other",showcase:[{bvid:"BVzzzzzzzzzz",title:"Other title"}]}
  ];
  const result=matchLocalFavorites(privateItems,pub);
  assert.equal(result[0].localOverlap.count,1);
  assert.deepEqual(result[0].localOverlap.videos,[{bvid:"BV1234567890",title:"Public shared film"}]);
  assert.equal(result[1].localOverlap.count,0);
  assert.ok(!JSON.stringify(result).includes("PRIVATE_NOTE_SHOULD_NOT_LEAK"));
  assert.ok(!JSON.stringify(result).includes("secret folder"));
  assert.equal(matchLocalFavorites([],pub)[0].localOverlap.count,0);
});

test("public candidate discovery never receives or discloses private BV IDs",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"tongpin-candidates-"));
  const route=createSocialApi({dataDir:dir});
  const server=createServer((req,res)=>route(req,res,new URL(req.url,"http://"+req.headers.host)));
  await new Promise(ok=>server.listen(0,"127.0.0.1",ok));
  const base="http://127.0.0.1:"+server.address().port;
  const req=async(path,method="GET",body,cookie="")=>{
    const response=await fetch(base+"/api/social"+path,{
      method,headers:{"Origin":base,"Content-Type":"application/json",
        "X-Tongpin-Request":"1",...(cookie?{"Cookie":cookie}:{})},
      body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,data:await response.json(),cookie:(response.headers.get("set-cookie")||"").split(";")[0]};
  };
  try{
    const user=await req("/register","POST",{handle:"public_curator",password:"strong-password-123",
      displayName:"Curator",adult:true,acceptTerms:true});
    assert.equal(user.status,201);
    const privateMarker="private-notes-must-not-appear";
    const showcase={items:[{bvid:"BV1234567890",title:"Shared learning film",caption:"Hello",notes:privateMarker}]};
    assert.equal((await req("/showcase","PUT",showcase,user.cookie)).status,200);
    assert.deepEqual((await req("/candidates")).data.people,[],"opt-in is mandatory");
    await req("/me","PUT",{displayName:"Curator",bio:"Video interest",
      topics:["film"],discoverable:true},user.cookie);
    const candidates=await req("/candidates");
    assert.equal(candidates.status,200);
    assert.equal(candidates.data.people.length,1);
    assert.equal(candidates.data.people[0].showcase[0].bvid,"BV1234567890");
    assert.ok(!JSON.stringify(candidates.data).includes(privateMarker));
    assert.equal((await req("/candidates?after=not-a-valid-cursor")).status,400);
    assert.equal((await req("/candidates","GET",undefined,user.cookie)).data.people.length,0,"don't recommend self");
    await req("/me","PUT",{displayName:"Curator",bio:"Video interest",
      topics:["film"],discoverable:false},user.cookie);
    assert.deepEqual((await req("/candidates")).data.people,[]);
  }finally{await new Promise(ok=>server.close(ok));await rm(dir,{recursive:true,force:true});}
});
