import Fastify from "fastify";
import {
  CONTINUOUS_CODING_CATEGORY,
  PHASE_ZERO_NAME,
  formatPhaseZeroFlow
} from "@specflow/shared";

export function buildLocalApi() {
  const localApi = Fastify({
    logger: true
  });

  localApi.get("/health", async () => ({
    status: "ok",
    service: "specflow-local-api"
  }));

  localApi.get("/api/project", async () => ({
    name: "Specflow",
    category: CONTINUOUS_CODING_CATEGORY,
    phase: PHASE_ZERO_NAME,
    flow: formatPhaseZeroFlow(),
    runtime: "placeholder"
  }));

  return localApi;
}

async function start(): Promise<void> {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "127.0.0.1";
  const localApi = buildLocalApi();

  await localApi.listen({ port, host });
}

if (process.argv[1]?.endsWith("index.ts") || process.argv[1]?.endsWith("index.js")) {
  await start();
}
