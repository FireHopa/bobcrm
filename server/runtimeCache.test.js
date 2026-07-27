import test from "node:test";
import assert from "node:assert/strict";
import { createTtlCache } from "./runtimeCache.js";

test("cache TTL entrega hit e expira sem manter valor obsoleto", async () => {
  let clock = 1000;
  let loads = 0;
  const cache = createTtlCache({ ttlMs: 50, now: () => clock });
  const load = () => { loads += 1; return `v${loads}`; };
  assert.equal(await cache.getOrLoad("a", load), "v1");
  assert.equal(await cache.getOrLoad("a", load), "v1");
  clock += 51;
  assert.equal(await cache.getOrLoad("a", load), "v2");
  assert.equal(loads, 2);
});

test("cache deduplica carregamentos simultâneos do mesmo recurso", async () => {
  const cache = createTtlCache();
  let loads = 0;
  const loader = async () => {
    loads += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { ok: true };
  };
  const [a, b, c] = await Promise.all([
    cache.getOrLoad("same", loader),
    cache.getOrLoad("same", loader),
    cache.getOrLoad("same", loader),
  ]);
  assert.deepEqual(a, { ok: true });
  assert.equal(a, b);
  assert.equal(b, c);
  assert.equal(loads, 1);
});

test("invalidação por prefixo remove somente o domínio solicitado", () => {
  const cache = createTtlCache();
  cache.set("teams:all", [1]);
  cache.set("team-members:t1", [2]);
  cache.set("users:assignable", [3]);
  assert.equal(cache.deletePrefix("team"), 2);
  assert.equal(cache.get("teams:all"), undefined);
  assert.equal(cache.get("team-members:t1"), undefined);
  assert.deepEqual(cache.get("users:assignable"), [3]);
});

test("limite de entradas evita crescimento indefinido", () => {
  const cache = createTtlCache({ maxEntries: 2 });
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("c", 3);
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.snapshot().entries, 2);
});
