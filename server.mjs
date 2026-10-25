import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 4173);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8" };

createServer(async (request, response) => {
  const pathname = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`).pathname;
  const relative = pathname === "/" || pathname === "/index.html" ? "studio.html" : pathname.replace(/^\//, "");
  const file = normalize(join(root, relative));
  if (!file.startsWith(root)) { response.writeHead(403); response.end("Forbidden"); return; }
  try {
    const body = await readFile(file);
    response.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}).listen(port, "127.0.0.1", () => console.log(`BFC Web 已启动：http://127.0.0.1:${port}/`));
