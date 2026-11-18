import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {extname, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";
import {createSocialApi} from "./tongpin/api.mjs";
import {localBfcImport,ownerBfcApi} from "./tongpin/local-bridge.mjs";

if (process.env.NODE_ENV === "production") {
  const origin=process.env.TONGPIN_PUBLIC_ORIGIN || "";
  if (!origin.startsWith("https://") || !process.env.TONGPIN_ADMIN_TOKEN ||
      process.env.TONGPIN_ADMIN_TOKEN.length < 32 || process.env.TONGPIN_INVITE_ONLY !== "1") {
    throw Error("Production requires HTTPS origin, admin token and invite-only registration");
  }
}
const root=resolve(fileURLToPath(new URL(".",import.meta.url)));
const port=Number(process.env.PORT || 4173);
const host=process.env.HOST || "127.0.0.1";
const social=createSocialApi({dataDir:process.env.TONGPIN_DATA_DIR || resolve(root,"runtime/social")});
const types={
  ".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",
  ".webmanifest":"application/manifest+json",".svg":"image/svg+xml"
};
const rootAssets=new Set([
  "studio.html","studio.css","studio.js","index.html","app.js","style.css",
  "navigation.js","library-state.js","local-library.js","topic-recipes.js",
  "monitor.js","progress-report.js","evidence-review.js","full-review.js",
  "expanded-triage.js","historical-gaps.js","readback-tool.js","saved-page-import.js",
  "saved-page-parser.js"
]);
const tongpinAssets=new Set([
  "index.html","app.js","app.css","core.js","browseros-import.js","demo.js","sw.js","manifest.webmanifest","icon.svg",
  "terms.html","admin.html","admin.js"
]);
const securityHeaders={
  "X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"no-referrer","X-Frame-Options":"DENY",
  "Permissions-Policy":"camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy":"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'"
};
const app=createServer(async(req,res)=>{
  let url;
  try{url=new URL(req.url || "/","http://"+(req.headers.host||"127.0.0.1"));}
  catch{res.writeHead(400);res.end("Bad request");return;}
  try{
    if(url.pathname.startsWith("/api/social/")) {await social(req,res,url);return;}
    if(await ownerBfcApi(req,res,url))return;
    if(url.pathname.startsWith("/api/local/")) {
      if(!await localBfcImport(req,res,url)){
        res.writeHead(404);res.end("Not found");
      }
      return;
    }
    if(req.method!=="GET"&&req.method!=="HEAD"){
      res.writeHead(405,{"Allow":"GET, HEAD"});res.end();return;
    }
    const relative=url.pathname==="/"||url.pathname==="/index.html" ?
      (process.env.NODE_ENV==="production"?"tongpin/index.html":"studio.html") :
      url.pathname==="/manage"?"index.html":
      url.pathname==="/tongpin"||url.pathname==="/tongpin/"?"tongpin/index.html":
      url.pathname.replace(/^\/+/,"");
    // Prevent serving configs, keys, history, source, private account data or tests.
    const permitted=relative.startsWith("tongpin/") ?
      tongpinAssets.has(relative.slice("tongpin/".length)) : rootAssets.has(relative);
    if(!permitted){res.writeHead(404,securityHeaders);res.end("Not found");return;}
    const file=resolve(root,relative);
    if(!file.startsWith(root+sep)){res.writeHead(403);res.end("Forbidden");return;}
    const body=await readFile(file);
    res.writeHead(200,{
      "Content-Type":types[extname(file)] || "application/octet-stream",
      "Cache-Control":relative==="tongpin/sw.js"?"no-cache":"no-store",
      ...securityHeaders
    });
    res.end(req.method==="HEAD"?undefined:body);
  }catch(error){
    if(!res.headersSent){
      if(error?.code==="ENOENT"){res.writeHead(404,securityHeaders);res.end("Not found");}
      else{console.error("[tongpin server]",error?.message||error);res.writeHead(500,securityHeaders);res.end("Internal error");}
    }
  }
});
app.listen(port,host,()=>console.log("BFC 与同频：http://"+host+":"+port+"/"));
