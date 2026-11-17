import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createSocialApi} from "../api.mjs";

test("concurrent password rotation and old-password login cannot leave a valid stale session",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"tongpin-login-race-"));
 const handler=createSocialApi({dataDir:dir});
 const server=createServer((req,res)=>handler(req,res,new URL(req.url,"http://"+req.headers.host)));
 await new Promise(ok=>server.listen(0,"127.0.0.1",ok));
 const base="http://127.0.0.1:"+server.address().port;
 async function call(path,method="GET",body,cookie=""){
   const response=await fetch(base+"/api/social"+path,{
     method,headers:{"Origin":base,"Content-Type":"application/json","X-Tongpin-Request":"1",
       ...(cookie?{"Cookie":cookie}:{})},
     body:body===undefined?undefined:JSON.stringify(body)
   });
   return {status:response.status,data:await response.json(),
     cookie:(response.headers.get("set-cookie")||"").split(";")[0]};
 }
 try{
   const account=await call("/register","POST",{
     handle:"race_user",password:"before-password-123",adult:true,acceptTerms:true
   });
   assert.equal(account.status,201);
   const [concurrent,changed]=await Promise.all([
     call("/login","POST",{handle:"race_user",password:"before-password-123"}),
     call("/account/password","PUT",{
       currentPassword:"before-password-123",newPassword:"after-password-123"
     },account.cookie)
   ]);
   assert.equal(changed.status,200);
   assert.ok([200,401].includes(concurrent.status));
   if(concurrent.status===200){
     assert.equal((await call("/session","GET",undefined,concurrent.cookie)).data.user,null);
   }
   assert.equal((await call("/login","POST",{
     handle:"race_user",password:"before-password-123"
   })).status,401);
   assert.equal((await call("/login","POST",{
     handle:"race_user",password:"after-password-123"
   })).status,200);
 }finally{
   await new Promise(ok=>server.close(ok));
   await rm(dir,{recursive:true,force:true});
 }
});
