// Explicit, local-owner-only bridge for importing a copy of BFC data.
// In production and on non-loopback connections this endpoint is unavailable.

const MAX_BACKUP_BYTES = 20_000_000;
const localAddress = value => /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/.test(String(value || ""));
function reply(res,status,body) {
  res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",
    "X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"});
  res.end(JSON.stringify(body));
}
async function localJson(path,headers={}) {
  const port = Number(process.env.TONGPIN_BFC_LOCAL_PORT || 4198);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error("invalid_local_bfc_port");
  const response = await fetch("http://127.0.0.1:"+port+path,{
    headers,redirect:"error",signal:AbortSignal.timeout(8000),cache:"no-store"
  });
  if (!response.ok) throw Error("local_bfc_http_"+response.status);
  if (Number(response.headers.get("content-length") || 0)>MAX_BACKUP_BYTES) throw Error("bfc_backup_too_large");
  const reader=response.body.getReader();
  let size=0;const chunks=[];
  while(true){
    const {value,done}=await reader.read();
    if(done)break;
    size+=value.byteLength;
    if(size>MAX_BACKUP_BYTES){await reader.cancel();throw Error("bfc_backup_too_large");}
    chunks.push(value);
  }
  const bytes=new Uint8Array(size);let off=0;
  for(const part of chunks){bytes.set(part,off);off+=part.length;}
  return JSON.parse(new TextDecoder().decode(bytes));
}
export async function localBfcImport(req,res,url) {
  if(url.pathname!=="/api/local/bfc-import")return false;
  if(req.method!=="POST"){reply(res,405,{error:"method_not_allowed"});return true;}
  if(process.env.NODE_ENV==="production" ||
     process.env.HOST && !["127.0.0.1","localhost","::1"].includes(process.env.HOST) ||
     !localAddress(req.socket.remoteAddress) || !localAddress(req.socket.localAddress)){
    reply(res,403,{error:"local_owner_only"});return true;
  }
  const host=String(req.headers.host||"");
  const origin=String(req.headers.origin||"");
  if(!/^(127\.0\.0\.1|localhost):\d{2,5}$/.test(host)||
    origin!=="http://"+host || req.headers["x-tongpin-request"]!=="1"){
    reply(res,403,{error:"same_origin_required"});return true;
  }
  try{
    const session=await localJson("/api/session");
    if(typeof session.token!=="string"||session.token.length<24)throw Error("bfc_owner_session_unavailable");
    const backup=await localJson("/api/workbench/backup",{"X-Local-CSRF":session.token});
    if(backup.type!=="workbench_backup" || !backup.state || typeof backup.state!=="object"){
      throw Error("bfc_backup_format_invalid");
    }
    const capabilities=await localJson("/api/capabilities").catch(()=>null);
    backup.exportSource="bfc-local-bridge";
    backup.completeSnapshot=capabilities?.bilibili?.completeSnapshot ?? null;
    reply(res,200,backup);
  }catch(error){
    reply(res,502,{error:"local_bfc_unavailable",detail:String(error.message||"unknown").slice(0,120)});
  }
  return true;
}

function localRequestAllowed(req,{write=false}={}) {
  if(process.env.NODE_ENV==="production" ||
     process.env.HOST && !["127.0.0.1","localhost","::1"].includes(process.env.HOST) ||
     !localAddress(req.socket.remoteAddress) || !localAddress(req.socket.localAddress))return false;
  const host=String(req.headers.host||"");
  if(!/^(127\.0\.0\.1|localhost):\d{2,5}$/.test(host))return false;
  if(req.headers["x-tongpin-local"]!=="1")return false;
  if(write && String(req.headers.origin||"")!=="http://"+host)return false;
  return true;
}
async function ownerForward(req,method,path,token,body) {
  const port=Number(process.env.TONGPIN_BFC_LOCAL_PORT||4198);
  if(!Number.isInteger(port)||port<1024||port>65535)throw Error("invalid_bfc_port");
  const base="http://127.0.0.1:"+port;
  const response=await fetch(base+path,{
    method,headers:{
      ...(token?{"X-Local-CSRF":token}:{}),
      ...(method!=="GET"?{"Content-Type":"application/json","Origin":base}:{})
    },
    body:body === undefined?undefined:JSON.stringify(body),
    cache:"no-store",redirect:"error",signal:AbortSignal.timeout(8000)
  });
  const raw=await response.text();
  if(raw.length>20_000_000)throw Error("bfc_response_too_large");
  return {status:response.status,body:JSON.parse(raw)};
}
export async function ownerBfcApi(req,res,url) {
  const route=url.pathname;
  const allowed={
    "/api/session":new Set(["GET"]),
    "/api/session/logout":new Set(["POST"]),
    "/api/workbench/state":new Set(["GET","PUT"])
  };
  if(!allowed[route])return false;
  if(!allowed[route].has(req.method)){reply(res,405,{error:"method_not_allowed"});return true;}
  const write=req.method!=="GET";
  if(!localRequestAllowed(req,{write})){reply(res,403,{error:"local_owner_only"});return true;}
  const token=String(req.headers["x-local-csrf"]||"");
  if(route!=="/api/session" && !/^[0-9a-f]{64}$/.test(token)){
    reply(res,403,{error:"owner_session_required"});return true;
  }
  try {
    let body;
    if(write){
      if(!String(req.headers["content-type"]||"").startsWith("application/json")){
        reply(res,415,{error:"json_only"});return true;
      }
      let len=0;const parts=[];
      for await(const part of req){
        len+=part.length;
        if(len>2_000_000){reply(res,413,{error:"payload_too_large"});return true;}
        parts.push(part);
      }
      body=JSON.parse(Buffer.concat(parts).toString("utf8")||"{}");
    }
    const forward=await ownerForward(req,req.method,route,token,body);
    reply(res,forward.status,forward.body);
  }catch(error){
    reply(res,502,{error:"local_bfc_unavailable",detail:String(error.message||"").slice(0,100)});
  }
  return true;
}
