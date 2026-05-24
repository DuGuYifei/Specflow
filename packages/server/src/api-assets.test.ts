import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createSpecflowBridge } from "@specflow/bridge";
import { createApiHandler } from "./api";

describe("canvas asset API", () => {
  test("stores image inputs as stable workflow assets", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-assets-"));
    const handle = createApiHandler(createSpecflowBridge(), root);
    const form = new FormData();
    form.append("files", new File([new Uint8Array([1, 2, 3])], "pasted.png", { type: "image/png" }));
    form.append("relativePaths", "pasted.png");

    const response = await handle(new Request("http://specflow.test/api/canvases/wf/assets?kind=image", {
      method: "POST",
      body: form,
    }));
    const body = await response!.json() as { images: Array<{ path: string; label: string; mimeType: string }> };

    expect(response?.status).toBe(200);
    expect(body.images[0]).toMatchObject({ label: "pasted.png", mimeType: "image/png" });
    expect(body.images[0]!.path).toContain(".specflow/assets/wf/images/");
    expect(new Uint8Array(await readFile(join(root, body.images[0]!.path)))).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("preserves selected folder paths under workflow resources", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-resources-"));
    const handle = createApiHandler(createSpecflowBridge(), root);
    const form = new FormData();
    form.append("files", new File(["button"], "button.ts", { type: "text/plain" }));
    form.append("relativePaths", "components/button.ts");
    form.append("files", new File(["card"], "card.ts", { type: "text/plain" }));
    form.append("relativePaths", "components/cards/card.ts");

    const response = await handle(new Request("http://specflow.test/api/canvases/wf/assets?kind=path&directory=true", {
      method: "POST",
      body: form,
    }));
    const body = await response!.json() as { paths: string[] };

    expect(response?.status).toBe(200);
    expect(body.paths).toEqual([".specflow/assets/wf/resources/components/"]);
    expect(await readFile(join(root, ".specflow/assets/wf/resources/components/button.ts"), "utf8")).toBe("button");
    expect(await readFile(join(root, ".specflow/assets/wf/resources/components/cards/card.ts"), "utf8")).toBe("card");
  });
});
