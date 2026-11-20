/** Conservative publication filter for raw, unreviewed social posts. */
export function publishableSocialText(value: unknown): boolean {
  if(typeof value!=="string"||!value.trim())return false;
  const text=value.normalize("NFKC").toLowerCase().replace(/[013@$]/g,c=>({"0":"o","1":"i","3":"e","@":"a","$":"s"}[c]!));
  return !/\b(?:f[\W_]*u[\W_]*c[\W_]*k(?:ing|ed|er|s)?|s[\W_]*h[\W_]*i[\W_]*t(?:ty|s)?|bullshit|motherfucker|bitch(?:es)?|asshole(?:s)?|cunt(?:s)?|nigg(?:er|a)s?|faggot(?:s)?)\b/i.test(text);
}
