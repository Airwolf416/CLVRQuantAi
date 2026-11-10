/**
 * Anthropic's JSON parser rejects lone UTF-16 surrogates, even though Node's
 * JSON.stringify escapes them and JSON.parse accepts those escapes.
 * Apply limits to text BEFORE serialization and never split a surrogate pair.
 */
export function clampAiText(text: string, maxLength: number): string {
  if (!Number.isSafeInteger(maxLength) || maxLength < 0) {
    throw new RangeError("AI text limit must be a nonnegative safe integer");
  }
  let end = Math.min(text.length, maxLength);
  if (end > 0 && end < text.length) {
    const previous = text.charCodeAt(end - 1);
    const next = text.charCodeAt(end);
    if (previous >= 0xD800 && previous <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) end--;
  }
  // Also repair malformed characters already present in client or feed data.
  return text.slice(0, end).toWellFormed();
}

/** Final transport boundary: protects generated context and tool-result text too. */
export function serializeAiRequest(payload: unknown): string {
  const body = JSON.stringify(payload, (_key, value) =>
    typeof value === "string" ? value.toWellFormed() : value);
  if (typeof body !== "string") throw new TypeError("AI request must have a JSON body");
  return body;
}

/** An upstream auth/request error is not a failure of the user's app session. */
export function describeAiProviderFailure(status: number, rawBody: string) {
  if (/credit balance|credit_balance/i.test(rawBody) || status === 529) {
    return { status: 503, code: "AI_MAINTENANCE", error: "__MAINTENANCE__" };
  }
  if (/request body is not valid JSON|unexpected end of hex escape|surrogate|invalid unicode/i.test(rawBody)) {
    return {
      status: 502,
      code: "AI_REQUEST_ENCODING_ERROR",
      error: "CLVR AI could not process the request because of a text-encoding error. Please try again.",
    };
  }
  if (status === 429) {
    return { status: 503, code: "AI_BUSY", error: "CLVR AI is temporarily busy. Please try again shortly." };
  }
  return {
    status: 502,
    code: "AI_UPSTREAM_ERROR",
    error: "CLVR AI could not complete this request. Please try again shortly.",
  };
}
