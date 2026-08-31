# CLVRQuantAI — Implementation-Ready Upgrade Specification

Status: review draft for approval before implementation  
Scope: signal-quality/universe upgrade plus session-security/UI-polish upgrade  
Primary rule: collect and validate before enforcing; do not silently change live signal or authentication behavior

## 1. Why this document exists

The source specifications describe useful goals, but they cannot safely be implemented verbatim against the current codebase. This document reconciles them with the existing architecture, removes contradictory requirements, and separates changes that need independent rollout and rollback.

This document is authoritative over the uploaded drafts where they conflict.

### Source drafts

- `attached_assets/Pasted-CLVRQuantAI-EXPECTANCY-ENGINE-UPGRADE-internal-signal-q_1788204238788.txt`
- `attached_assets/Pasted--PART-D-DYNAMIC-ASSET-UNIVERSE-SYNC-Hyperliquid-Phantom_1788204255421.txt`
- `attached_assets/Pasted-CLVRQuantAI-SESSION-SECURITY-UI-POLISH-zero-disruption-_1788204999485.txt`
- `attached_assets/Pasted--PART-B-6-STEP-UP-RE-AUTH-FOR-SENSITIVE-ACTIONS-Sensiti_1788205018769.txt`

## 2. Delivery boundaries

The work is split into two independent tracks:

1. **Track S — Signal quality and dynamic universe**
2. **Track A — Authentication, session security, and UI motion**

Do not combine both tracks into one production release or one rollback unit. Security changes must be deployable without signal-engine changes, and signal-policy changes must be deployable without broad UI changes.

Within Track A, security and decorative motion are also separate releases. A motion regression must never require rolling back a security fix.

## 3. Current architecture discovered

### Signal paths

- Canonical directional geometry repair: `server/lib/geometryGuard.ts` — `enforceGeometry`
- Additional signal hardening and friction model: `server/lib/signalHardening.ts`
- Quant Scanner: `POST /api/quant` in `server/routes.ts`
- Trade Ideas: `POST /api/ai/analyze` with `feature: "tradeIdeas"`
- Morning Brief generation: `server/dailyBrief.ts`
- Morning Brief ranking: `server/lib/selectDailyTrades.ts`
- Basket AI: generic analyze path plus `client/src/components/ai/BasketAI.jsx`
- Kronos: `POST /api/kronos`
- Unified signal persistence: `server/lib/signalLogger.ts` — `logSignal`
- Outcome resolution: `server/lib/outcomeResolver.ts`
- Existing empirical calibration: `server/lib/calibration.ts`
- Typed signal schema: `shared/schema.ts` — `aiSignalLog`
- Production startup DDL: `server/initDb.ts`
- Static asset configuration: `server/config/assets.ts`
- Hyperliquid refresh: `server/workers/hlRefreshWorker.ts`
- Existing token soft gate: `server/lib/empiricalFilters.ts`

There is no single pre-emission pipeline shared by all card-producing routes. `logSignal` is a persistence choke point, not a safe policy-enforcement point.

### Session and authentication paths

- Session configuration: `server/index.ts`
  - `express-session`
  - `connect-pg-simple`
  - 30-day cookie
  - `httpOnly: true`
  - `secure: true`
  - `sameSite: "none"` for iframe compatibility
- Bearer compatibility path: `server/index.ts`
  - accepts a raw session ID as a bearer credential
  - sign-in/signup/WebAuthn responses can return that session ID
- Authentication handlers: `server/routes.ts`
  - signup
  - sign-in
  - sign-out
  - password change
  - forgot/reset password
  - account deletion
  - WebAuthn
- Billing handlers: `server/routes.ts`
  - checkout creation/status
  - subscription attachment
  - billing portal
  - pause/resume/cancel
- Client auth state and most polling: `client/src/App.jsx`
- Shared React Query client: `client/src/lib/queryClient.ts`
- Central market polling: `client/src/store/MarketDataStore.jsx`

No centralized authenticated-route middleware currently owns idle expiry, absolute lifetime, activity updates, or step-up authentication.

---

# Track S — Signal Quality and Dynamic Universe

## S1. Non-negotiable safety rules

