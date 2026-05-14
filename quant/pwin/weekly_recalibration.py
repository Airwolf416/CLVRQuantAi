"""
Weekly Platt/isotonic refit for every (model_name, instrument_class) pair
that has enough closed signals.

Phase 1: MANUAL TRIGGER ONLY. Either:
  - POST /calibration/recalibrate  (admin button — fits one pair)
  - python -m quant.pwin.weekly_recalibration  (CLI — fits all pairs)
  - await run_weekly_recalibration()  (programmatic from the FastAPI app)

A scheduled job is deliberately out of scope until the graduation criteria
in pwin/__init__.py are met (so we don't auto-deploy a calibrator fit on
two weeks of noise).
"""
import asyncio
import logging
from typing import List, Optional

from .calibration import fit_calibrator
from .tracker import model_columns


log = logging.getLogger("quant.pwin.recalibration")


# Instrument classes we track. The Node-side normalizer in quantClient.ts
# emits these four (BTC/ETH are sub-classes of crypto for scoring purposes
# only; for calibration we collapse them all to "crypto").
INSTRUMENT_CLASSES = ("crypto", "fx", "commodity", "equity")


async def run_weekly_recalibration(
    instrument_classes: Optional[List[str]] = None,
    method: str = "auto",
    window_days: Optional[int] = 90,
) -> dict:
    """Fit every (model, class) pair. Returns a per-pair summary dict.
    Pairs with insufficient data are reported but do not abort the run."""
    classes = list(instrument_classes or INSTRUMENT_CLASSES)
    results: dict = {"runs": [], "fitted": 0, "skipped": 0, "errors": 0}
    for model_name in model_columns():
        for icls in classes:
            try:
                res = await fit_calibrator(
                    model_name, icls, method=method, window_days=window_days,
                )
            except Exception as e:
                log.exception("recalibration failed for %s/%s", model_name, icls)
                results["runs"].append({
                    "model_name": model_name,
                    "instrument_class": icls,
                    "ok": False,
                    "error": str(e),
                })
                results["errors"] += 1
                continue
            results["runs"].append(res)
            if res.get("ok"):
                results["fitted"] += 1
                log.info(
                    "recalibrated %s/%s n=%d brier %.4f→%.4f loglos %.4f→%.4f",
                    model_name, icls, res["n"],
                    res["brier_before"], res["brier_after"],
                    res["log_loss_before"], res["log_loss_after"],
                )
            else:
                results["skipped"] += 1
    return results


if __name__ == "__main__":
    out = asyncio.run(run_weekly_recalibration())
    import json
    print(json.dumps(out, indent=2, default=float))
