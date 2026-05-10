import { extname } from "node:path";

const distPrefix = "../../ui/dist";

// import.meta.glob is a bundler-only transform (bun build --compile).
// Under `bun run` it is undefined; dev mode never calls serveStaticUi so {} is safe.
let files: Record<string, string> = {};
try {
  files = import.meta.glob<string>("../../ui/dist/**/*", { as: "file", eager: true });
} catch { /* not in bundled context */ }

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
  const suffix = decodeURIComponent(url.pathname);
  const normalized = suffix === "/" ? "/index.html" : suffix;
  const key = `${distPrefix}${normalized}`;

  const embeddedPath = files[key];
  if (embeddedPath) {
    const contentType = contentTypes.get(extname(normalized));
    return new Response(Bun.file(embeddedPath), {
      headers: contentType ? { "content-type": contentType } : undefined,
    });
  }

  // SPA fallback: unknown routes serve index.html
  return new Response(Bun.file(files[`${distPrefix}/index.html`]), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