1. Do not add client-facing win-rate, probability-of-profit, expectancy, or performance claims.
2. Existing risk controls remain active until an explicitly approved replacement is validated in shadow mode.
3. A new gate must never be enabled globally before each emission path has an integration test.
4. New internal values must not be serialized into ordinary client card payloads.
5. Every new policy has `off | shadow | on` behavior.
6. `shadow` computes and logs decisions but does not suppress, reorder, or alter client output.
7. Existing sessions, subscriptions, billing, and client-visible copy are outside Track S.

## S2. Canonical final-geometry contract

`enforceGeometry` is the single authority for final directional geometry.

Required order:

1. Construct candidate.
2. Apply existing risk/hardening adjustments.
3. Call `enforceGeometry`.
4. Use only the returned levels for all later R:R, cost, expectancy, persistence, and display calculations.

Successfully mirrored geometry remains eligible. `INVALID_GEOMETRY` applies only when the returned geometry is still unusable:

- non-finite or non-positive entry
- non-finite stop or TP1
- LONG stop not below entry after repair
- LONG TP1 not above entry after repair
- SHORT stop not above entry after repair
- SHORT TP1 not below entry after repair
- non-positive directional stop distance
- non-positive directional reward
- an `*-UNMIRRORABLE` result

Any independent geometry repair in `signalHardening.ts` must delegate to the canonical guard or be removed after equivalence tests. There must not be two definitions of “final.”

## S3. Outcome label required for expectancy

The live expectancy probability must represent:

> Probability that TP1 is observed before SL after a valid entry, within the declared hold horizon, under the same venue and fill assumptions used by the candidate.

Calibration labels:

- **win**: valid entry, then TP1 observed before SL
- **loss**: valid entry, then SL observed before TP1
- **censored**: expired without either barrier, missing price data, ambiguous same-bar ordering, invalid/repaired-after-emission legacy geometry, or unverified fill

Every signal must persist:

- entry-fill evidence and entry-fill time
- hold-horizon policy and exact expiry time
- observation method/version

Rows without verified entry are censored. If one sampled interval could contain both TP1 and SL and ordering cannot be proven, the row is censored. TP2/TP3 is a TP1 win only when the ordered observation proves TP1 was reached first; checking TP3 before TP1 in one sampled snapshot is not sufficient evidence.

TP2/TP3 outcomes count as wins only when the observation model establishes that TP1 was crossed first or necessarily crossed on the same continuous move. Expired positive PnL is not automatically a TP-before-SL win.

The current Python `direction_probability` is a directional-move proxy. It may be logged in shadow diagnostics, but it is not an enforceable `pWin`.

## S4. Observed MFE/MAE

With the current one-minute mark-price sampling, the metrics must be named and documented as:

- `observedMfePct`
- `observedMaePct`
- `observedMfeAt`
- `observedMaeAt`

They are sampled extrema, not guaranteed tick-level or candle-level excursions.

Definitions are directional and non-negative:

- LONG favorable: `max(0, (price - entry) / entry * 100)`
- LONG adverse: `max(0, (entry - price) / entry * 100)`
- SHORT favorable: `max(0, (entry - price) / entry * 100)`
- SHORT adverse: `max(0, (price - entry) / entry * 100)`

High-water marks are persisted on every resolver observation before terminal outcome handling. They must survive process restarts.

If true MFE/MAE is later required, add candle-high/low or trade-stream collection and version the observation method. Do not silently compare sampled and true excursions as one metric.

Real signals and shadow inversions remain separate datasets. Shadow inversion rows must not enter live calibration unless a future specification explicitly opts them in.

## S5. One calibration authority

Do not run two competing live calibration engines.

The new persisted calibration becomes authoritative only after parity and data-quality review. Until then, existing `server/lib/calibration.ts` remains the live source and the new system is shadow-only.

Required calibration dimensions:

- source
- asset class
- direction
- venue profile
- hold-horizon band
- final TP1-to-SL geometry/R:R band
- regime
- leverage tier
- model/policy version

High-dimensional buckets will be sparse. Implement a documented hierarchical backoff from specific to pooled buckets. Every selected bucket must meet its own minimum sample.

Minimum enforceable sample: `n >= 25` uncensored outcomes.

Smoothing: Laplace/Beta(1,1), `(wins + 1) / (n + 2)`, unless a later statistical review approves another prior.

