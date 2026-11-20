/** Read-time presentation repair; never rewrites an account's journal records. */
export function journalNumber(value: unknown): number | null {
  if (value == null || String(value).trim()==="") return null;
  let text=String(value).trim().replace(/[%$+\s]/g,"");
  text=/^-?\d+,\d+$/.test(text)&&!/^[-]?\d{1,3},\d{3}$/.test(text)
    ? text.replace(",",".") : text.replace(/,/g,"");
  const number=Number(text);
  return Number.isFinite(number)?number:null;
}

export function journalDisplayEntry<T extends Record<string, any>>(entry:T):T & Record<string,any> {
  const raw=journalNumber(entry.pnlPct);
  const pnl=raw==null?null:entry.outcome==="LOSS"?-Math.abs(raw):raw;
  const notePercent=String(entry.notes||"").match(/([+-]?\d+(?:[.,]\d+)?)\s*%/);
  const notePnl=notePercent?journalNumber(notePercent[1]):null;
  const conflict=pnl!=null&&notePnl!=null&&Math.abs(pnl-notePnl)>0.05;
  return {...entry,
    entry:journalNumber(entry.entry)??entry.entry,
    pnlPct:pnl==null?null:String(pnl),
    sourceAttribution:/@airwolf416/i.test(String(entry.notes||""))?"Imported community record · @airwolf416":null,
    displayWarning:conflict?"Imported note and recorded PnL disagree; verify the source before relying on this result.":null,
  };
}

/** Flag repeated imports without deleting potentially distinct user trades. */
export function journalDisplayEntries<T extends Record<string,any>>(entries:T[]):Array<T & Record<string,any>> {
  const seen=new Set<string>();
  return entries.map(entry=>{
    const row=journalDisplayEntry(entry);
    if(!row.notes)return row;
    const key=JSON.stringify([row.asset,row.direction,row.entry,row.stop,row.tp1,row.tp2,row.size,row.outcome,row.pnlPct,row.notes]);
    const duplicate=seen.has(key);seen.add(key);
    return duplicate?{...row,displayWarning:row.displayWarning||"Possible duplicate import — retained until you verify whether these are separate trades."}:row;
  });
}
