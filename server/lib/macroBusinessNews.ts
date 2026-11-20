/** Public, attributed fallback. Never treats provider errors as zero headlines. */
export function parseBusinessRss(xml:string, keywords:string[], now=Date.now()):any[] {
  if(xml.length>2_000_000||!/<rss\b/i.test(xml))throw new Error("Invalid business RSS response");
  const field=(block:string,name:string)=>{
    const value=block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,"i"))?.[1]||"";
    return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1").trim()
      .replace(/&(?:amp|lt|gt|quot|apos);/g,entity=>({"&amp;":"&","&lt;":"<","&gt;":">","&quot;":'"',"&apos;":"'"}[entity]!));
  };
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].slice(0,100).flatMap(match=>{
    const title=field(match[1],"title");
    const url=field(match[1],"link");
    const ts=Date.parse(field(match[1],"pubDate"));
    if(!title||!/^https:\/\//i.test(url)||!Number.isFinite(ts)||ts>now+60_000
      ||!keywords.some(keyword=>title.toLowerCase().includes(keyword.toLowerCase())))return[];
    return [{id:`bbc-${url}`,title,url,ts,source:"BBC Business · public RSS",assets:[],impact:"LOW",votes:{}}];
  });
}
