import assert from "node:assert/strict";
import test from "node:test";
import { createTtlCache } from "./runtimeCache.js";

test("cache reutiliza valor dentro do TTL", async () => {
  let now = 1000;
  let loads = 0;
  const cache = createTtlCache({ ttlMs: 100, staleTtlMs: 500, now: () => now });
  const loader = async () => ++loads;

  assert.equal(await cache.getOrLoad("a", loader), 1);
  assert.equal(await cache.getOrLoad("a", loader), 1);
  assert.equal(loads, 1);
  assert.equal(cache.snapshot().hits, 1);
});

test("stale-while-revalidate responde imediatamente e atualiza em background", async () => {
  let now = 1000;
  let loads = 0;
  const cache = createTtlCache({ ttlMs: 100, staleTtlMs: 500, now: () => now });
  const loader = async () => ++loads;

  assert.equal(await cache.getOrLoad("a", loader), 1);
  now = 1150;
  assert.equal(await cache.getOrLoad("a", loader, { staleWhileRevalidate: true }), 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loads, 2);
  assert.equal(await cache.getOrLoad("a", loader), 2);
  assert.equal(cache.snapshot().staleHits, 1);
  assert.equal(cache.snapshot().backgroundRefreshes, 1);
});

test("markStale preserva snapshot para SWR", async () => {
  let now = 1000;
  let loads = 0;
  const cache = createTtlCache({ ttlMs: 100, staleTtlMs: 500, now: () => now });
  const loader = async () => ++loads;

  assert.equal(await cache.getOrLoad("scope", loader), 1);
  assert.equal(cache.markStale("scope"), true);
  assert.equal(await cache.getOrLoad("scope", loader, { staleWhileRevalidate: true }), 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loads, 2);
});

test("entrada é removida depois da janela stale", async () => {
  let now = 1000;
  let loads = 0;
  const cache = createTtlCache({ ttlMs: 100, staleTtlMs: 200, now: () => now });
  const loader = async () => ++loads;

  await cache.getOrLoad("a", loader);
  now = 1400;
  assert.equal(await cache.getOrLoad("a", loader, { staleWhileRevalidate: true }), 2);
});
