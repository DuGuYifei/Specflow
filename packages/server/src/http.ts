import { createSpecflowBridge } from "@specflow/bridge";
import { APP_NAME, DEFAULT_HOST, SERVER_PORT } from "@specflow/shared";
import { serveStaticUi } from "./static-ui";
import { createDevUiProxy } from "./ui-dev";
import { initWorkspace } from "./workspace";

export interface SpecflowServerOptions {
  host?: string;
  port?: number;
  mode?: "development" | "production";
}

export interface RunningSpecflowServer {
  url: string;
  stop(): void;
}

export async function startSpecflowServer(
  options: SpecflowServerOptions = {},
): Promise<RunningSpecflowServer> {
  await initWorkspace();
  const host = options.host ?? DEFAULT_HOST;
  const preferredPort = options.port ?? SERVER_PORT;
  const mode =
    options.mode ?? (process.env.NODE_ENV === "production" ? "production" : "development");
  const bridge = createSpecflowBridge();
  const devUi = mode === "development" ? await createDevUiProxy() : undefined;

  const server = startHttpServer({
    bridge,
    devUi,
    host,
    preferredPort,
  });

  const url = `http://${host}:${server.port}/`;
  console.log(`${APP_NAME} UI: ${url}`);

  return {
    url,
    stop() {
      devUi?.stop();
      server.stop();
    },
  };
}

interface HttpServerOptions {
  bridge: ReturnType<typeof createSpecflowBridge>;
  devUi?: Awaited<ReturnType<typeof createDevUiProxy>>;
  host: string;
  preferredPort: number;
}

function startHttpServer({ bridge, devUi, host, preferredPort }: HttpServerOptions) {
  for (let port = preferredPort; port < preferredPort + 20; port += 1) {
    try {
      return Bun.serve({
        hostname: host,
        port,
        reusePort: false,
        async fetch(request) {
          const url = new URL(request.url);

          if (url.pathname === "/api/health") {
            return Response.json({
              app: APP_NAME,
              ok: true,
              sessions: bridge.sessions.list().length,
              startedAt: bridge.runtime.startedAt.toISOString(),
            });
          }

          if (devUi) {
            return devUi.fetch(request);
          }

          return serveStaticUi(request);
        },
      });
    } catch (error) {
      if (port === preferredPort + 19) {
        throw error;
      }
    }
  }

  throw new Error("Unable to start the Specflow server.");
}
