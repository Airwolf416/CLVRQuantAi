// ── Optional Redis client for CLVRQuantAI ─────────────────────────────────────
// Uses REDIS_URL when available (Railway production).
// Gracefully falls back to null — callers must handle the null case.
// SAFETY: Rejects the literal string "undefined" that Railway can inject before
// a Redis add-on is fully provisioned.

import Redis from "ioredis";

let _client: Redis | null = null;
let _connecting = false;

function isValidRedisUrl(url: string | undefined): url is string {
  return (
    typeof url === "string" &&
    url.length > 0 &&
    url !== "undefined" &&
    url !== "null" &&
    (url.startsWith("redis://") || url.startsWith("rediss://"))
  );
}

export function getRedis(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!isValidRedisUrl(url)) return null;
  if (_client) return _client;
  if (_connecting) return null;

  _connecting = true;
  try {
    _client = new Redis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
      retryStrategy: (times) => {
        if (times > 10) return null;
        return Math.min(times * 200, 5000);
      },
    });

    _client.on("connect", () => console.log("[redis] Connected"));
    _client.on("ready",   () => console.log("[redis] Ready"));
    _client.on("close",   () => console.log("[redis] Connection closed"));
    _client.on("error",   (err) => {
      console.warn("[redis] Connection error (non-fatal):", err.message);
    });
    _client.on("end", () => {
      console.warn("[redis] Connection ended — resetting client");
      _client = null;
      _connecting = false;
    });

    _client.connect().catch((err) => {
      console.warn("[redis] Initial connect failed (non-fatal):", err.message);
      _client = null;
      _connecting = false;
    });
  } catch (err: any) {
    console.warn("[redis] Failed to create Redis client (non-fatal):", err.message);
    _client = null;
    _connecting = false;
    return null;
  }

  return _client;
}

// ── JSON get/set helpers ──────────────────────────────────────────────────────

export async function rGet<T = any>(key: string): Promise<T | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    const val = await r.get(key);
    return val ? (JSON.parse(val) as T) : null;
  } catch {
    return null;
  }
}

export async function rSet(key: string, value: any, ttlSeconds?: number): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    const str = JSON.stringify(value);
    if (ttlSeconds) await r.set(key, str, "EX", ttlSeconds);
    else await r.set(key, str);
  } catch { /* non-fatal */ }
}

export async function rDel(key: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try { await r.del(key); } catch { /* non-fatal */ }
}

// ── Hash helpers (for large nested objects) ───────────────────────────────────

export async function rHSet(hash: string, field: string, value: any): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try { await r.hset(hash, field, JSON.stringify(value)); } catch { /* non-fatal */ }
}

export async function rHGet<T = any>(hash: string, field: string): Promise<T | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    const val = await r.hget(hash, field);
    return val ? (JSON.parse(val) as T) : null;
  } catch { return null; }
}

export async function rHGetAll<T = any>(hash: string): Promise<Record<string, T> | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    const raw = await r.hgetall(hash);
    if (!raw) return null;
    const out: Record<string, T> = {};
    for (const [k, v] of Object.entries(raw)) {
      try { out[k] = JSON.parse(v) as T; } catch { /* skip malformed */ }
    }
    return out;
  } catch { return null; }
}

// ── Pub/Sub connection (separate connection as required by ioredis) ─────────

let _sub: Redis | null = null;

export function getRedisSub(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!isValidRedisUrl(url)) return null;
  if (_sub) return _sub;

  try {
    _sub = new Redis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    _sub.on("error", (err) => {
      console.warn("[redis-sub] Error (non-fatal):", err.message);
    });
    _sub.on("end", () => { _sub = null; });
    _sub.connect().catch((err) => {
      console.warn("[redis-sub] Initial connect failed (non-fatal):", err.message);
      _sub = null;
    });
  } catch (err: any) {
    console.warn("[redis-sub] Failed to create sub client (non-fatal):", err.message);
    _sub = null;
    return null;
  }

  return _sub;
}

export async function closeRedis(): Promise<void> {
  try { if (_client) { await _client.quit(); _client = null; } } catch { /* ignore */ }
  try { if (_sub)    { await _sub.quit();    _sub    = null; } } catch { /* ignore */ }
}