Do not extract a score from arbitrary JSON key fallbacks for the new calibration. New rows use a versioned score snapshot schema. Legacy rows with unknown units are excluded.

The calibration job must:

- use one timezone, UTC
- define lookback using `resolvedAt`
- acquire a distributed DB or Redis lease
- upsert atomically under a unique bucket/version key
- be idempotent
- write a redacted admin summary
- never auto-enable a live policy

## S6. Cost model

Costs are calculated from final geometry and snapshotted on each signal.

Versioned venue profiles:

- `hyperliquid_native`
  - taker fee: 0.045% per side
- `phantom`
  - Hyperliquid taker fee plus 0.05% builder fee per side

Default client-context profile: `phantom`. Internal callers must pass the profile explicitly rather than rely on an unlogged global.

Slippage by observed 24-hour USD notional volume:

- at least $500M: 0.02%
- at least $100M and below $500M: 0.05%
- at least $25M and below $100M: 0.10%
- below $25M: ineligible; no expectancy enforcement calculation is needed

Funding:

- normalize to one decimal representation internally
- snapshot the raw rate, normalized rate, expected hold hours, and payer direction
- charge funding only when the candidate direction pays under the venue’s sign convention

Cost in R:

`costR = totalRoundTripCostPct / directionalStopDistancePct`

The model must snapshot:

- model version
- venue profile
- fee percent
- slippage percent
- funding percent
- expected hold hours
- volume used for the tier
- final stop-distance percent
- resulting `costR`

The existing `computeFrictionRR` gate must not double-count these costs. Initial rollout keeps the existing friction control authoritative and computes the new model in shadow. Replacement requires a separate comparison report and approval.

## S7. Net-expectancy policy

Directional geometry normalizes the loss to `1R`; therefore there is no separately applied `R_loss`.

`rewardR = directional TP1 distance / directional stop distance`

`netEV = pWin * rewardR - (1 - pWin) * 1 - costR`

Enforcement threshold: `netEV >= 0.10R`.

Decision states:

- `PASS`
- `NEGATIVE_EXPECTANCY`
- `INVALID_GEOMETRY`
- `CALIBRATION_INSUFFICIENT`
- `COST_CONTEXT_MISSING`

Rules:

- In `shadow`, all states are logged and existing output is preserved.
- In `on`, only empirically calibrated candidates with complete cost context are gated by `netEV`.
- `CALIBRATION_INSUFFICIENT` and `COST_CONTEXT_MISSING` preserve existing controls; they do not become invented probabilities.
- `pWin`, `netEV`, `costR`, and source bucket remain admin-only.

## S8. Emission integration

Create a normalized server-side emission-policy adapter. It receives a complete candidate and returns the candidate plus an internal decision. It must run before persistence and before response serialization.

Explicitly covered paths:

- Quant Scanner `/api/quant`
- Trade Ideas `/api/ai/analyze`
- Morning Brief
- Basket AI when it emits trade cards
- Kronos when it emits trade cards
- automated scanner/promoted-asset paths

Read-time feed repair is not an emission gate.

Per-ticker Quant Scanner requests do not receive cross-idea exposure selection because they do not provide a ranked candidate set.

## S9. Correlation/exposure cap

The current in-memory history is not a 30-day correlation source.

Before enforcement, collect or backfill:

- synchronized hourly closes
- BTC and candidate returns
- at least 20 complete trading days within a 30-day window
- observation/source version

Correlation is calculated only on aligned returns.

Fallbacks when history is insufficient:

- BTC/ETH: 1.0
- other crypto: 0.9
- non-crypto: unknown, not automatically zero

The exposure selector applies only to a normalized ranked set:

- maximum two candidates with the same direction and `abs(corrToBTC) > 0.75`
- skipped candidates remain in audit output as demoted
- fill only with the next candidate that independently passes all gates
- never pad to a quota

Morning Brief currently selects up to three ideas, not four or six. Preserve the server tier contract unless a separate product change approves new counts.

`exposureNote` is stored in admin audit data and omitted from client DTOs.

## S10. Dynamic Hyperliquid universe

### Scope

The dynamic Hyperliquid universe feeds perp discovery and perp-capable pickers. It does not replace the multi-venue My Basket catalog.

