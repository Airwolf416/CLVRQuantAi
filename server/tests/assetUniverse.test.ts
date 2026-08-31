import assert from "node:assert/strict";
import test from "node:test";

// assetUniverse imports the production pool, but these tests exercise only its
// pure parser/fallback contracts and never connect to the database.
process.env.DATABASE_URL ||= "postgres://unused:unused@127.0.0.1:1/unused";
const {
  parseHyperliquidUniverse,
  staticUniverse,
  isHyperliquidScorerSupported,
  newListingGraduated,
  setUniverseRepositoryForTests,
  persistUniverseSnapshotForTests,
  loadUniverseLastKnownGood,
  getUniverseDto,
} = await import("../lib/assetUniverse");
const { runHlTick } = await import("../workers/hlRefreshWorker");
const { applyEmissionPolicy } = await import("../lib/emissionPolicy");

function durableRow(symbol: string, overrides: any = {}) {
  const at = new Date().toISOString();
  return { venue:"hyperliquid",raw_symbol:symbol,display_symbol:symbol,canonical_symbol:symbol,
    market_type:"perp",asset_class:"crypto",size_decimals:2,price_decimals:2,max_leverage:10,
    mark_price:100,day_volume_usd:50e6,open_interest_raw:1e5,open_interest_usd:10e6,funding:0,
    status:"active",eligible:true,eligibility_reasons:["ELIGIBLE"],scorer_supported:true,
    scorer_support_reason:null,discovered_at:at,last_seen_at:at,last_successful_refresh_at:at,
    floor_met_since:at,listing_evidence:{kind:"venue",at},schema_version:1,snapshot_version:1,
    missing_refresh_count:0,...overrides };
}
class FakeDb {
  rows:any[]=[]; lease=true; snapshot=0; failInsert=false;
  async query(sql:string, params:any[]=[]):Promise<any> {
    if(sql.includes("signal_policy_leases")) return {rowCount:this.lease?1:0,rows:[]};
    if(sql.includes("SELECT raw_symbol")) return {rows:this.rows.filter(r=>r.venue===params[0])};
    if(sql.includes("SELECT UPPER(token)")) return {rows:[]};
    if(sql.includes("SELECT * FROM asset_universe")) return {rows:this.rows};
    return {rows:[],rowCount:0};
  }
  async connect():Promise<any> { const db=this; return { release(){}, async query(sql:string,p:any[]=[]){
    if(["BEGIN","COMMIT","ROLLBACK"].includes(sql)) return {rows:[]};
    if(sql.includes("asset_universe_snapshots")) { if(db.failInsert) throw Error("storage failure"); return {rows:[{id:++db.snapshot,created_at:new Date()}]}; }
    if(sql.includes("INSERT INTO asset_universe")) {
      const old=db.rows.find(r=>r.venue===p[0]&&r.raw_symbol===p[1]);
      const row=durableRow(p[1],{venue:p[0],display_symbol:p[2],canonical_symbol:p[3],status:p[14],
        eligible:p[15],eligibility_reasons:p[16],scorer_supported:p[17],scorer_support_reason:p[18],
        discovered_at:old?.discovered_at||p[19],last_seen_at:p[20],last_successful_refresh_at:p[21],
        floor_met_since:old?.floor_met_since||p[22],snapshot_version:p[24],missing_refresh_count:0});
      old?Object.assign(old,row):db.rows.push(row); return {rows:[]};
    }
    if(sql.includes("missing_refresh_count=missing_refresh_count+1")) {
      for(const r of db.rows.filter(r=>r.venue===p[1]&&r.snapshot_version!==p[0])){
        r.missing_refresh_count++; if(r.missing_refresh_count>=2){r.status="delisted";r.eligible=false;}
      } return {rows:[]};
    } return {rows:[]};
  }}}
}
const liquidPayload=(symbols:string[])=>[
  {universe:symbols.map(name=>({name,szDecimals:2,assetClass:"crypto"}))},
  symbols.map(()=>({markPx:"100",dayNtlVlm:"50000000",openInterest:"100000"}))
];
const validTickMeta = [{ universe: [{ name:"BTC", szDecimals:2 }] },
  [{ markPx:"100",prevDayPx:"90",funding:"0.001",openInterest:"1000",dayNtlVlm:"50000000" }]];
