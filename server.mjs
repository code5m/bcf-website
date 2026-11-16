import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {extname, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";
import {createSocialApi} from "./tongpin/api.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const social = createSocialApi({dataDir: process.env.TONGPIN_DATA_DIR || resolve(root, "runtime/social")});
const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml"
};
createServer(async (request, response) => {
  let url;
  try { url = new URL(request.url || "/", "http://" + (request.headers.host || "127.0.0.1")); }
  catch { response.writeHead(400); response.end("Bad request"); return; }
  if (url.pathname.startsWith("/api/social/")) {
    await social(request, response, url);
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, {"Allow":"GET, HEAD"}); response.end(); return;
  }
  const relative = url.pathname === "/" || url.pathname === "/index.html" ? "studio.html"
    : url.pathname === "/tongpin" || url.pathname === "/tongpin/" ? "tongpin/index.html"
    : url.pathname.replace(/^\/+/, "");
  const file = resolve(root, relative);
  if (!(file === root || file.startsWith(root + sep))) {
    response.writeHead(403); response.end("Forbidden"); return;
  }
  if (relative.startsWith("runtime/") || relative.startsWith(".") ||
      /(^|\/)(node_modules|tests|\.git)(\/|$)/.test(relative) || relative.endsWith(".mjs")) {
    response.writeHead(404); response.end("Not found"); return;
  }
  try {
    const body = await readFile(file);
    response.writeHead(200, {
      "Content-Type": types[extname(file)] || "application/octet-stream",
      "Cache-Control": relative.startsWith("tongpin/") ? "no-cache" : "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY"
    });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch {
    response.writeHead(404, {"Content-Type":"text/plain; charset=utf-8"});
    response.end("Not found");
  }
}).listen(port, host, () => console.log("BFC 与同频已启动：http://" + host + ":" + port + "/"));