### Identity

Primary identity: `(venue, rawSymbol)`.

Required fields:

- venue
- raw symbol
- display symbol
- canonical symbol
- market type
- asset class
- size decimals
- price decimals when available
- max leverage
- 24-hour USD notional volume
- open interest in raw units
- open interest in USD
- funding
- mark price
- status
- supported-for-scoring flag and reason
- first seen
- last seen
- last successful refresh
- missing refresh count
- last missing time
- updated time
- raw metadata JSON

Aliases such as `kPEPE -> PEPE` must not collapse database identity.

HIP-3/equity classification must come from authoritative venue/dex metadata and fixture-tested responses. Name heuristics are not acceptable.

### Jobs

Separate responsibilities:

1. frequent bulk price refresh
2. slower market-context refresh
3. boot plus six-hour discovery/persistence refresh

Do not call `metaAndAssetCtxs` every five seconds merely for universe discovery.

Every scheduled job requires:

- single-flight protection
- distributed lease
- timeout and response-shape validation
- idempotent writes
- last-good snapshot behavior

### Status transitions

Statuses:

- `active`
- `quarantine`
- `delisted`

An asset is eligible only when:

- day volume is at least $25M
- open interest is at least $5M
- the symbol is supported by required scoring providers
- required asset-class context exists

On a complete validated refresh:

- seen rows reset `missingRefreshCount` to zero
- absent rows increment it atomically
- two consecutive validated misses mark the row `delisted`

On timeout, HTTP error, malformed response, or partial response:

- do not increment missing counts
- do not delist anything
- continue serving the last valid snapshot according to a defined staleness limit

Liquidity determines active versus quarantine and must not be overwritten by a generic “seen” update.

“Thirty days continuously above the floor” requires persisted eligibility observations or a `floorMetSince` value that resets whenever either floor fails.

For Hyperliquid perp candidates only, a listing younger than 30 days receives the existing token soft-gate conviction cap plus a `new-listing` audit flag until either:

- symbol-level calibration has at least 25 uncensored resolved outcomes, or
- `floorMetSince` reaches 30 continuous days

Both graduation paths require automated tests. This rule must not affect existing non-Hyperliquid equities, FX, commodities, or Basket-only assets.

### Equity perps

Until equity-relevant macro context is implemented and tested, equity perps remain discoverable but:

- `supportedForScoring = false`
- rejection reason `EQUITY_CONTEXT_PENDING`
- never pass through crypto BTC-macro logic

### API and client

`GET /api/universe` returns stable DTOs, not raw database rows.

It must distinguish:

- selectable and supported
- quarantined for liquidity
- discovered but unsupported
- delisted

The Quant Scanner picker may show supported active perp markets. Direct requests for quarantined, unsupported, or delisted symbols return a clear stable code.

My Basket merges Hyperliquid markets with its existing non-Hyperliquid catalog using `venue` and `marketType`; it must not lose equities, commodities, or FX.

Normalize `fx` versus `forex` at the API boundary.

## S11. Track S rollout

1. Canonical geometry and outcome contract tests
2. Typed schema plus matching idempotent `initDb` DDL
3. Durable observed excursion and universe collection
4. Durable hourly-close history
5. Shadow calibration
6. Calibration/data-quality review checkpoint
7. Shadow cost/expectancy decisions at every emission path
8. Shadow exposure selection
9. Admin review of suppression and concentration impact
10. Path-by-path enforcement
11. Dynamic picker expansion only after provider support

## S12. Track S acceptance

- Repaired valid geometry remains eligible; unrepairable geometry is `INVALID_GEOMETRY`.
- No scorer directional proxy is used as enforceable `pWin`.
- Expiry without TP1/SL is censored for TP-before-SL calibration.
- Observed excursion high-water marks survive restart.
- Legacy scores with unknown units do not enter new calibration.
- Every calibration and refresh job is singleton-safe across replicas.
- Cost assumptions are snapshotted and versioned.
- Existing friction and new costs are not double-counted.
- Correlation enforcement cannot enable before durable aligned history exists.
- A failed Hyperliquid refresh cannot delist the universe.
- Low-liquidity and unsupported Hyperliquid perp assets cannot emit through any card path.
- Existing non-Hyperliquid equities, FX, commodities, and Basket assets continue operating without requiring an `asset_universe` row.
- Dynamic universe work does not remove non-Hyperliquid Basket assets.
- Client code contains no new performance/probability claims.