const response = (ok:boolean, body:unknown, rejects=false) => ({
  ok, json: async () => { if(rejects) throw Error("not json"); return body; },
}) as Response;
const sequenceFetch = (...responses: Response[]) => {
  let index=0;
  return (async () => responses[index++]) as typeof fetch;
};

const now = new Date("2026-04-20T12:00:00.000Z");

test("parses aligned metaAndAssetCtxs and preserves raw alias identity", () => {
  const rows = parseHyperliquidUniverse([
    { universe: [{ name: "kPEPE", szDecimals: 0, maxLeverage: 10 }] },
    [{ markPx: "8", dayNtlVlm: "30000000", openInterest: "1000000", funding: "0.0001" }],
  ], now, { kPEPE: "2026-01-01T00:00:00.000Z" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rawSymbol, "kPEPE");
  assert.equal(rows[0].canonicalSymbol, "PEPE");
  assert.equal(rows[0].markPrice, .008);
  assert.equal(rows[0].openInterestUsd, 8_000_000);
  assert.equal(rows[0].eligible, true);
  assert.equal(rows[0].scorerSupported, true);
});

test("eligibility returns stable liquidity and mark reason codes", () => {
  const [row] = parseHyperliquidUniverse([
    { universe: [{ name: "NEW", szDecimals: 2, maxLeverage: 3 }] },
    [{ markPx: "0", dayNtlVlm: "100", openInterest: "0", funding: null }],
  ], now);
  assert.equal(row.status, "quarantine");
  assert.equal(row.eligible, false);
  assert.ok(row.eligibilityReasons.includes("INVALID_MARK"));
  assert.ok(row.eligibilityReasons.includes("VOLUME_BELOW_25M"));
  assert.ok(row.eligibilityReasons.includes("OPEN_INTEREST_BELOW_5M"));
  assert.ok(row.eligibilityReasons.includes("SCORER_UNSUPPORTED"));
});

test("HIP-3 dex metadata is discoverable but never scoreable", () => {
  const [row] = parseHyperliquidUniverse([
    { universe: [{ name: "XYZ", szDecimals: 2, maxLeverage: 5, dex: "xyz" }] },
    [{ markPx: "100", dayNtlVlm: "50000000", openInterest: "100000", funding: "0" }],
  ], now);
  assert.equal(row.status, "active");
  assert.equal(row.scorerSupported, false);
  assert.equal(row.scorerSupportReason, "EQUITY_CONTEXT_PENDING");
  assert.equal(row.eligible, false);
});

test("partial refresh is rejected before it can replace last-known-good state", () => {
  const previous = staticUniverse(now);
  assert.throws(() => parseHyperliquidUniverse([
    { universe: [{ name: "BTC", szDecimals: 5 }] },
    [],
  ], now), /HL_UNIVERSE_PARTIAL/);
  assert.equal(previous.assets[0].rawSymbol, "BTC");
  assert.equal(previous.source, "static-fallback");
});

test("startup fallback and explicit scorer allowlist remain stable", () => {
  const fallback = staticUniverse(now);
  assert.equal(fallback.fallback, true);
  assert.ok(fallback.assets.some(asset => asset.canonicalSymbol === "BTC"));
  assert.equal(isHyperliquidScorerSupported("PEPE"), true);
  assert.equal(isHyperliquidScorerSupported("UNLISTED"), false);
});

test("new listing graduation requires durable 30-day floor evidence or 25 outcomes", () => {
  assert.equal(newListingGraduated(null, 24, now.getTime()), false);
  assert.equal(newListingGraduated(null, 25, now.getTime()), true);
  assert.equal(newListingGraduated("2026-03-21T12:00:00.000Z", 0, now.getTime()), true);
  assert.equal(newListingGraduated("2026-03-22T12:00:00.000Z", 0, now.getTime()), false);
});

test("client contracts dedupe dynamic aliases and preserve non-HL basket assets", async () => {
  const { readFile } = await import("node:fs/promises");
  const scanner = await readFile("client/src/components/ai/QuantScanner.jsx", "utf8");
  const basket = await readFile("client/src/components/MyBasket.jsx", "utf8");
  assert.match(scanner, /new Map\(FULL_ASSET_LIBRARY\.map/);
  assert.match(scanner, /Unsupported for perp scoring/);
  assert.match(basket, /const assets = ALL_ASSETS\.map/);
  assert.match(basket, /byCanonical/);
  assert.match(basket, /retain the complete static multi-venue basket/);
  assert.match(basket, /not supported for scoring/);
});

test("repository integration: lease loser reloads winner snapshot", async () => {
  const db = new FakeDb();
  db.rows = [durableRow("BTC", { snapshot_version: 77 })];
  db.lease = false;
  setUniverseRepositoryForTests(db as any);
  await persistUniverseSnapshotForTests(liquidPayload(["ETH"]));
  assert.equal(getUniverseDto().assets[0].rawSymbol, "BTC");
  setUniverseRepositoryForTests(null);
});

test("repository integration: two transactional misses delist and reappearance resets", async () => {
  const db = new FakeDb();
  setUniverseRepositoryForTests(db as any);
  await persistUniverseSnapshotForTests(liquidPayload(["BTC"]));
  await persistUniverseSnapshotForTests(liquidPayload([]));
  assert.equal(db.rows[0].missing_refresh_count, 1);
  assert.equal(db.rows[0].status, "active");
  await persistUniverseSnapshotForTests(liquidPayload([]));
  assert.equal(db.rows[0].missing_refresh_count, 2);
  assert.equal(db.rows[0].status, "delisted");
  await persistUniverseSnapshotForTests(liquidPayload(["BTC"]));
  assert.equal(db.rows[0].missing_refresh_count, 0);
  assert.equal(db.rows[0].status, "active");
  setUniverseRepositoryForTests(null);
});

test("repository integration: malformed and storage failures preserve durable LKG", async () => {
  const db = new FakeDb();
  db.rows = [durableRow("BTC")];
  setUniverseRepositoryForTests(db as any);
  await loadUniverseLastKnownGood();
  await assert.rejects(() => persistUniverseSnapshotForTests([{ universe: [] }, [{}]]));
  assert.equal(getUniverseDto().assets[0].rawSymbol, "BTC");
  db.failInsert = true;
  await assert.rejects(() => persistUniverseSnapshotForTests(liquidPayload(["ETH"])));
  assert.equal(getUniverseDto().assets[0].rawSymbol, "BTC");
  setUniverseRepositoryForTests(null);
});

test("HTTP integration: universe requires auth, caches privately, and redacts internals", async () => {
  const express = (await import("express")).default;
  const { registerUniverseHttpRoute } = await import("../lib/universeHttp");
  const app = express();
  app.use((req, _res, next) => { (req as any).session = req.headers.authorization ? { userId:"u" } : {}; next(); });
  registerUniverseHttpRoute(app, {
    load: async () => {},
    get: () => ({ version:"1:9",generatedAt:now.toISOString(),source:"live",stale:false,fallback:false,
      assets:[{...staticUniverse(now).assets[0],rawSymbol:"SECRET",canonicalSymbol:"BTC"}] }),
  });
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/api/universe`;
  try {
    assert.equal((await fetch(url)).status, 401);
    const response = await fetch(url, {headers:{authorization:"test"}});
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, max-age=60, stale-if-error=300");
    const body:any = await response.json();
    assert.equal(body.version, "1:9");
    assert.equal(body.assets[0].rawMetadata, undefined);
    assert.equal(body.assets[0].snapshotVersion, undefined);
  } finally { server.close(); }
});

test("HTTP integration: Quant market type accepts lowercase canonical values and rejects invalid", async () => {
  const express = (await import("express")).default;
  const { canonicalMarketType } = await import("../lib/universeHttp");
  const app=express(); app.use(express.json());
  app.post("/quant", (req,res) => {
    const value=canonicalMarketType(req.body.marketType);
    return value ? res.json({marketType:value}) : res.status(400).json({code:"INVALID_MARKET_TYPE"});
  });
  const server=app.listen(0); await new Promise<void>(r=>server.once("listening",r));
  const address=server.address(); assert(address&&typeof address==="object");
  const url=`http://127.0.0.1:${address.port}/quant`;
  try {
    let response=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({marketType:"perp"})});
    assert.equal((await response.json() as any).marketType,"PERP");
    response=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({marketType:"future"})});
    assert.equal(response.status,400);
  } finally {server.close();}
});

