import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createServer} from "node:http";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";

async function availablePort(){
  const s=createServer();
  await new Promise(ok=>s.listen(0,"127.0.0.1",ok));
  const port=s.address().port;
  await new Promise(ok=>s.close(ok));
  return port;
}
test("server blocks source/config and imports BFC only with explicit local owner action",async()=>{
  const [port,bfcPort]=await Promise.all([availablePort(),availablePort()]);
  const dir=await mkdtemp(join(tmpdir(),"tongpin-local-"));
  let backupRequests=0;
  const upstream=createServer((req,res)=>{
    const host="127.0.0.1:"+bfcPort;
    if(req.headers.host!==host){res.writeHead(403).end();return;}
    res.setHeader("Content-Type","application/json");
    if(req.url==="/api/session"){res.end(JSON.stringify({token:"f".repeat(64)}));return;}
    if(req.url==="/api/workbench/state" && req.headers["x-local-csrf"]==="f".repeat(64)){
      const state={videos:{"BV1234567890":{bvid:"BV1234567890",title:"私人电影"}},library:{topics:[],categories:{}}};
      res.end(JSON.stringify(req.method==="PUT"?{ok:true,summary:{revision:2}}:
        {ok:true,summary:{revision:1},state}));
      return;
    }
    if(req.url==="/api/workbench/backup"&&req.headers["x-local-csrf"]==="f".repeat(64)){
      backupRequests++;
      res.end(JSON.stringify({type:"workbench_backup",version:1,
        state:{videos:{"BV1234567890":{bvid:"BV1234567890",title:"私人电影"}},
        library:{topics:[],categories:{}}}}));
      return;
    }
    res.writeHead(403).end("{}");
  });
  await new Promise(ok=>upstream.listen(bfcPort,"127.0.0.1",ok));
  const child=spawn(process.execPath,["server.mjs"],{
    cwd:resolve("."),env:{...process.env,NODE_ENV:"test",HOST:"127.0.0.1",
      PORT:String(port),TONGPIN_BFC_LOCAL_PORT:String(bfcPort),TONGPIN_DATA_DIR:dir},
    stdio:["ignore","pipe","pipe"]
  });
  const base="http://127.0.0.1:"+port;
  try{
    let ready=false;
    for(let i=0;i<70;i++){
      if(child.exitCode!==null)throw Error("app_exited:"+child.exitCode);
      try{const r=await fetch(base+"/api/social/health");if(r.ok){ready=true;break;}}catch{}
      await new Promise(done=>setTimeout(done,70));
    }
    assert.equal(ready,true,"server did not start");
    for(const path of ["/package.json","/Dockerfile","/compose.yaml","/apps/ios/project.yml",
      "/tongpin/tests/api.test.mjs","/docs/TONGPIN-BUSINESS-PLAN.md","/runtime/social/social.sqlite"]){
      assert.equal((await fetch(base+path)).status,404,path);
    }
    assert.equal((await fetch(base+"/tongpin/")).status,200);
    assert.equal((await fetch(base+"/")).status,200);
    assert.equal((await fetch(base+"/manage")).status,200);
    const denied=await fetch(base+"/api/local/bfc-import",{
      method:"POST",headers:{"Origin":"https://attacker.invalid","X-Tongpin-Request":"1"}});
    assert.equal(denied.status,403);
    assert.equal(backupRequests,0);
    const response=await fetch(base+"/api/local/bfc-import",{method:"POST",
      headers:{"Origin":base,"X-Tongpin-Request":"1"}});
    assert.equal(response.status,200);
    const imported=await response.json();
    assert.equal(imported.type,"workbench_backup");
    assert.equal(imported.state.videos.BV1234567890.title,"私人电影");
    assert.equal(backupRequests,1);
    assert.equal(response.headers.get("cache-control"),"no-store");
    const unauthorized=await fetch(base+"/api/workbench/state");
    assert.equal(unauthorized.status,403);
    const ownerSession=await fetch(base+"/api/session",{headers:{"X-Tongpin-Local":"1"}});
    assert.equal(ownerSession.status,200);
    const token=(await ownerSession.json()).token;
    const dataResponse=await fetch(base+"/api/workbench/state",{headers:{
      "X-Tongpin-Local":"1","X-Local-CSRF":token
    }});
    assert.equal(dataResponse.status,200);
    assert.equal((await dataResponse.json()).state.videos.BV1234567890.title,"私人电影");
    const wrong=await fetch(base+"/api/workbench/state",{method:"PUT",
      headers:{"Origin":"https://evil.example","X-Tongpin-Local":"1","X-Local-CSRF":token,"Content-Type":"application/json"},
      body:JSON.stringify({library:{}})});
    assert.equal(wrong.status,403);
    const saved=await fetch(base+"/api/workbench/state",{method:"PUT",
      headers:{"Origin":base,"X-Tongpin-Local":"1","X-Local-CSRF":token,"Content-Type":"application/json"},
      body:JSON.stringify({expectedRevision:1,library:{topics:[]}})});
    assert.equal(saved.status,200);
  }finally{
    child.kill("SIGTERM");
    await new Promise(done=>child.once("exit",done));
    await new Promise(done=>upstream.close(done));
    await rm(dir,{recursive:true,force:true});
  }
});