---

# Track A — Session Security and UI Motion

## A1. Release split

Deliver as separate rollback units:

1. authentication and billing authorization prerequisites
2. session lifecycle and idle expiry in shadow/observe mode
3. live idle expiry
4. step-up authentication
5. decorative motion and loading polish

Do not ship all items under one combined commit.

## A2. Existing-session migration

“Zero disruption” means the deployment must not immediately invalidate existing sessions.

For authenticated sessions missing the new timestamps:

- initialize `loginAt` and `lastActivityAt` to deployment/first-observation time
- do not expire the session during that initializing request
- persist a session-policy version
- do not treat the initializing request as evidence of genuine interaction

Existing sessions receive a fresh eight-hour idle window and a fresh 30-day absolute window from migration. New sessions use their actual successful authentication time.

## A3. Session fields and server-authoritative expiry

Session fields:

- `loginAt`
- `lastActivityAt`
- `lastStrongAuthAt`
- `strongAuthMethod`
- `sessionPolicyVersion`

Expiry:

- idle lifetime: eight hours from `lastActivityAt`
- absolute lifetime: 30 days from `loginAt`

On expiry:

- destroy/revoke the server session
- return `401`
- idle code: `SESSION_IDLE_EXPIRED`
- absolute code: `SESSION_MAX_AGE`

The server is authoritative. Client timers are advisory UI only.

## A4. Activity model

Avoid a fragile “every authenticated route except polling” default.

All authenticated routes check expiry, but only these update activity:

- `POST /api/session/heartbeat` after real client interaction
- explicitly marked user-triggered mutations/actions

Background GETs and automated writes never refresh activity unless explicitly approved.

Known non-activity traffic includes:

- support thread polling
- support unread polling
- support typing keepalive
- market/crypto/news refresh
- signal/feed refresh
- basket price refresh
- journal/admin periodic refresh
- session status checks
- WebSocket/SSE traffic
- server workers

New routes default to **not refreshing activity**. This prevents a newly added poller from silently creating immortal sessions.

Heartbeat behavior:

- requires authentication
- checks expiry before updating
- updates at most once per five minutes per session
- returns authoritative idle and absolute expiry timestamps
- is not accepted from synthetic/programmatic events

## A5. Client activity and warning

Track trusted user interaction:

- pointer down
- key down
- user scroll
- visibility change to visible

Throttle heartbeat to once per five minutes while active.

At 7h45m of server-authoritative inactivity:

- show a non-blocking warning
- announce it accessibly
- do not steal focus
- interaction sends a heartbeat and dismisses it

On visibility return, request session status without refreshing activity, then reconcile the timer. Do not trust a suspended browser timer.

On session-expiry response:

- clear auth/session state
- do not auto-retry the failed action
- save only an allowlisted return tab or same-origin path
- redirect to sign-in
- show the friendly security message
- restore the allowlisted tab after successful sign-in

Never place session credentials in the return URL.

## A6. Central client request handling

The app currently uses many direct native `fetch` calls. React Query alone cannot intercept every response.

Introduce an `apiFetch` wrapper and migrate authenticated calls deliberately. Do not monkey-patch `window.fetch`.

The wrapper must:

- parse structured 401/403 codes before generic errors
- distinguish session expiry from unauthenticated, subscription, and ordinary forbidden responses
- coordinate one re-auth modal for concurrent `REAUTH_REQUIRED` responses
- retry an approved action at most once
- support `AbortController`
- preserve existing route-specific response handling

Until every authenticated request is migrated, session-expiry behavior is not complete.

## A7. Cookie and bearer compatibility

Do not blindly change `SameSite=None` to `Lax`. The current setting supports Replit iframe behavior.

For the initial session-security release:

- keep `httpOnly`, `secure`, and the current SameSite behavior explicit
- document environment-specific cookie behavior
- add origin/CSRF defenses for cookie-authenticated state-changing routes
- test Railway custom-domain and Replit preview flows

The raw session-ID bearer compatibility path is a separate high-risk migration:

