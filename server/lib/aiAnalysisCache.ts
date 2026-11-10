/** Empty trade batches must not lock users into a shared cached no-setup result. */
export function shouldCacheAiAnalysis(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (!trimmed.startsWith("{")) return true;
  try {
    const parsed = JSON.parse(trimmed);
    return !Array.isArray(parsed?.trades) || parsed.trades.length > 0;
  } catch {
    return !trimmed.includes('"trades"');
  }
}
