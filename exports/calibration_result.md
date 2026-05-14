# CLVRQuantAI — P(win) Calibration Result

_Generated 2026-05-14 17:12:23 UTC_

## Dataset
- **Model**: `direction_probability`
- **Instrument class**: crypto
- **Closed signals**: 200
- **Observed base rate**: 46.0%
- **Synthetic source**: overconfident scorer where true P(win) = sigmoid(2·p_raw − 1)

## Raw (pre-calibration) metrics
- Brier score: **0.2683**  _(lower is better)_
- Log-loss:    **0.8243**  _(lower is better)_

## Platt scaling (sigmoid-based, monotonic)
- Params: a = `1.5991`, b = `-0.9733`
- Brier:   0.2683 → **0.2366**  (Δ = +0.0318)
- LogLoss: 0.8243 → **0.6661**  (Δ = +0.1583)

## Isotonic regression (PAV, non-parametric)
- Breakpoints: **11**
- Brier: 0.2683 → **0.2464**  (Δ = +0.0219)

## Reliability table (10 bins)

| Bin | Predicted P(win) | Observed P(win) | N | Gap |
|-----|------------------|-----------------|---|-----|
| [0.0, 0.1] | 0.0479 | 0.3333 | 15 | -0.2854 |
| [0.1, 0.2] | 0.1395 | 0.2500 | 20 | -0.1105 |
| [0.2, 0.3] | 0.2527 | 0.3182 | 22 | -0.0655 |
| [0.3, 0.4] | 0.3472 | 0.3810 | 21 | -0.0337 |
| [0.4, 0.5] | 0.4526 | 0.5909 | 22 | -0.1383 |
| [0.5, 0.6] | 0.5474 | 0.3750 | 24 | +0.1724 |
| [0.6, 0.7] | 0.6646 | 0.4737 | 19 | +0.1909 |
| [0.7, 0.8] | 0.7628 | 0.7619 | 21 | +0.0009 |
| [0.8, 0.9] | 0.8437 | 0.5333 | 15 | +0.3104 |
| [0.9, 1.0] | 0.9498 | 0.5714 | 21 | +0.3783 |

_Positive gap = scorer is **over**confident in that bucket; negative = **under**confident. A perfectly calibrated model has gap ≈ 0 in every bucket._