test("HTTP integration: Quant and Basket deny unsupported and quarantined perps", async () => {
  const express=(await import("express")).default;
  const {canonicalMarketType,discoveredPerpDenial}=await import("../lib/universeHttp");
  const app=express(); app.use(express.json());
  const handler=(req:any,res:any)=>{
    const mt=canonicalMarketType(req.body.marketType);
    if(!mt)return res.status(400).json({code:"INVALID_MARKET_TYPE"});
    const code=discoveredPerpDenial(mt,req.body.symbol,{discovered:true,supported:false},req.body.status);
    return code?res.status(422).json({code}):res.json({ok:true});
  };
  app.post("/quant",handler); app.post("/basket",handler);
  const server=app.listen(0); await new Promise<void>(r=>server.once("listening",r));
  const address=server.address(); assert(address&&typeof address==="object");
  try {
    for(const [path,status,code] of [["quant","quarantine","LIQUIDITY_QUARANTINED"],["basket","active","SCORER_UNSUPPORTED"]]){
      const response=await fetch(`http://127.0.0.1:${address.port}/${path}`,{method:"POST",
        headers:{"content-type":"application/json"},body:JSON.stringify({marketType:"perp",symbol:"NEW",status})});
      assert.equal(response.status,422); assert.equal((await response.json() as any).code,code);
    }
  } finally {server.close();}
});

