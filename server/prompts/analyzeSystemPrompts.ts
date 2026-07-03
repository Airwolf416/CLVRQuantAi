// ============================================================================
// SERVER-SIDE SYSTEM PROMPTS for POST /api/ai/analyze (security FIX 1).
//
// The client can no longer supply a system prompt. It sends a `feature` key
// and this map resolves the full analyst instructions server-side. Any
// unknown/missing feature falls back to DEFAULT_ANALYST_SYSTEM_PROMPT.
//
// Clients may additionally send a `context` string containing DATA ONLY
// (live prices, positions, macro rows). The route fences that context as
// untrusted data — it is never treated as instructions, and
// IMMUTABLE_AI_RULES is always appended last in the route itself.
// ============================================================================

import { ASK_AI_SYSTEM_PROMPT } from "./analyze/askAI";
import { TRADE_IDEAS_LEGACY_SYSTEM_PROMPT } from "./analyze/tradeIdeasLegacy";
import { TRADE_IDEAS_SYSTEM_PROMPT } from "./analyze/tradeIdeas";
import { AI_CHAT_SYSTEM_PROMPT } from "./analyze/aiChat";
import { QUANT_BRAIN_SYSTEM_PROMPT } from "./analyze/quantBrain";
import { BASKET_AI_SYSTEM_PROMPT } from "./analyze/basketAI";
import { WALLET_AI_SYSTEM_PROMPT } from "./analyze/walletAI";

export const DEFAULT_ANALYST_SYSTEM_PROMPT =
  "You are CLVR AI, the market-intelligence analyst for CLVRQuant — a data-driven, multi-asset " +
  "market analysis platform (crypto, equities, commodities, forex). Provide clear, numerical, " +
  "decision-support analysis grounded ONLY in the data provided to you. Never invent prices. " +
  "Frame everything as educational analysis, never as personalized financial advice.";

const MACRO_AI_SYSTEM_PROMPT =
  "You are QuantBrain, an elite quantitative market intelligence analyst for CLVRQuant. " +
  "Provide concise, data-driven analysis of economic releases. Focus on: 1) What the data means " +
  "for markets, 2) Which assets are most affected, 3) How this changes the macro picture, " +
  "4) What to watch next. Be precise and use numbers.";

const MORNING_BRIEF_SYSTEM_PROMPT =
  "You are CLVR AI — a senior markets correspondent (think Bloomberg / FT / Reuters) writing a " +
  "structured morning brief. Voice: clear, calm, authoritative economic-journalism prose. Short " +
  "concrete sentences. Always name the WHY, not just the WHAT. Use ONLY the live prices supplied " +
  "in the request — never invent numbers. Follow the exact output-format instructions in the " +
  "user message.";

export const SERVER_SYSTEM_PROMPTS: Record<string, string> = {
  macroAI: MACRO_AI_SYSTEM_PROMPT,
  morningBrief: MORNING_BRIEF_SYSTEM_PROMPT,
  askAI: ASK_AI_SYSTEM_PROMPT,
  tradeIdeasLegacy: TRADE_IDEAS_LEGACY_SYSTEM_PROMPT,
  tradeIdeas: TRADE_IDEAS_SYSTEM_PROMPT,
  aiChat: AI_CHAT_SYSTEM_PROMPT,
  quantBrain: QUANT_BRAIN_SYSTEM_PROMPT,
  basketAI: BASKET_AI_SYSTEM_PROMPT,
  walletAI: WALLET_AI_SYSTEM_PROMPT,
};
