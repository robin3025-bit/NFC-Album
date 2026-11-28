import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const files = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css"]],
  ["/themes.json", ["themes.json", "application/json"]],
  ...["app", "player", "drive", "config"].map(name => [`/${name}.js`, [`${name}.js`, "text/javascript"]]),
]);
const port = Number(process.argv[2] || 8765);
createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const image = /^\/backgrounds\/[\w-]+\.(webp|svg|png|jpe?g|avif)$/i.exec(pathname);
    const types = { webp: "image/webp", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", avif: "image/avif" };
    const file = files.get(pathname) ?? (image && [pathname.slice(1), types[image[1].toLowerCase()]]);
    if (!file) { response.writeHead(404).end(); return; }
    const body = await readFile(new URL(file[0], import.meta.url));
    response.writeHead(200, { "Content-Type": file[1], "Cache-Control": "no-store" }).end(body);
  } catch { response.writeHead(500).end(); }
}).listen(port, "127.0.0.1", () => console.log(`Local http://127.0.0.1:${port}/`));
