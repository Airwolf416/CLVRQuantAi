# Rotation Brain implementation plan

Scope is limited to Phase 1 (data layer) of the supplied Rotation Brain specification. Existing signal, regime, macro-risk, Redis, PostgreSQL, and scheduling systems are reused; this phase does not calculate or publish trading biases.

## Existing systems reviewed

- Signal generation and macro-risk checks are in `server/routes.ts`; the existing BTC-flush guard is `server/lib/circuitBreaker.ts`.
- Archetype classification already lives in `server/lib/archetype.ts`.
- Redis is optional and accessed through `server/services/redis.ts`; recurring BullMQ workers use `server/workers/queue.ts`.
- Startup migrations run through `server/initDb.ts`, before workers are started in `server/index.ts`.
- Fear & Greed already has a live Alternative.me adapter in `server/databus.ts`; FMP's existing stable API adapter is `server/services/fmp.ts`.
- This phase must not duplicate those sources or alter signal behavior.

## Phase 1 file scope

### Add

- `server/rotation/config.ts` — typed source cadence, timeouts, cache TTLs, retry/backoff limits, and explicit crypto exclusions.
- `server/rotation/types.ts` — timestamped source result and CoinGecko market/global payload types.
- `server/rotation/sources/coingecko.ts` — batched top-market/universe and global-stat adapters, plus guarded historical-series adapter using CoinGecko's public API and the shared Redis cache.
- `server/rotation/repository.ts` — idempotent persistence of point-in-time source snapshots and daily universe membership/eligible status in PostgreSQL.
- `server/rotation/dailyCryptoJob.ts` — UTC daily collection, bounded retries, validation, stale-source reporting, and logging of included/excluded universe membership.

### Modify

- `server/initDb.ts` — idempotently create the Rotation Brain snapshot, universe, coin-return, macro-factor, and dominance-history tables/indexes; add nullable `market_state_snapshot_id` foreign key to the actual signal log (`ai_signal_log`).
- `shared/schema.ts` — mirror the signal snapshot reference if consumed by typed Drizzle code.
- `server/index.ts` — start the daily collection scheduler only after database initialization; retain the existing Redis/BullMQ pattern and a guarded no-Redis fallback.

Later phases will add calculations, source adapters for remaining external series, APIs/UI, and shadow-only signal/AI/meta-labeler integrations. No live trading gates or invented history are in Phase 1.
