import { describe, expect, test } from "bun:test";
import { StdinLineReader } from "./stdin-lines";

describe("StdinLineReader", () => {
  test("reads consecutive prompts from one stdin stream", async () => {
    const reader = new StdinLineReader(streamOf("1\n6\n"));

    expect(await reader.readLine()).toBe("1");
    expect(await reader.readLine()).toBe("6");
  });

  test("buffers partial and trailing stdin input", async () => {
    const reader = new StdinLineReader(streamOf("co", "de\nagent", "\nlast"));

    expect(await reader.readLine()).toBe("code");
    expect(await reader.readLine()).toBe("agent");
    expect(await reader.readLine()).toBe("last");
  });
});

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}
