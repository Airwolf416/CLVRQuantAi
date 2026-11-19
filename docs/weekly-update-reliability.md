# Saturday change updates

## Schedule and audience

- Starts Saturday at **10 AM America/New_York**, independently of the server's timezone.
- Retries every five minutes within the wall-clock window ending Sunday before 10 AM Eastern.
- Runs in production only. The Replit development preview cannot automatically send subscriber campaigns.
- Preserves the existing audience: active rows in `subscribers`, not every registered account.
- Snapshots and normalizes that audience once per update. A later unsubscribe is rechecked before each attempt; later signups wait for a subsequent update.
- No catch-up campaign or historical resend was performed during this repair.

## Durable recovery

PostgreSQL advisory locks serialize weekly generation and each update's delivery across replicas. The run row, published update/source manifest, audience snapshot and per-recipient receipts survive restarts. Publication and attachment to the weekly run are committed together.

A row-level publication fence also returns the already attached update if two processes reach publication after an advisory-lock connection is lost. It does not rely on the old process stopping its AI work immediately.

Recipient retries use the same provider idempotency key and the exact saved request body. The installed Resend SDK predates request-level idempotency options; this sender uses Resend's HTTP `Idempotency-Key` header directly. Other email senders are unchanged.

Provider acceptance is not proof of inbox delivery. An ambiguous request older than 23 hours is held for provider reconciliation rather than blindly retried after the provider's 24-hour idempotency retention. Such a run needs owner attention. Unsent failures never cause a partial batch to be marked complete.

Only the exact curated log entries cited by the published digest are consumed, and only after the batch completes. Unrelated or subsequently added entries remain pending. Manual age overrides do not override deduplication.

## Change detection and copy

Production pins GitHub discovery to `APP_BUILD_SHA`, not the moving main branch. A delivered/no-change source cursor uses commit ancestry when available. Legacy updates without that evidence use a dated lookback; that limitation is not represented as exact historical coverage.

User-visible fixes are eligible. Internal build/test/refactor noise is filtered. Reviewed facts supplement specific verified commits; those facts do not appear for unshipped commits. Unknown future changes continue through automatic GitHub discovery and AI editing.

AI generation requests native structured JSON. Schema, source-citation and compliance validation happen before publication. A genuine empty editor decision, upstream failure, malformed output and compliance rejection are distinct outcomes. Failed generation retains the weekly retry state and publishes nothing.

The preview exposed malformed/editorially unsuitable AI output. It was blocked rather than published. The accompanying latest-changes summary was separately reviewed against the serving release. No unsupported promise about universal, on-time email delivery is included.

## Historical incident evidence

At investigation time on November 19, 2026:

- Railway production served revision `002c3866b71198686e4f7dcc8172c374a1f7a686`.
- The old scheduler had a Saturday-only six-minute opportunity and set its in-memory guard before attempting generation.
- The old sender stamped `email_sent_at` even when individual recipients failed.
- The old filter and AI instructions excluded many fixes from release notes.
- There was no accessible Railway credential/connection here, no authenticated production owner session, and the connected Resend key returned `restricted_api_key` when asked to list delivery history.

These establish code defects and an evidence gap, **not a confirmed root cause for the November 14 miss**. No production subscriber records were inspected through a development database, and no retrospective delivery result was fabricated.

## Read-only diagnostics

- `/health` exposes scheduler policy, production enablement, initialized storage, source-probe readiness, serving-revision pin and configuration-presence flags. Configuration presence is not a provider authentication or inbox-delivery test.
- Owner-authenticated `GET /api/admin/weekly-update/diagnostics` returns recent runs, update timestamps/counts and aggregate recipient states/error codes, not addresses or payloads.
- Records predating the new recipient ledger have no reconstructable per-recipient receipts here. Do not resend them to discover what happened.

## Verification commands

```sh
npm run check
npx tsx script/test.ts
WEEKLY_DB_INTEGRATION=1 npx tsx server/tests/weeklyDigestDatabase.test.ts
node --test scripts/verify-release.test.mjs scripts/verify-weekly-release.test.mjs
npm run build
```

The integration test refuses production/Railway, uses a temporary development schema and mock mail, and removes that schema afterward. CI runs the pure tests without requiring database credentials.

Read-only AI preview, optionally pinned to a verified production revision:

```sh
APP_BUILD_SHA=<verified-full-revision> NODE_ENV=development \
  npx tsx server/scripts/previewWeeklyUpdate.ts 14 --commits-only \
  --out=generated-artifacts/weekly-update-preview.html
```

The preview writes no application data and sends nothing. It exits unsuccessfully for a validation/compliance failure; an honest no-change result is not an error.

After the existing GitHub-to-Railway release pipeline:

```sh
node scripts/verify-release.mjs https://clvrquantai.com <verified-full-revision> --weekly-digest
```

This requires ten consecutive exact-revision and scheduler-readiness matches. It does not trigger generation, a historical resend, or a subscriber email.