- never log the bearer value
- regenerate the session ID on successful login
- return only the regenerated credential while compatibility remains
- revoke old session IDs
- remove localStorage bearer use only after cookie-only preview and production flows pass

While raw-session-ID bearer compatibility exists, policy middleware must identify the canonical presented bearer session ID and atomically read, update, and destroy that exact stored session. It must never initialize timestamps or record activity only on the transient request session created by cookie middleware.

Bearer regeneration must revoke the presented session ID before issuing its replacement. Integration tests must cover cookie and bearer behavior for:

- idle expiry
- absolute expiry
- heartbeat persistence
- sign-out
- regenerated-session replacement
- rejection of the old session ID

Do not remove bearer compatibility in the same deploy as idle expiry.

## A8. Authentication rate limits and fixation

Preserve or strengthen existing controls:

- sign-in: 10 attempts per 15 minutes
- forgot/reset password: 10 per 15 minutes with generic response
- confirm password: 10 per 15 minutes, keyed by IP plus session/account
- signup: preserve the existing stricter five-per-hour policy unless product requirements approve a change

Production rate limits require a distributed store. In-memory per-process limits are not sufficient for multiple replicas.

On successful password sign-in:

1. verify credentials
2. call `req.session.regenerate`
3. copy only required non-auth pre-login state
4. set user and session-policy fields; set `lastStrongAuthAt = now` and `strongAuthMethod = "password"` in the regenerated canonical session
5. save the session
6. respond

The old session ID must no longer authenticate.

WebAuthn sign-in sets recent-strong-auth fields only after the verified user-verification policy in A11 is satisfied.

## A9. Password reset

The API already avoids returning the temporary password. A grep-only acceptance test is insufficient.

Target state:

- token-based reset only
- no plaintext temporary password generated, stored, logged, or emailed
- generic forgot-password response regardless of account existence
- single-use, expiring reset token
- successful reset revokes or rotates existing sessions according to explicit policy
- password reset does not count as recent step-up authentication

This migration is security work, not UI polish.

## A10. Billing authorization prerequisites

Before step-up rollout, correct ownership checks on billing endpoints:

- subscription checkout requires an authenticated user
- checkout obtains the Stripe price exclusively from a server-side allowlist or validated tier input, never a client-supplied `priceId`
- checkout creates the Stripe session with the authenticated user’s immutable internal ID in metadata and that user’s owned Stripe customer/email
- checkout status and subscription attachment require authentication
- before returning status or changing tier, both routes verify that Stripe session metadata identifies the current user and the Stripe customer belongs to the current user
- ownership failure returns a stable forbidden/not-owned code with no customer email, plan, or payment data
- portal and pause/resume/cancel act only on the current user’s subscription
- `POST /api/stripe/downgrade`, and any endpoint that cancels, replaces, or clears a Stripe subscription, verifies ownership before mutation

If anonymous checkout remains a product requirement, it is a separately specified flow and must never attach a subscription or disclose checkout status until ownership is independently proven.

Step-up authentication does not repair a missing ownership check.

## A11. Step-up authentication

Middleware: `requireRecentAuth(10 minutes)`.

If recent strong authentication is missing:

- keep the session active
- return `403`
- code: `REAUTH_REQUIRED`
- include no account-existence or password-validity detail

Apply only to existing sensitive mutations:

- password change
- account deletion
- billing portal creation
- subscription pause
- subscription resume
- subscription cancellation
- `POST /api/stripe/downgrade`
- any future endpoint that cancels, replaces, or clears a Stripe subscription

No email-change endpoint currently exists. Do not invent one for this task. When one is later added, recent authentication is mandatory.

Ordinary AI, trading, scanner, settings-toggle, polling, and read-only account routes must not receive this middleware.

### Confirmation endpoint

`POST /api/session/confirm-password`:

- requires an existing unexpired session
- performs bcrypt comparison against the current user hash
- uses generic failure responses
- rate-limits by IP and session/account
- records success/failure in a redacted structured audit event
- updates `lastStrongAuthAt` only after success
- never logs password, bearer token, email, or password hash

### WebAuthn

Do not treat WebAuthn login as password confirmation automatically.

Before any WebAuthn account can authenticate or be treated as strongly authenticated, replace credential-ID lookup login with standards-compliant server verification of:

