import { file, type BunFile } from "bun";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, resolve } from "node:path";

const currentDir = dirname(fileURLToPath(import.meta.url));
const uiDist = resolve(currentDir, "../../ui/dist");

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
]);

export function serveStaticUi(request: Request): Response {
  const url = new URL(request.url);
  const pathname = decodeURIComponent(url.pathname);
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const candidate = resolve(uiDist, `.${safePath}`);

  if (!candidate.startsWith(uiDist)) {
    return new Response("Not found", { status: 404 });
  }

  if (existsSync(candidate)) {
    return fileResponse(file(candidate));
  }

  return fileResponse(file(join(uiDist, "index.html")));
}

function fileResponse(asset: BunFile): Response {
  const contentType = contentTypes.get(extname(asset.name ?? ""));
  return new Response(asset, {
    headers: contentType ? { "content-type": contentType } : undefined,
  });
}
