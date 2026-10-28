import { describe, expect, it } from "vitest";
import { mainThreadParser, workerParser, type PasteRequest, type PasteResponse } from "./client.js";
import { buildPastePreview } from "./preview.js";

const TEXT = "Kopf\nRunde 1: 6 fM in den Fadenring (6)\nRunde 2: 6 Zun (12)";

/** A worker stand-in that answers requests when told to. */
class FakeWorker {
  onmessage: ((e: MessageEvent<PasteResponse>) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  requests: PasteRequest[] = [];
  terminated = false;
  postMessage(message: PasteRequest) {
    this.requests.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  answer(request: PasteRequest) {
    this.onmessage?.({ data: { id: request.id, preview: buildPastePreview(request.text, request.choice) } } as MessageEvent<PasteResponse>);
  }
}

describe("paste parser", () => {
  it("computes on the main thread", async () => {
    const preview = await mainThreadParser().parse(TEXT, "auto");
    expect(preview.parts[0]!.name).toBe("Kopf");
  });

  it("matches worker answers to their requests", async () => {
    const fake = new FakeWorker();
    const parser = workerParser(() => fake);
    const first = parser.parse(TEXT, "auto");
    const second = parser.parse(`${TEXT}\nRunde 3: 12 fM (12)`, "de");
    expect(fake.requests.map((r) => r.id)).toEqual([1, 2]);
    fake.answer(fake.requests[1]!);
    fake.answer(fake.requests[0]!);
    expect((await second).counts.stitchRows).toBe(3);
    expect((await first).counts.stitchRows).toBe(2);
    parser.dispose();
    expect(fake.terminated).toBe(true);
  });

  it("falls back to the main thread when the worker fails", async () => {
    const fake = new FakeWorker();
    const parser = workerParser(() => fake);
    const pending = parser.parse(TEXT, "auto");
    fake.onerror?.(new Event("error"));
    expect((await pending).parts).toHaveLength(1);
    expect(fake.terminated).toBe(true);
    // Later requests do not try the worker again.
    await parser.parse(TEXT, "auto");
    expect(fake.requests).toHaveLength(1);
  });

  it("falls back when the worker cannot be created", async () => {
    const parser = workerParser(() => {
      throw new Error("CSP");
    });
    expect((await parser.parse(TEXT, "auto")).parts).toHaveLength(1);
  });
});