- a server-issued single-use challenge
- assertion signature against the stored public key
- RP ID
- allowed origin
- user verification requirements
- signature counter/replay protection

A credential ID alone must never create a session. This is an authentication prerequisite independent of step-up rollout. An integration test must prove that a known credential ID without a valid assertion cannot authenticate.

Before rollout, inventory existing WebAuthn credential records. Legacy records containing only a credential ID cannot satisfy assertion verification and must be marked legacy/non-authenticating.

Migration rules:

- preserve password sign-in and password-reset recovery
- after successful password authentication, require WebAuthn re-enrollment before offering passkey login again
- before cutover, establish a secure recovery/re-enrollment path for every affected account lacking a usable password
- disable the credential-ID-only endpoint for every account at cutover; it must never remain as an authentication fallback
- do not enable the standards-compliant WebAuthn release until migration metrics show every affected account has either a usable password/recovery path or a completed verified credential re-enrollment
- feature-flag the standards-compliant verifier
- publish redacted migration and lockout-risk metrics before disabling legacy login
- never silently treat an ID-only credential as verified during migration

Tests must cover an ID-only legacy credential, password fallback, reset recovery, re-enrollment, verified assertion login, rejection of the old legacy record, and proof that an ID-only record cannot authenticate in any migration state even when the account lacks a password.

Before enabling step-up for WebAuthn-authenticated accounts, define one of:

- verified WebAuthn user-verification as an approved strong-auth method, or
- password confirmation when the account has a password, or
- a dedicated WebAuthn step-up flow

No user may become unable to manage or delete their account because their authentication method lacks a supported step-up path.

## A12. Client re-auth behavior

On `REAUTH_REQUIRED`:

- show one accessible modal
- preserve the current form/action state
- password field is labelled and not prefilled
- focus moves into the modal and returns to the trigger
- Escape and Cancel close without losing form data
- wrong password remains generic
- success retries the action no more than once

Automatic retry is allowed only when:

- the action is idempotent, or
- it carries a server-enforced idempotency key

Do not blindly replay checkout/session creation or other side-effecting requests.

Concurrent challenges queue behind one modal and are individually revalidated before retry.

## A13. Account deletion

Recent authentication is necessary but not sufficient.

Before enabling the route:

- define Stripe cancellation failure policy
- define deletion or anonymization for related rows
- revoke all sessions
- make retries idempotent
- send confirmation only after durable deletion state is committed
- log a redacted audit event

Do not silently swallow a billing cancellation failure and then claim full deletion without an explicit product policy.

## A14. Audit events

Use structured, redacted events rather than ad-hoc console strings.

Allowed fields:

- internal user ID
- route/action code
- outcome code
- authentication method
- timestamp
- request correlation ID

Forbidden fields:

- password
- password hash
- raw session ID
- bearer token
- full request body
- unnecessary email or billing identifiers

Define retention and admin access before treating the event stream as a security audit trail.

## A15. Motion rules

Decorative motion ships separately from security.

General rules:

- transform and opacity only
- 150–300ms
- no `transition: all`
- no width/height/top/left animation
- reduced motion disables decorative animation
- stable item IDs determine whether a card is new

The original shimmer request conflicts with the transform/opacity-only rule if implemented using `background-position`. Implement shimmer with a translated pseudo-element instead.

The original 400ms meter duration conflicts with the 150–300ms limit. Use 300ms.

Required behavior:

- new cards fade/translate up once
- existing cards do not reanimate on refresh/reorder
- tabs crossfade without breaking focus or announcing duplicate content
- press feedback uses `transform: scale(0.98)`
- card-list loaders use accessible skeletons
- meters use `scaleX` from a fixed transform origin, never animated width
- idle banner uses translated opacity entrance/exit
- price pulse uses a throttled opacity overlay

The application has multiple signal-card implementations; both the inline card in `App.jsx` and `client/src/components/ai/SignalCard.jsx` must be covered where still active.

Existing top/width animations and `transition: all` are not automatically in scope for mass refactoring. Touch only components changed by this release, then create separate cleanup work if needed.

## A16. Motion accessibility