test("HL tick ignores non-ok HTTP without advancing discovery cadence", async () => {
  let observed=0, updated=0;
  const ok=await runHlTick(()=>updated++,{fetch:sequenceFetch(
    response(false,{}),response(true,validTickMeta)),observe:()=>{observed++;}});
  assert.equal(ok,false); assert.equal(observed,0); assert.equal(updated,0);
});

test("HL tick safely rejects non-JSON responses", async () => {
  let observed=0;
  const ok=await runHlTick(()=>assert.fail("must not update"),{fetch:sequenceFetch(
    response(true,{},true),response(true,validTickMeta)),observe:()=>{observed++;}});
  assert.equal(ok,false); assert.equal(observed,0);
});

test("HL tick rejects malformed and misaligned payloads before dereference", async () => {
  for(const meta of [{},[{universe:[{name:"BTC"}]},[]]]) {
    let observed=0;
    const ok=await runHlTick(()=>assert.fail("must not update"),{fetch:sequenceFetch(
      response(true,{BTC:"100"}),response(true,meta)),observe:()=>{observed++;}});
    assert.equal(ok,false); assert.equal(observed,0);
  }
});

test("HL tick rejects non-plain or non-finite allMids", async () => {
  for(const mids of [[["BTC","100"]],{BTC:"not-a-number"},{BTC:Infinity}]) {
    let observed=0;
    const ok=await runHlTick(()=>assert.fail("must not update"),{fetch:sequenceFetch(
      response(true,mids),response(true,validTickMeta)),observe:()=>{observed++;}});
    assert.equal(ok,false); assert.equal(observed,0);
  }
});

