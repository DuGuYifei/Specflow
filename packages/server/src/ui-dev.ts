import { DEV_UI_PORT } from "@specflow/shared";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export interface DevUiProxy {
  fetch(request: Request): Promise<Response>;
  stop(): void;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, "../../..");
const uiRoot = resolve(currentDir, "../../ui");
const viteBin = resolve(repoRoot, "node_modules/vite/bin/vite.js");

export async function createDevUiProxy(): Promise<DevUiProxy> {
  const vite = spawn("bun", [
    viteBin,
    "--host",
    "127.0.0.1",
    "--port",
    String(DEV_UI_PORT),
    "--strictPort",
    "--logLevel",
    "error",
  ], {
    cwd: uiRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  vite.stdout?.on("data", (chunk) => process.stdout.write(chunk));
  vite.stderr?.on("data", (chunk) => process.stderr.write(chunk));

  await waitForDevUi();

  return {
    fetch(request) {
      const sourceUrl = new URL(request.url);
      const targetUrl = new URL(sourceUrl.pathname + sourceUrl.search, `http://127.0.0.1:${DEV_UI_PORT}`);

      return fetch(targetUrl, {
        body: request.body,
        headers: request.headers,
        method: request.method,
        redirect: "manual",
      });
    },
    stop() {
      stopChild(vite);
    },
  };
}

async function waitForDevUi() {
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${DEV_UI_PORT}/`);
      if (response.ok) {
        return;
      }
    } catch {
      await Bun.sleep(100);
    }
  }

  throw new Error("Timed out waiting for the UI dev server.");
}

function stopChild(child: ChildProcess) {
  if (!child.killed) {
    child.kill();
  }
}