- `@media (prefers-reduced-motion: reduce)` disables decorative keyframes and transitions.
- Runtime motion decisions must also honor `matchMedia` where JavaScript controls mounting.
- Re-auth modal has focus trap, labelled controls, Escape/Cancel, and focus restoration.
- Idle warning uses an appropriate live region without repeated announcements.
- Skeletons are `aria-hidden`; the list container exposes a single busy status.
- Icon-only controls have accessible names.
- Tabs retain correct tab/tabpanel roles and keyboard behavior.

## A17. Track A rollout

1. Add tests around current login, bearer compatibility, billing ownership, and account deletion.
2. Fix billing ownership and token-reset prerequisites.
3. Add session fields and middleware in observe-only mode.
4. Add heartbeat/status and centralized client response handling.
5. Validate polling never refreshes activity.
6. Enable idle and absolute expiry for migrated/new sessions.
7. Add step-up confirmation and protect one route at a time.
8. Validate WebAuthn step-up compatibility.
9. Ship motion changes separately by component group.
10. Consider cookie-only/bearer-removal migration only after cross-environment tests.

## A18. Track A acceptance

- Existing sessions are not immediately signed out at deploy.
- Polling alone cannot extend idle lifetime.
- Genuine interaction extends idle lifetime up to the absolute cap.
- A suspended/background tab reconciles against server time on return.
- Session ID changes after successful sign-in and the old ID fails.
- Signup protection is not weakened to satisfy a uniform rate-limit number.
- No password or raw session credential appears in logs, audit events, URLs, error responses, or ordinary API bodies.
- During the explicitly enabled raw-session-ID bearer compatibility window only, the regenerated session ID may be returned solely by a successful sign-in, signup, or standards-compliant WebAuthn authentication response over HTTPS with `Cache-Control: no-store`; no other endpoint may return it. This exception expires when cookie-only migration is approved.
- Current cookie behavior works in Railway and Replit preview before any SameSite change.
- Expired-session responses are distinct from subscription 401/403 responses.
- Sensitive actions require recent supported strong authentication.
- A password-authenticated user can complete every protected action within 10 minutes of sign-in without `REAUTH_REQUIRED`; after 10 minutes the same action requires re-authentication.
- Normal AI/trading routes never trigger step-up.
- Automatic action retry is at-most-once and idempotent.
- Billing ownership is verified independently of step-up.
- Unauthenticated and cross-user requests cannot create or inspect an owned checkout, attach its subscription, or change the account tier.
- WebAuthn users retain a working sensitive-action path.
- Reduced-motion users receive no decorative animation.
- New-card detection uses stable IDs, not array indexes.
- No new animation causes layout movement.

---

# 4. Test strategy

## Contract tests

- geometry normalization and invalid final geometry
- directional reward and stop distances
- funding payer sign and unit normalization
- cost snapshot versioning
- calibration inclusion/censoring
- universe status transitions on success, partial response, and outage
- session timestamp migration and expiry boundaries
- route activity classification
- recent-auth boundary and retry behavior

## Integration tests

- every card emission path in `off`, `shadow`, and `on`
- resolver restart with persisted excursion marks
- multi-replica job lease contention
- Hyperliquid response fixture changes
- login session regeneration
- bearer compatibility during migration
- polling-only idle expiry
- Stripe ownership plus recent authentication
- WebAuthn-sensitive action behavior

## Browser tests

- warning at the server-provided deadline
- tap/scroll heartbeat throttling
- expired-session friendly redirect and allowlisted tab restoration
- one modal for concurrent re-auth challenges
- preserved form state and one retry
- card refresh animates only new stable IDs
- skeleton and tab accessibility
- reduced-motion behavior
- mobile Safari transform/opacity performance

## Static checks

- TypeScript
- existing unit/integration suites
- grep client changes for prohibited performance/probability language
- grep for raw session/password logging
- grep changed motion code for `transition: all` and animated layout properties

# 5. Approval checkpoints

Implementation pauses for explicit review after:

1. schema and contract proposal
2. first shadow calibration summary
3. first shadow expectancy/exposure rejection report
4. dynamic-universe fixture and outage test report
5. session observe-mode report showing which routes refresh activity
6. billing ownership test report
7. step-up test report, including WebAuthn
8. reduced-motion and mobile browser verification

No checkpoint automatically promotes a feature flag.