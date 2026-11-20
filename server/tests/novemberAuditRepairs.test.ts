import test from "node:test";
import assert from "node:assert/strict";
import {macroEventTime,upcomingBriefEvents} from "../lib/macroEventTime";
import {journalNumber,journalDisplayEntry,journalDisplayEntries} from "../lib/journalDisplay";
import {publishableSocialText} from "../lib/socialModeration";
import {guardBriefPublicationFacts} from "../lib/briefPublicationFacts";
import {researchIdea} from "../lib/tradeIdeaEvaluation";
import {createXyzSignalFeed} from "../services/xyzSignalFeed";
import {parseBusinessRss} from "../lib/macroBusinessNews";

test("Eastern event instants respect both daylight and standard time",()=>{
  assert.equal(macroEventTime({date:"2026-07-10",timeET:"10:00"}),Date.parse("2026-07-10T14:00:00Z"));
  assert.equal(macroEventTime({date:"2026-11-20",timeET:"10:00"}),Date.parse("2026-11-20T15:00:00Z"));
  assert.equal(macroEventTime({date:"2026-11-20",timeET:"25:00"}),null);
});
test("brief watch list excludes a passed 10 AM release at 10:26 AM",()=>{
  const now=Date.parse("2026-11-20T15:26:00Z");
  const rows=[{date:"2026-11-20",timeET:"10:00",name:"UoM"},{date:"2026-11-20",timeET:"12:15",name:"Cook"}];
  assert.deepEqual(upcomingBriefEvents(rows,now).map(r=>r.name),["Cook"]);
});
test("journal losses and repeated percent signs normalize without rewriting source",()=>{
  const raw={entry:"0,22571",outcome:"LOSS",pnlPct:"+3.81%%"};
  assert.equal(journalNumber(raw.entry),0.22571);
  assert.equal(journalDisplayEntry(raw).pnlPct,"-3.81");
  assert.equal(raw.pnlPct,"+3.81%%");
});
test("conflicting imported INJ percentages are flagged instead of printing both",()=>{
  const row=journalDisplayEntry({entry:"1",outcome:"WIN",pnlPct:"+18.81%%",notes:"@airwolf416 +4.70% gain"});
  assert.ok(row.displayWarning);
  assert.equal(row.sourceAttribution,"Imported community record · @airwolf416");
});
test("duplicate journal imports are identified without deleting separate user records",()=>{
  const row={asset:"INJ",direction:"LONG",entry:"4.50",notes:"Imported Phantom position",pnlPct:"3.81",outcome:"WIN"};
  const rows=journalDisplayEntries([{...row,id:"first"},{...row,id:"second"}]);
  assert.equal(rows.length,2);
  assert.match(String(rows[1].displayWarning),/duplicate import/);
});
test("social publication filters common and obfuscated profanity without hiding normal news",()=>{
  for(const text of ["fuck this","what the f u c k","bullshit","f@ggot","sh1t"]){assert.equal(publishableSocialText(text),false,text);}
  assert.equal(publishableSocialText("$NVDA earnings reported after the close."),true);
});
test("unverified extraordinary corporate and ETF claims cannot reach brief publication",()=>{
  const brief:any={impactfulNews:[{title:"Jensen Huang's departure from NVDA"},{title:"MSCI removing Strategy"},{title:"$2.89B spot BTC ETF outflows"},{title:"Markets await the close"}],commentary:[{text:"NVDA EPS estimate is $2.47. Liquidity remains uncertain."}]};
  guardBriefPublicationFacts(brief,[]);
  assert.equal(brief.impactfulNews.length,1);
  assert.equal(brief.commentary[0].text,"Liquidity remains uncertain.");
});
test("speaker attribution and completed UoM releases are checked against real scheduled events",()=>{
  const brief:any={watchToday:["Watch Fed Waller at 12:15 ET","Watch Fed Cook at 12:15 ET","Watch UoM at 10:00 ET"]};
  const events=[{name:"FOMC Member Waller Speaks",date:"2026-11-20",timeET:"08:25"},{name:"FOMC Member Cook Speaks",date:"2026-11-20",timeET:"12:15"},{name:"Revised UoM Consumer Sentiment",date:"2026-11-20",timeET:"10:00"}];
  guardBriefPublicationFacts(brief,events,Date.parse("2026-11-20T15:26:00Z"));
  assert.deepEqual(brief.watchToday,["Watch Fed Cook at 12:15 ET"]);
});
test("below-gate research keeps raw-score evidence without actionable levels",()=>{
  const result=researchIdea({asset:"BTC",entry:1,convictionTrace:{rawPct:74,calibratedPct:40,factors:["Chase ×0.7","Low sample ×0.8"]}},["below gate"],0.224,50);
  assert.equal(result.postHaircutConvictionPct,22.4);
  assert.equal(result.convictionTrace?.rawPct,74);
  assert.equal("entry" in result,false);
});
test("business RSS fallback retains attribution and rejects invalid or unsafe rows",()=>{
  const xml='<rss><channel><item><title><![CDATA[Inflation &amp; rates]]></title><link>https://www.bbc.com/news/business/example</link><pubDate>Fri, 20 Nov 2026 10:00:00 GMT</pubDate></item><item><title>Inflation</title><link>javascript:alert(1)</link><pubDate>Fri, 20 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>';
  const rows=parseBusinessRss(xml,["inflation"],Date.parse("2026-11-20T12:00:00Z"));
  assert.equal(rows.length,1);
  assert.equal(rows[0].source,"BBC Business · public RSS");
  assert.equal(rows[0].title,"Inflation & rates");
  assert.throws(()=>parseBusinessRss("<html>Denied</html>",[]),/Invalid/);
});
test("one xyz candle failure does not erase other markets or fabricate a signal",async()=>{
  const now=Date.parse("2026-11-20T16:00:00Z");
  const feed=createXyzSignalFeed({now:()=>now,requestSpacingMs:0,fetch:async(_url,init)=>{
    const payload=JSON.parse(String(init?.body));
    if(payload.type==="metaAndAssetCtxs")return new Response(JSON.stringify([{universe:[{name:"xyz:AAPL"},{name:"xyz:NVDA"}]},[{markPx:"100"},{markPx:"200"}]]));
    if(payload.req.coin==="xyz:AAPL")return new Response("",{status:503});
    return new Response(JSON.stringify(Array.from({length:60},(_,index)=>({t:now-(60-index)*86400000,c:String(100+index)}))));
  }});
  const snapshot=await feed.getSnapshot();
  assert.equal(snapshot.rows.length,2);
  assert.equal(snapshot.rows.find(row=>row.coin==="AAPL")?.signal,"NO_DATA");
  assert.match(snapshot.rows.find(row=>row.coin==="AAPL")?.historyLabel||"",/Source unavailable/);
  assert.equal(snapshot.stale,true);
});
