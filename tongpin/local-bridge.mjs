// Explicit, local-owner-only bridge for importing a copy of BFC data.
// In production and on non-loopback connections this endpoint is unavailable.
import {isIP} from "node:net";

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
    reply(res,200,backup);
  }catch(error){
    reply(res,502,{error:"local_bfc_unavailable",detail:String(error.message||"unknown").slice(0,120)});
  }
  return true;
}
