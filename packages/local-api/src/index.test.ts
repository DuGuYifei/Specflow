import { describe, expect, it } from "vitest";
import { buildLocalApi } from "./index.js";

describe("local API routes", () => {
  it("responds to health checks", async () => {
    const localApi = buildLocalApi();
    const response = await localApi.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      service: "specflow-local-api"
    });
  });
});
