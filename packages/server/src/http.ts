import { AgentServerStore } from "@specflow/agent-proxy";
import { createSpecflowBridge } from "@specflow/bridge";
import { APP_NAME, DEFAULT_HOST, SERVER_PORT } from "@specflow/shared";
import { serveStaticUi } from "./static-ui";
import { SkillStore, resolveSlashCommands } from "./skills";
import { createDevUiProxy } from "./ui-dev";
import { initWorkspace } from "./workspace";
import { createApiHandler } from "./api";

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
  const cwd = process.cwd();
  await initWorkspace(cwd, { createIfMissing: true });

  const host = options.host ?? DEFAULT_HOST;
  const preferredPort = options.port ?? SERVER_PORT;
  const mode = options.mode ?? defaultServerMode();
  const skillStore = new SkillStore({ root: cwd });
  const capabilityStore = new AgentServerStore({ root: cwd });
  const bridge = createSpecflowBridge({
    promptTransformer: async (prompt, context) => {
      // Skip the work if there are no `/` candidates at all — keeps the hot
      // path zero-allocation when no slash commands are present.
      if (!prompt.includes("/")) return prompt;
      const [skills, capabilities] = await Promise.all([
        skillStore.list(),
        capabilityStore.getCapabilities(context.agentServerId),
      ]);
      const resolved = resolveSlashCommands({
        prompt,
        skills,
        availableCommands: capabilities?.availableCommands,
      });
      return resolved.prompt;
    },
  });
  const devUi = mode === "development" ? await createDevUiProxy() : undefined;
  const handleApi = createApiHandler(bridge, cwd);

  const server = startHttpServer({ bridge, devUi, host, preferredPort, handleApi });

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

function defaultServerMode(): "development" | "production" {
  const explicitMode = process.env["SPECFLOW_SERVER_MODE"];
  if (explicitMode === "development" || explicitMode === "production") {
    return explicitMode;
  }

  const nodeEnv = process.env["NODE_ENV"];
  if (nodeEnv === "development") return "development";
  if (nodeEnv === "production") return "production";

  return "production";
}

interface HttpServerOptions {
  bridge: ReturnType<typeof createSpecflowBridge>;
  devUi?: Awaited<ReturnType<typeof createDevUiProxy>>;
  host: string;
  preferredPort: number;
  handleApi: (req: Request) => Promise<Response | null>;
}

function startHttpServer({ bridge, devUi, host, preferredPort, handleApi }: HttpServerOptions) {
  for (let port = preferredPort; port < preferredPort + 20; port += 1) {
    try {
      return Bun.serve({
        hostname: host,
        port,
        reusePort: false,
        async fetch(request, server) {
          const url = new URL(request.url);

          if (url.pathname === "/api/health") {
            return Response.json({
              app: APP_NAME,
              ok: true,
              sessions: bridge.sessions.list().length,
              startedAt: bridge.runtime.startedAt.toISOString(),
            });
          }

          const apiResponse = await handleApi(request);
          if (apiResponse) {
            if (apiResponse.headers.get("content-type")?.startsWith("text/event-stream")) {
              server.timeout(request, 0);
            }
            return apiResponse;
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
