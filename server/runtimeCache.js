function normalizeTtl(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function createTtlCache(options = {}) {
  const defaultTtlMs = normalizeTtl(options.ttlMs, 15000);
  const defaultStaleTtlMs = normalizeTtl(options.staleTtlMs, 0);
  const maxEntries = Math.max(1, Number.parseInt(String(options.maxEntries ?? 250), 10) || 250);
  const now = typeof options.now === "function" ? options.now : Date.now;
  const entries = new Map();
  const inflight = new Map();
  const stats = {
    hits: 0,
    staleHits: 0,
    misses: 0,
    loads: 0,
    backgroundRefreshes: 0,
    evictions: 0,
    invalidations: 0,
  };

  function pruneExpired(timestamp = now()) {
    for (const [key, entry] of entries) {
      if (entry.staleUntil <= timestamp) entries.delete(key);
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

  function getEntry(key) {
    const entry = entries.get(key);
    if (!entry) return null;
    const timestamp = now();
    if (entry.staleUntil <= timestamp) {
      entries.delete(key);
      return null;
    }
    entries.delete(key);
    entries.set(key, entry);
    return { entry, timestamp };
  }

  function get(key) {
    const state = getEntry(key);
    if (!state || state.entry.expiresAt <= state.timestamp) {
      stats.misses += 1;
      return undefined;
    }
    stats.hits += 1;
    return state.entry.value;
  }

  function set(key, value, ttlMs = defaultTtlMs, staleTtlMs = defaultStaleTtlMs) {
    const ttl = normalizeTtl(ttlMs, defaultTtlMs);
    const staleTtl = normalizeTtl(staleTtlMs, defaultStaleTtlMs);
    const expiresAt = now() + ttl;
    entries.delete(key);
    entries.set(key, { value, expiresAt, staleUntil: expiresAt + staleTtl });
    enforceLimit();
    return value;
  }

  function startLoad(key, loader, options = {}) {
    stats.loads += 1;
    const promise = Promise.resolve().then(loader).then((value) => {
      set(key, value, options.ttlMs, options.staleTtlMs);
      return value;
    }).finally(() => {
      if (inflight.get(key) === promise) inflight.delete(key);
    });
    inflight.set(key, promise);
    return promise;
  }

  async function getOrLoad(key, loader, options = {}) {
    const force = Boolean(options.force);
    const staleWhileRevalidate = Boolean(options.staleWhileRevalidate);

    if (!force) {
      const state = getEntry(key);
      if (state && state.entry.expiresAt > state.timestamp) {
        stats.hits += 1;
        return state.entry.value;
      }

      if (state && staleWhileRevalidate) {
        stats.staleHits += 1;
        if (!inflight.has(key)) {
          stats.backgroundRefreshes += 1;
          startLoad(key, loader, options).catch(() => undefined);
        }
        return state.entry.value;
      }

      const pending = inflight.get(key);
      if (pending) return pending;
      stats.misses += 1;
    }

    return startLoad(key, loader, options);
  }

  function markStale(key) {
    const entry = entries.get(key);
    if (!entry) return false;
    entry.expiresAt = Math.min(entry.expiresAt, now() - 1);
    entry.staleUntil = Math.max(entry.staleUntil, now() + defaultStaleTtlMs);
    stats.invalidations += 1;
    return true;
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

  function markPrefixStale(prefix) {
    let marked = 0;
    for (const [key, entry] of entries) {
      if (!String(key).startsWith(prefix)) continue;
      entry.expiresAt = Math.min(entry.expiresAt, now() - 1);
      entry.staleUntil = Math.max(entry.staleUntil, now() + defaultStaleTtlMs);
      marked += 1;
    }
    stats.invalidations += marked;
    return marked;
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

  return { get, set, getOrLoad, markStale, markPrefixStale, deleteKey, deletePrefix, clear, snapshot };
}
