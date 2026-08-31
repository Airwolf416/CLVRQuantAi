---
name: Calibration label integrity
description: Safety boundary between sampled excursion observations and enforceable TP-before-SL calibration labels.
---

Discrete mark samples may update observed MFE/MAE, but they must not produce WIN/LOSS labels: either barrier could have been touched and reversed between samples. A calibration label requires a provider-guaranteed complete, closed interval with continuous timestamps; a single-barrier touch may label, while both-hit, gaps, missing data, or unknown continuity must censor.

**Why:** Treating the first sampled mark beyond a barrier as proof creates fabricated TP-before-SL outcomes and can turn a shadow expectancy model into unsafe live suppression.

**How to apply:** Keep expectancy enforcement shadowed until authoritative interval labels reach the approved sample thresholds. Any new price provider must prove interval closure, continuity, source, and version before its labels enter calibration.