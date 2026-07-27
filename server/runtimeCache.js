function normalizeTtl(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function createTtlCache(options = {}) {
  const defaultTtlMs = normalizeTtl(options.ttlMs, 15000);
  const maxEntries = Math.max(1, Number.parseInt(String(options.maxEntries ?? 250), 10) || 250);
  const now = typeof options.now === "function" ? options.now : Date.now;
  const entries = new Map();
  const inflight = new Map();
  const stats = { hits: 0, misses: 0, loads: 0, evictions: 0, invalidations: 0 };

  function pruneExpired(timestamp = now()) {
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= timestamp) entries.delete(key);
    }
  }

  function enforceLimit() {
    while (entries.size > maxEntries) {
      const oldestKey = entries.keys().next().value;
      if (oldestKey === undefined) break;
      entries.delete(oldestKey);
      stats.evictions += 1;
    }
  }

  function get(key) {
    const entry = entries.get(key);
    if (!entry) {
      stats.misses += 1;
      return undefined;
    }
    if (entry.expiresAt <= now()) {
      entries.delete(key);
      stats.misses += 1;
      return undefined;
    }
    // Reinsert to approximate LRU while keeping implementation tiny.
    entries.delete(key);
    entries.set(key, entry);
    stats.hits += 1;
    return entry.value;
  }

  function set(key, value, ttlMs = defaultTtlMs) {
    const ttl = normalizeTtl(ttlMs, defaultTtlMs);
    entries.delete(key);
    entries.set(key, { value, expiresAt: now() + ttl });
    enforceLimit();
    return value;
  }

  async function getOrLoad(key, loader, options = {}) {
    const force = Boolean(options.force);
    if (!force) {
      const cached = get(key);
      if (cached !== undefined) return cached;
      const pending = inflight.get(key);
      if (pending) return pending;
    }

    stats.loads += 1;
    const promise = Promise.resolve().then(loader).then((value) => {
      set(key, value, options.ttlMs);
      return value;
    }).finally(() => {
      if (inflight.get(key) === promise) inflight.delete(key);
    });
    inflight.set(key, promise);
    return promise;
  }

  function deleteKey(key) {
    const deleted = entries.delete(key);
    if (deleted) stats.invalidations += 1;
    return deleted;
  }

  function deletePrefix(prefix) {
    let deleted = 0;
    for (const key of entries.keys()) {
      if (String(key).startsWith(prefix)) {
        entries.delete(key);
        deleted += 1;
      }
    }
    stats.invalidations += deleted;
    return deleted;
  }

  function clear() {
    const deleted = entries.size;
    entries.clear();
    stats.invalidations += deleted;
    return deleted;
  }

  function snapshot() {
    pruneExpired();
    return { ...stats, entries: entries.size, inflight: inflight.size };
  }

  return { get, set, getOrLoad, deleteKey, deletePrefix, clear, snapshot };
}
