// Decode entity references one at a time; never parse untrusted headline markup.
// JSX renders the resulting string as text, so an encoded <img> stays literal.
export function decodeTextEntities(value) {
  if (typeof value !== "string" || !value.includes("&")) return value;
  return value.replace(/&(?:#(?:x[0-9a-f]+|[0-9]+)|[a-z][a-z0-9]+);/gi, entity => {
    if (entity.startsWith("&#")) {
      const hex = entity[2]?.toLowerCase() === "x";
      const point = parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
      if (point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)) {
        return String.fromCodePoint(point);
      }
      return entity;
    }
    if (typeof document === "undefined") return entity;
    const decoder = document.createElement("textarea");
    decoder.innerHTML = entity;
    return decoder.value;
  });
}