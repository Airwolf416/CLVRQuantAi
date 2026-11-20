/** Trade Ideas only. Other scanners retain their existing conviction policy. */
export function tradeIdeaConvictionMinimumPct(riskTone: unknown, direction: unknown): number {
  const tone = String(riskTone || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  return tone === "RISK_OFF" && direction === "SHORT" ? 30 : 50;
}

export interface ResearchIdea {
  asset: string;
  direction: string;
  postHaircutConvictionPct: number | null;
  minimumConvictionPct: number | null;
  reasons: string[];
  gateStatus: "BELOW_GATE";
  researchOnly: true;
  convictionTrace?: {
    rawPct: number;
    calibratedPct: number;
    factors: string[];
  };
}

/** Deliberately omit actionable levels, alerts and persistence fields. */
export function researchIdea(card: any, reasons: string[], finalConviction?: number, minimum?: number): ResearchIdea {
  return {
    asset: String(card?.asset || card?.symbol || "Unknown asset"),
    direction: ["LONG", "SHORT"].includes(card?.direction) ? card.direction : "UNAVAILABLE",
    postHaircutConvictionPct: Number.isFinite(finalConviction) ? Number((finalConviction! * 100).toFixed(2)) : null,
    minimumConvictionPct: Number.isFinite(minimum) ? minimum! : null,
    reasons: reasons.length ? [...reasons] : ["Evaluation unavailable — candidate is not approved"],
    gateStatus: "BELOW_GATE",
    researchOnly: true,
    ...(card?.convictionTrace ? { convictionTrace: card.convictionTrace } : {}),
  };
}

export function selectResearchIdeas(ideas: ResearchIdea[], passingCount: number, limit: number): ResearchIdea[] {
  return [...ideas]
    .sort((a, b) => (b.postHaircutConvictionPct ?? -Infinity) - (a.postHaircutConvictionPct ?? -Infinity))
    .slice(0, Math.max(0, limit - passingCount));
}

export function isResearchIdea(card: any): boolean {
  return card?.researchOnly === true || card?.gateStatus === "BELOW_GATE";
}
