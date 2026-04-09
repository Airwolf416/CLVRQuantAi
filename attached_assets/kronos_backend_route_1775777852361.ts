// ================================================================
// KRONOS FORECAST ENGINE — Backend Route
// Add this block inside your registerRoutes() function in server/routes.ts
// Place it after the /api/quant route (around line 5027)
// ================================================================

  // ── KRONOS FORECAST ENGINE ──────────────────────────────────────────────────
  app.post("/api/kronos", async (req, res) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Anthropic API key not configured" });

    try {
      const { ticker = "BTC", timeframe = "4h" } = req.body;
      if (!ticker) return res.status(400).json({ error: "Missing ticker" });

      const cls: string = ["NVDA","TSLA","AAPL","MSFT","META","MSTR","COIN","PLTR","AMZN","GOOGL","AMD"].includes(ticker)
        ? "equity"
        : ["XAU","CL","SILVER","NATGAS","COPPER","BRENTOIL"].includes(ticker)
        ? "commodity"
        : "crypto";

      // Fetch candles using your existing helper
      const candles = await fetchQuantCandles(ticker, cls, timeframe, 48);
      if (!candles || candles.length < 20) {
        return res.status(502).json({ error: "Insufficient candle data for Kronos forecast" });
      }

      // Normalize candle format (handles both {open,high,low,close} and {o,h,l,c})
      const normalize = (c: any) => ({
        o: parseFloat((c.open ?? c.o ?? 0).toFixed(6)),
        h: parseFloat((c.high ?? c.h ?? 0).toFixed(6)),
        l: parseFloat((c.low  ?? c.l ?? 0).toFixed(6)),
        c: parseFloat((c.close ?? c.c ?? 0).toFixed(6)),
        v: Math.round(c.volume ?? c.v ?? 0),
      });

      const recent = candles.slice(-24).map(normalize).filter(c => c.c > 0);
      if (recent.length < 10) return res.status(502).json({ error: "Not enough valid candles" });

      const currentPrice = recent[recent.length - 1].c;

      // Compute historical volatility from log returns
      const closes = recent.map(c => c.c);
      const logReturns = closes.slice(1).map((c, i) => Math.log(c / closes[i]));
      const meanR = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
      const variance = logReturns.reduce((a, b) => a + Math.pow(b - meanR, 2), 0) / logReturns.length;
      const histVolAnnualized = Math.sqrt(variance * 252) * 100;
      const nextCandleRangePct = Math.sqrt(variance) * 100 * 2; // ±2σ estimate for next candle

      // Format OHLCV sequence for Kronos prompt
      const ohlcvStr = recent
        .map((c, i) => `T${i < recent.length - 1 ? `-${recent.length - 1 - i}` : "+0"}: O=${c.o} H=${c.h} L=${c.l} C=${c.c} V=${c.v}`)
        .join("\n");

      const system = `You are the Kronos Forecast Engine — a probabilistic K-line sequence model inspired by the Kronos foundation model (AAAI 2026, arXiv:2508.02739). You analyze OHLCV sequences using autoregressive pattern recognition to generate multi-trajectory price forecasts.

Your methodology:
1. Analyze the K-line sequence for momentum, mean-reversion pressure, volatility regime, and structural pivot levels
2. Generate 3 distinct forward trajectories (BULL / BASE / BEAR) representing 5 future candles
3. Assign probabilities to each trajectory (must sum to 100)
4. Derive an ensemble signal by weighting trajectory directions and probabilities
5. Estimate forward volatility regime

Output ONLY valid JSON. No markdown, no backticks, no text outside the JSON object.

{
  "asset": "string",
  "timeframe": "string",
  "current_price": number,
  "ensemble_signal": "STRONG_LONG"|"LONG"|"NEUTRAL"|"SHORT"|"STRONG_SHORT",
  "ensemble_confidence": 0-100,
  "volatility_forecast": {
    "regime": "LOW"|"MODERATE"|"HIGH"|"EXTREME",
    "annualized_pct": number,
    "next_candle_range_pct": number,
    "note": "string"
  },
  "trajectories": {
    "bull": {
      "probability": 0-100,
      "prices": [number, number, number, number, number],
      "final_pct_change": number,
      "catalyst": "string",
      "label": "string"
    },
    "base": {
      "probability": 0-100,
      "prices": [number, number, number, number, number],
      "final_pct_change": number,
      "catalyst": "string",
      "label": "string"
    },
    "bear": {
      "probability": 0-100,
      "prices": [number, number, number, number, number],
      "final_pct_change": number,
      "catalyst": "string",
      "label": "string"
    }
  },
  "key_levels": {
    "resistance": number,
    "support": number
  },
  "sequence_pattern": "string",
  "model_note": "string"
}

Rules:
- trajectory probabilities must sum to exactly 100
- prices arrays must have exactly 5 values in ascending time order
- final_pct_change is relative to current_price
- be precise — derive all price levels from the actual OHLCV data provided`;

      const userMsg = `Asset: ${ticker} | Market: ${cls.toUpperCase()} | Timeframe: ${timeframe}
Current Price: $${currentPrice}
Historical Volatility: ${histVolAnnualized.toFixed(1)}% annualized | Est. next-candle range: ±${nextCandleRangePct.toFixed(2)}%

OHLCV K-LINE SEQUENCE — ${recent.length} candles (T-${recent.length - 1} oldest → T+0 current):
${ohlcvStr}

Detect the dominant K-line pattern in this sequence, then generate probabilistic 5-candle forecast trajectories.`;

      const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1200,
          system,
          messages: [{ role: "user", content: userMsg }],
        }),
      });

      if (!aiRes.ok) {
        const e = await aiRes.text();
        console.error("[/api/kronos]", e);
        return res.status(502).json({ error: "Kronos AI Engine failed." });
      }

      const aiData: any = await aiRes.json();
      const rawText = aiData.content?.[0]?.text || "";
      const clean = rawText.replace(/```json|```/g, "").trim();

      let parsed: any;
      try {
        parsed = JSON.parse(clean);
      } catch {
        console.error("[/api/kronos parse]", clean.slice(0, 200));
        return res.status(500).json({ error: "Kronos returned malformed data." });
      }

      // Enrich with server-computed volatility as fallback
      if (!parsed.volatility_forecast?.annualized_pct) {
        parsed.volatility_forecast = {
          regime: histVolAnnualized > 80 ? "EXTREME" : histVolAnnualized > 50 ? "HIGH" : histVolAnnualized > 25 ? "MODERATE" : "LOW",
          annualized_pct: parseFloat(histVolAnnualized.toFixed(1)),
          next_candle_range_pct: parseFloat(nextCandleRangePct.toFixed(2)),
          note: "Server-computed from log returns",
        };
      }

      parsed.generated_at = new Date().toISOString();
      res.json(parsed);

    } catch (err: any) {
      console.error("[Kronos Engine]", err);
      res.status(500).json({ error: "Internal Kronos Engine error." });
    }
  });
  // ── END KRONOS ──────────────────────────────────────────────────────────────
