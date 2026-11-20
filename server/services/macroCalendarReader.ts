let reader: (()=>Promise<any[]>) | null = null;

export function setMacroCalendarReader(value:()=>Promise<any[]>):void { reader=value; }

/** Internal callers share the real source cache, not an unauthenticated HTTP call. */
export async function readMacroCalendar():Promise<any[]> {
  if(!reader)throw new Error("Macro calendar source has not initialized");
  return reader();
}
