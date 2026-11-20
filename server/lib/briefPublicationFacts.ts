import { macroEventTime } from "./macroEventTime";

// No verified corporate-news, earnings-consensus or ETF-flow evidence is
// supplied to this generation path. Never let model memory supply those facts.
const UNSOURCED = /\b(?:EPS|earnings per share|(?:ETF|exchange.traded fund).{0,70}(?:inflows?|outflows?|\bflows?\b)|(?:Jensen|Huang|CEO|chief executive).{0,70}(?:depart\w*|resign\w*|step(?:s|ping)? down|leav\w*|oust\w*)|MSCI.{0,70}(?:remov\w*|exclu\w*|delet\w*))\b/i;

export function guardBriefPublicationFacts(brief:any, events:any[], now=Date.now()):void {
  const allowed = (text:string) => {
    if(UNSOURCED.test(text))return false;
    const speaker=text.match(/\b(Waller|Cook|Powell|Williams|Bostic|Daly|Bowman|Jefferson)\b/i)?.[1];
    const stated=text.match(/\b(\d{1,2}:\d{2})\s*(?:ET|EST|EDT)\b/i)?.[1];
    if(speaker&&stated)return events.some(event=>
      String(event.name||"").toLowerCase().includes(speaker.toLowerCase())
      && stated.padStart(5,"0")===String(event.timeET||event.time||"").slice(0,5));
    return true;
  };
  const clean=(text:string)=>text.split(/(?<=[.!?])\s+|\n+/).filter(allowed).join(" ");
  const proseFields=["summary","headline","keyRisk","riskNote","macroRiskNote","btc","eth","sol","gold","silver","oil","forex","equities"];
  for(const field of proseFields)if(typeof brief[field]==="string")brief[field]=clean(brief[field]);
  if(Array.isArray(brief.commentary))brief.commentary=brief.commentary.flatMap((item:any)=>{
    const text=clean(String(item.text||""));return text?[{...item,text}]:[];
  });
  if(Array.isArray(brief.impactfulNews))brief.impactfulNews=brief.impactfulNews.filter((item:any)=>allowed(JSON.stringify(item)));
  for(const key of ["watchToday","watchItems"])if(Array.isArray(brief[key])){
    brief[key]=brief[key].filter((item:any)=>{
      const text=String(item);
      if(!allowed(text))return false;
      const speaker=text.match(/\b(Waller|Cook|Powell|Williams|Bostic|Daly|Bowman|Jefferson)\b/i)?.[1];
      if(speaker){
        const matches=events.filter(event=>String(event.name||"").toLowerCase().includes(speaker.toLowerCase()));
        return matches.some(event=>{
          const time=macroEventTime(event);
          const stated=text.match(/\b(\d{1,2}:\d{2})\s*(?:ET|EST|EDT)\b/i)?.[1];
          return time!=null&&time>now&&!event.released&&(!stated||stated.padStart(5,"0")===String(event.timeET||event.time||"").slice(0,5));
        });
      }
      const eventNames=["UoM","Consumer Sentiment","Retail Sales","PPI","CPI","Nonfarm"];
      const eventName=eventNames.find(name=>text.toLowerCase().includes(name.toLowerCase()));
      if(!eventName)return true;
      return events.some(event=>String(event.name||"").toLowerCase().includes(eventName.toLowerCase())
        && !event.released&&(macroEventTime(event)??0)>now);
    });
  }
}
