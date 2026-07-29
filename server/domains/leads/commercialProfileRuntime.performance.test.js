import test from "node:test";
import assert from "node:assert/strict";
import { createCommercialProfileRuntime } from "./commercialProfileRuntime.js";

test("runtime comercial não sobrepõe scans de prontidão", async () => {
  let release;
  let calls = 0;
  const blocker = new Promise((resolve) => { release = resolve; });
  const runtime = createCommercialProfileRuntime({
    queryFirst: async () => {
      calls += 1;
      await blocker;
      return { id: "lead-1" };
    },
    execute: async () => undefined,
    nowIso: () => new Date().toISOString(),
    logger: { log() {} },
  });

  const first = runtime.refreshReadiness();
  const second = runtime.refreshReadiness();
  await Promise.resolve();
  assert.equal(calls, 1);
  release();
  assert.equal(await first, false);
  assert.equal(await second, false);
  assert.equal(calls, 1);
});
