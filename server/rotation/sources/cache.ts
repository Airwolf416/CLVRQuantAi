import { rGet, rSet } from "../../services/redis";
import { ROTATION_CONFIG } from "../config";
import type { RotationSourceResult } from "../types";

type CacheRecord<T> = { data: T; asOf: string; storedAt: number };
const memory = new Map<string, CacheRecord<unknown>>();
const inFlight = new Map<string, Promise<RotationSourceResult<unknown>>>();

type CacheOptions<T> = {
  key: string;
  ttlSeconds: number;
  load: () => Promise<unknown>;
  validate: (value: unknown) => value is T;
  timestamp: (value: T) => string | null;
  now?: () => number;
};

export async function cachedRotationSource<T>(
  options: CacheOptions<T>,
): Promise<RotationSourceResult<T>> {
  const now = options.now || Date.now;
  const cached = await rGet<CacheRecord<T>>(options.key);
  const local = memory.get(options.key) as CacheRecord<T> | undefined;
  const existing = cached && options.validate(cached.data) ? cached
    : local && options.validate(local.data) ? local : undefined;

  if (existing && now() - existing.storedAt < options.ttlSeconds * 1000) {
    return { data: existing.data, asOf: existing.asOf, stale: false };
  }

  const pending = inFlight.get(options.key);
  if (pending) return await pending as RotationSourceResult<T>;

  const work: Promise<RotationSourceResult<T>> = (async () => {
    try {
      const raw = await options.load();
      if (!options.validate(raw)) throw new Error("Source returned an invalid payload");
      const record: CacheRecord<T> = {
        data: raw,
        asOf: options.timestamp(raw) || new Date(now()).toISOString(),
        storedAt: now(),
      };
      memory.set(options.key, record);
      await rSet(options.key, record, ROTATION_CONFIG.source.staleCacheTtlSeconds);
      return { data: record.data, asOf: record.asOf, stale: false };
    } catch (error) {
      const staleWindowMs = ROTATION_CONFIG.source.staleCacheTtlSeconds * 1000;
      if (existing && now() - existing.storedAt <= staleWindowMs) {
        return {
          data: existing.data,
          asOf: existing.asOf,
          stale: true,
          lastGoodAt: existing.asOf,
          error: error instanceof Error ? error.message : "Source request failed",
        };
      }
      throw error;
    }
  })();

  inFlight.set(options.key, work as Promise<RotationSourceResult<unknown>>);
  try {
    return await work;
  } finally {
    inFlight.delete(options.key);
  }
}

export async function fetchJson(
  url: string,
  sourceName: string,
  headers: Record<string, string> = {},
): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, {
      headers: { "User-Agent": "CLVRQuantAI-RotationBrain/1.0", ...headers },
      signal: AbortSignal.timeout(ROTATION_CONFIG.source.requestTimeoutMs),
    });
    if (response.ok) return response.json();
    if (attempt >= ROTATION_CONFIG.source.maxRetries || ![429, 500, 502, 503, 504].includes(response.status)) {
      throw new Error(`${sourceName} returned HTTP ${response.status}`);
    }
    const retryAfter = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 10_000)
      : ROTATION_CONFIG.source.retryBaseMs * (2 ** attempt) * (0.75 + Math.random() * 0.5);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}

export async function fetchText(url: string, sourceName: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CLVRQuantAI-RotationBrain/1.0)" },
      signal: AbortSignal.timeout(ROTATION_CONFIG.source.requestTimeoutMs),
    });
    if (response.ok) return response.text();
    if (attempt >= ROTATION_CONFIG.source.maxRetries || ![429, 500, 502, 503, 504].includes(response.status)) {
      throw new Error(`${sourceName} returned HTTP ${response.status}`);
    }
    const retryAfter = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 10_000)
      : ROTATION_CONFIG.source.retryBaseMs * (2 ** attempt) * (0.75 + Math.random() * 0.5);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}
