# November 20, 2026 audit — implementation and verification

This document records **pre-release verification**. Preview repairs were verified
before the authorized release; final GitHub/Railway status is reported separately
after immutable running-revision checks.
The remaining source-data and scoring-policy limitations below are not being
represented as fixed. No plan prices, access rules, founder Telegram controls,
or owner broadcast tools were changed. Pricing configuration edits are labels only.

## Verification

- TypeScript check and the project's client/server production build passed.
- 64 focused checks passed: 8 calendar tests and 56 server tests, including
  brief numerical consistency, source failures, xyz scoring, Alpha Desk
  calculations, and independent rotation windows.
- Browser verification used a unique, regular, non-admin development account:
  email verification was required before entering a code; after simulated
  verification, manual redemption displayed “Trial activated: Pro until
  November 27, 2026”; the account became Pro; a repeat said already redeemed.
  `CLVR-TRIAL-88RY4WAB` was an isolated development fixture, not the live issued
  code. All created fixture records were removed. No Founder account was used.
- Ten authenticated preview calendar API reads, using the frontend's real date
  filters, returned weekly counts of
  `113, 113, 113, 113, 113, 113, 113, 113, 113, 113`, and Today returned 13.
  This is API/filter repeatability, not ten authenticated browser reloads.
- The canonical DXY endpoint returned a sourced Yahoo `DX-Y.NYB` quote
  (`103.734` during verification). Prices are observations, not fixtures.
- Macro Intel returned six attributed BBC Business RSS items during verification.
- The public `/monitor` route rendered the existing professional Elite/sign-in
  gate without browser runtime errors. The signed-in Monitor's complete load
  time and every light-mode page were not browser-measured.

## Per-item closeout

1. **BLOCKED — released actuals.** The public Forex Factory weekly export has
   forecast/previous values but no actual field; all 113 weekly events had no
   reported actual during the check. Need an accessible, authorized release-data
   source to satisfy the UoM actual acceptance criterion. Fixed the Monday–Sunday
   date range, Today isolation, source timestamps, false LIVE claims and
   inferred rate “hold” results. Macro Intel now has an attributed public BBC
   Business fallback and explicit unavailable/stale behavior.
   Files: `client/src/utils/macroCalendar.js`, `client/src/App.jsx`,
   `server/routes.ts`, `server/lib/macroBusinessNews.ts`.

2. **DONE — immediate loading presentation.** Initial HTML now contains a
   visible, accessible loader before the JavaScript bundle starts. Theme
   selection also happens before first paint. The build still warns that the
   main client bundle is large; this is not a claim that every signed-in
   network operation has been shortened.
   File: `client/index.html`.

3. **DONE — publication safeguards.** Computed R:R and existing TP1 minimum
   1.20:1 remain enforced; snapshot price/percentage consistency is tested.
   Internal calendar access now shares the real cache rather than making
   unauthenticated HTTP calls. Completed releases and mismatched speaker/time
   watch entries are removed. Unverified executive-departure, MSCI-removal,
   ETF-flow and EPS claims are withheld, not replaced by invented facts.
   DXY uses the same actual Yahoo index source in Brief, ticker and Alpha Desk.
   Files: `server/dailyBrief.ts`, `server/lib/briefSnapshotGuards.ts`,
   `server/lib/briefPublicationFacts.ts`, `server/services/yahoo.ts`,
   `server/services/macroCalendarReader.ts`.

4. **BLOCKED — distinct post-policy scores cannot be promised honestly.**
   The repeated 22.4 is explained by a common calibration cap of 40%, a
   chase multiplier of 0.70 and low-sample multiplier of 0.80.
   Separate raw scores can legitimately collapse to the same final score.
   Added raw/calibrated/penalty traces, rejected missing scores rather than
   defaulting to 50, corrected asset-class recognition, and explained scanner
   exclusion codes. No risk gates were weakened and no scores fabricated.
   A validated calibration-policy change is required if distinct post-cap
   scores remain a mandatory acceptance condition.
   Files: `server/routes.ts`, `server/lib/tradeIdeaEvaluation.ts`,
   `client/src/components/ai/TopTradeIdeas.jsx`,
   `client/src/components/ai/QuantScanner.jsx`.

5. **DONE — requested theme fixes in code.** Market price rows, shared headings,
   FAQ questions and the Phantom heading now use the current theme. Initial
   HTML sets the stored theme before loading the app. Every signed-in page has
   not received a separate visual browser pass.
   Files: `client/src/lib/themeContext.jsx`, `client/src/App.jsx`,
   `client/src/tabs/MarketTab.jsx`, `client/src/PhantomWallet.jsx`,
   `client/index.html`.

6. **DONE — graceful data states and moderation.** Invalid quote updates no
   longer erase a valid displayed quote; the ticker uses LAST/WAIT rather than
   flashing ERROR. Cold-start Fear & Greed is unavailable, not a fabricated
   Neutral 50. Last good sentiment survives failed refreshes. Raw social posts
   pass a conservative profanity filter before publication.
   Files: `client/src/App.jsx`, `client/src/context/DataBusContext.jsx`,
   `server/databus.ts`, `server/lib/socialModeration.ts`, `server/routes.ts`.

