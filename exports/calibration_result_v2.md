# CLVRQuantAI — P(win) Calibration Result (v2, out-of-fold)

_Generated 2026-05-14 18:07:34 UTC — `quant/pwin/calibration_eval.py`_

## Dataset

- **Model**: `direction_probability`
- **Instrument class**: crypto
- **Closed signals (N)**: 200
- **Observed base rate**: 44.5%
- **Baseline Brier (always predict base rate)**: `0.2470` — scorer must beat this to be worth keeping

## Out-of-fold metrics (5-fold stratified CV)

| Method | Brier OOF | Log-loss OOF | ECE | MCE |
|--------|-----------|--------------|-----|-----|
| raw | 0.2167 | 0.6421 | 0.0980 | 0.2284 |
| platt | 0.2118 | 0.6133 | 0.0239 | 0.0594 |
| isotonic | 0.2145 | 0.6238 | 0.1008 | 0.2517 |

_ECE = expected calibration error (sample-weighted gap), MCE = worst-bin gap. Production target: ECE < 0.05, MCE < 0.10._

## Bootstrap 90% CIs on Brier (1 000 resamples)

| Method | Mean Brier | 90% CI |
|--------|------------|--------|
| raw | 0.2166 | [0.1905, 0.2438] |
| platt | 0.2118 | [0.1924, 0.2319] |
| isotonic | 0.2147 | [0.1922, 0.2378] |

## Significance test (does calibrator actually beat raw?)

| Calibrator | P(cal beats raw) | Δ Brier (mean) | 90% CI on Δ |
|------------|------------------|----------------|-------------|
| platt | 0.857 | +0.0048 | [-0.0025, +0.0124] |
| isotonic | 0.657 | +0.0020 | [-0.0054, +0.0094] |

_Selection rule: ≥ 0.80 to qualify; Platt preferred when within 0.005 Brier of isotonic._

## Selected calibrator

- **Chosen**: `platt`
- **Final params**: `{"kind": "platt", "a": 3.189665910445713, "b": -1.6734305028684011}`
- **Pickle path**: `quant/calibrators/direction_probability__crypto__platt.pkl`

## Verdict

- Selected calibrator: platt. OOF Brier 0.2118 vs raw 0.2167.
- Isotonic OOF ECE 0.101 above 0.05 target.
- N=200 is small. Treat selection as provisional; re-evaluate weekly until N >= 500.
