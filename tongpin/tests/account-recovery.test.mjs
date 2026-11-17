import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createSocialApi} from "../api.mjs";

test("one-time recovery code resets password and revokes existing sessions",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"tongpin-recovery-code-"));
 const route=createSocialApi({dataDir:dir});
 const server=createServer((req,res)=>route(req,res,new URL(req.url,"http://"+req.headers.host)));
 await new Promise(ok=>server.listen(0,"127.0.0.1",ok));
 const base="http://127.0.0.1:"+server.address().port;
 const request=async(path,method="GET",payload,cookie="")=>{
  const response=await fetch(base+"/api/social"+path,{
   method,headers:{Origin:base,"Content-Type":"application/json","X-Tongpin-Request":"1",...(cookie?{Cookie:cookie}:{})},
   body:payload===undefined?undefined:JSON.stringify(payload)});
  return {status:response.status,data:await response.json(),
    cookie:(response.headers.get("set-cookie")||"").split(";")[0]};
 };
 try {
  const account=await request("/register","POST",
    {handle:"recover_user",password:"old-password-123",adult:true,acceptTerms:true});
  assert.equal(account.status,201);
  const codes=await request("/account/recovery-codes","POST",{password:"old-password-123"},account.cookie);
  assert.equal(codes.status,201);
  assert.equal(codes.data.codes.length,8);
  const reset=await request("/account/recover","POST",{
    handle:"recover_user",code:codes.data.codes[0],newPassword:"new-password-123"});
  assert.equal(reset.status,200);
  assert.equal((await request("/session","GET",undefined,account.cookie)).data.user,null);
  assert.equal((await request("/account/recover","POST",{
    handle:"recover_user",code:codes.data.codes[0],newPassword:"later-password-123"})).status,403);
  assert.equal((await request("/login","POST",{handle:"recover_user",password:"new-password-123"})).status,200);
 }finally{
  await new Promise(ok=>server.close(ok));
  await rm(dir,{recursive:true,force:true});
 }
});