7. **DONE — dates and estimate provenance.** Past dates no longer say Today,
   and labels use Eastern calendar dates. Fiscal quarter, units and provider
   are explicit. Finnhub returned MU fiscal Q1 2027 consensus EPS 39.3702 and
   revenue 63,792,594,667 USD. Micron's published outlook confirms this is a
   quarterly scale (revenue guidance 61.5B ±1.5B, adjusted EPS 38.15 ±1.00),
   not a demonstrated annual/quarter unit conversion error. Consensus is not
   company guidance, and the exact consensus was not independently certified
   by Micron. Unsupported EPS claims are no longer allowed in generated briefs.
   Files: `server/services/finnhubEarnings.ts`,
   `client/src/components/EarningsContent.jsx`.
   Reference: https://investors.micron.com/news/press-release/2026/Micron-Technology-Inc--Reports-Record-Fiscal-Fourth-Quarter-and-Full-Year-2026-Results

8. **DONE — supported, priced basket cards.** Internal namespaces cannot become
   visible tickers; cards require an observed positive price and supported
   status. Filter reset labels distinguish asset classes from regions.
   Counts state selected/maximum and remaining slots explicitly.
   File: `client/src/components/MyBasket.jsx`.

9. **DONE — non-destructive journal display repairs.** Normalize repeated percent
   signs, negative loss signs and comma decimals; flag inconsistent note/header
   percentages and possible repeated imports. Old entries are labelled archived,
   and source attribution is retained where present. Potential duplicates are
   flagged rather than deleting possibly distinct account trades.
   Files: `server/lib/journalDisplay.ts`, `server/routes.ts`, `client/src/App.jsx`.

10. **DONE — honest partial-failure behavior; upstream availability not guaranteed.**
    Removed the ineffective Insider button, retained explicit retry/error states,
    and use actual cache timestamps rather than request time as source time.
    Pulse explains its short-window detector and reports snapshot/last activity.
    One xyz candle failure no longer removes every other market; failed rows
    have explicit source-unavailable labels. An all-source failure remains an
    error, never an invented signal. No tab or scorer was removed.
    Files: `client/src/tabs/InsiderTab.jsx`, `client/src/App.jsx`,
    `server/routes.ts`, `server/services/xyzSignalFeed.ts`.

11. **BLOCKED — ETF provider access.** The Farside public endpoints returned
    HTTP 403 from this environment. Need an accessible authorized ETF-flow
    source or confirmation that production egress can fetch the source.
    Fixed historical ordering, explained daily/intraday/publication cadence,
    and verified with divergent fixtures that 30D breadth can be 100 while
    60D is 0. Equal real readings are not evidence of copied calculations.
    Production scheduler/source health remains to be checked after release.
    Files: `server/rotation/sources/etfFlows.ts`,
    `server/rotation/engines/engines.test.ts`,
    `client/src/components/rotation-brain/RotationBrainPage.jsx`.

12. **DONE — Alpha Desk presentation.** Initial risk values show a loading
    state instead of blank N/A cells. All-empty correlation rows/columns are
    omitted with an explanation, not filled with zero. DXY is canonical.
    The change label explicitly says daily-close basis, not rolling 24 hours.
    Files: `client/src/components/alphaDesk/AlphaDeskPage.jsx`,
    `server/alphaDesk/data.ts`.

13. **DONE in development — verification-first redemption.** Browser-verified
    precheck, trial confirmation, authoritative Pro session refresh and repeat
    rejection, using a regular fixture account. The live issued code and
    activation-email delivery were not tested.
    Files: `client/src/App.jsx`, `client/src/QRScanner.jsx`.

14. **DONE — copy without changing entitlements.** Free delayed direction history
    is distinguished from full history/PnL/reasoning. Help explains up to six
    on-demand candidates versus up to three approved Elite email ideas.
    FAQ is no longer labelled April. Old About release notes are explicitly
    archived rather than represented as this week's release.
    Files: `client/src/config/pricing.js` (labels only), `client/src/App.jsx`.

## Additional release check

The outcome resolver hit PostgreSQL error 22P02 because a fractional excursion
parameter was inferred as integer when compared with literal zero. Explicit
double-precision parameter casts preserve existing outcome rules and avoid
changing schema or rewriting stored labels. A parameterized development SQL
check accepted the previously failing fractional value.
After restart, the resolver processed its 75 pending records without the
integer-parameter error; the rotation worker also produced an intraday snapshot.
File: `server/lib/outcomeResolver.ts`.

## Release

At the time of these pre-release checks, no GitHub push, Railway rollout, live
authenticated reload acceptance, or subscriber campaign had been performed.
The subsequent release requires explicit authorization and running-revision
verification. The remaining source-data limitations remain open after release.
