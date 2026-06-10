---
name: initDb column reconciliation for renamed/added columns
description: Why schema.ts column adds/renames need idempotent ALTERs in initDb, reconciling the full set.
---

# Adding/renaming columns: reconcile existing DBs in initDb

Editing a column in `shared/schema.ts` (add or rename) does NOT migrate existing
databases. `initDb.ts` bootstraps tables with `CREATE TABLE IF NOT EXISTS`, which
is a no-op on a table that already exists — so new/renamed columns never appear on
older dev/prod DBs, and the first query referencing them throws
`column "<x>" does not exist` (e.g. the outcomeResolver shadow tick on
signal_shadow_inversions after the tp1_price -> inverted_tp1 rename).

**Rule:** Whenever you add or rename a column in schema.ts, pair it with an
idempotent `ALTER TABLE <t> ADD COLUMN IF NOT EXISTS <col> <type>` in initDb,
placed right after that table's CREATE block (and before any INSERT/backfill that
uses the column).

**Why full-set, not just the one that errored:** Postgres reports only the FIRST
missing column. If several are missing, reconcile every column the code
reads/writes in one pass or you whack-a-mole through restarts.

**How to apply:**
- Keep the CREATE statement, the ALTERs, and the Drizzle schema in agreement on
  names + types.
- New columns must be nullable or constant-defaulted so existing rows stay valid;
  never NOT NULL without a default on a populated table.
- Wrap the ALTERs in a SAVEPOINT (existing pattern) so a failure can't abort the
  outer init transaction. Idempotent only — no DROP, no ALTER TYPE, no row backfill.
- A rename leaves the OLD column in place with its data; copying old->new touches
  existing rows, so propose that as a separate opt-in migration, not part of boot.