test("failed HL tick preserves LKG and subsequent valid retry advances cadence", async () => {
  const db=new FakeDb(); db.rows=[durableRow("BTC")];
  setUniverseRepositoryForTests(db as any); await loadUniverseLastKnownGood();
  let observed=0,updated=0;
  assert.equal(await runHlTick(()=>updated++,{fetch:sequenceFetch(
    response(true,{BTC:"100"}),response(true,[{universe:[{name:"BTC"}]},[]])),
    observe:()=>{observed++;}}),false);
  assert.equal(getUniverseDto().assets[0].rawSymbol,"BTC");
  assert.equal(observed,0);
  assert.equal(await runHlTick(()=>updated++,{fetch:sequenceFetch(
    response(true,{BTC:"101"}),response(true,validTickMeta)),
    observe:()=>{observed++;},now:()=>123}),true);
  assert.equal(observed,1); assert.equal(updated,1);
  setUniverseRepositoryForTests(null);
});

test("central emission gate rejects unsafe HL assets for every card path before sinks", async () => {
  const sources=["auto_scanner","quant_scanner","trade_ideas","morning_brief","kronos","generic_log"];
  for(const status of ["quarantine","delisted"]) {
    const db=new FakeDb();
    db.rows=[durableRow("BTC",{status,eligible:false,
      eligibility_reasons:status==="quarantine"?["VOLUME_BELOW_25M"]:["NOT_TRADABLE"]})];
    setUniverseRepositoryForTests(db as any); await loadUniverseLastKnownGood();
    let sinkCount=0;
    for(const source of sources) {
      const policy=applyEmissionPolicy({source,symbol:"BTC",marketType:"PERP",assetClass:"crypto",
        direction:"LONG",entry:100,stopLoss:90,tp1:120,venueProfile:"hyperliquid_native"});
      if(!policy.decision.suppress)sinkCount++;
      assert.equal((policy.decision.snapshot.universeEligibility as any).allowed,false,source);
    }
    assert.equal(sinkCount,0);
  }
  setUniverseRepositoryForTests(null);
});

test("central emission gate rejects dynamic/HIP-3 unsupported but retains static fallback allowlist", async () => {
  const db=new FakeDb();
  db.rows=[durableRow("NEW",{canonical_symbol:"NEW",asset_class:"unknown",eligible:false,
    scorer_supported:false,scorer_support_reason:"SCORER_UNSUPPORTED",
    eligibility_reasons:["ASSET_CLASS_CONTEXT_MISSING","SCORER_UNSUPPORTED"]}),
    durableRow("XYZ",{canonical_symbol:"XYZ",asset_class:"equity",eligible:false,
      scorer_supported:false,scorer_support_reason:"EQUITY_CONTEXT_PENDING",
      eligibility_reasons:["EQUITY_CONTEXT_PENDING"]})];
  setUniverseRepositoryForTests(db as any); await loadUniverseLastKnownGood();
  for(const symbol of ["NEW","XYZ"]) {
    const result=applyEmissionPolicy({source:"trade_ideas",symbol,marketType:"PERP",
      direction:"LONG",entry:100,stopLoss:90,tp1:120,venueProfile:"phantom"});
    assert.equal(result.decision.suppress,true);
  }
  setUniverseRepositoryForTests(null);
  const legacy=applyEmissionPolicy({source:"auto_scanner",symbol:"BTC",marketType:"PERP",
    assetClass:"crypto",direction:"LONG",entry:100,stopLoss:90,tp1:120,venueProfile:"hyperliquid_native"});
  assert.equal((legacy.decision.snapshot.universeEligibility as any).allowed,true);
});