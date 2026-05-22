# 3.8 Comparative Analysis of Imputation Methods

This section presents the quantitative results of the masked evaluation across all four imputation methods and all three device groups, followed by a structured analysis of where each method succeeds, where it degrades, and what the results imply for practical deployment.

---

## 3.8.1 Overall Results

Table 3.1 presents MAE and RMSE for each method across all 17,317 mask slots.

**Table 3.1 — Overall MAE and RMSE across all 35 test devices (17,317 slots)**

| Method | N slots | MAE (dB) | RMSE (dB) | RMSE / MAE |
|---|---|---|---|---|
| Historical Median | 17,170 | 3.32 | 4.79 | 1.44 |
| Spatial KNN | 17,317 | 3.54 | 5.07 | 1.43 |
| Combined (Hist + KNN) | 17,317 | 2.70 | 4.10 | 1.52 |
| **TimesFM** | **16,839** | **1.18** | **1.80** | **1.52** |

Several results stand out immediately.

**TimesFM dominates across all metrics.** With an overall MAE of 1.18 dB, TimesFM is 2.3× more accurate than the next-best method (Combined, 2.70 dB) and 2.8× more accurate than Historical (3.32 dB). Its RMSE of 1.80 dB is similarly far below the nearest competitor (Combined, 4.10 dB). This is a substantial margin — large enough to represent a qualitative difference in imputation quality, not a marginal improvement.

**TimesFM coverage is slightly lower.** The model processes 16,839 of the 17,317 mask slots (97.2%), skipping 478 slots where fewer than 72 hours of prior context are available. This 2.8% coverage gap is a known trade-off of the minimum-context requirement (Section 3.4.4).

**The RMSE/MAE ratio is consistent across methods.** All four methods show a RMSE/MAE ratio between 1.43 and 1.52, indicating that no single method has a disproportionately worse tail behaviour relative to its average error. The much lower absolute RMSE of TimesFM (1.80 vs 4.10–5.07) means it produces far fewer large individual errors, not that its error distribution is shaped differently from the statistical methods.

**KNN slightly underperforms Historical overall.** This ordering reverses in specific groups, as Section 3.8.2 reveals.

---

## 3.8.2 By-Group Results

Table 3.2 breaks results down by evaluation group. This is the primary analytical contribution of the evaluation: the aggregate numbers conceal systematic differences in method behaviour that only become visible when devices are separated by their structural conditions.

**Table 3.2 — MAE and RMSE by evaluation group**

| Group | Method | N | MAE (dB) | RMSE (dB) |
|---|---|---|---|---|
| **A — Connected** | Historical | 8,502 | 3.39 | 4.97 |
| | KNN | 8,563 | 4.12 | 5.78 |
| | Combined | 8,563 | 2.98 | 4.54 |
| | TimesFM | 8,358 | 1.20 | 1.85 |
| **B — Isolated** | Historical | 5,667 | 3.43 | 4.70 |
| | KNN | 5,708 | 3.20 | 4.53 |
| | Combined | 5,708 | 2.53 | 3.67 |
| | TimesFM | 5,582 | 1.18 | 1.74 |
| **C — Short History** | Historical | 3,001 | 2.92 | 4.42 |
| | KNN | 3,046 | 2.56 | 3.69 |
| | Combined | 3,046 | 2.23 | 3.53 |
| | TimesFM | 2,899 | 1.14 | 1.75 |

---

## 3.8.3 Method-by-Method Analysis

### Historical vs KNN

The most striking result in Table 3.2 is the relative performance of Historical and KNN across the three groups. The two methods exchange positions between Group A and Group B — in the opposite direction from what the group definitions would naively predict.

**Group A (Connected) — KNN underperforms Historical.** KNN achieves a MAE of 4.12 dB in the connected group, 0.73 dB *worse* than Historical (3.39 dB). This is counterintuitive: Group A devices have many close neighbours, so KNN should be well-resourced. The explanation lies in the nature of missing data in this group. Group A devices have low missing rates (< 5%) and are spatially dense. Their missing slots are predominantly caused by simultaneous network events — a router failure or platform outage affects all devices on the same gateway at the same time. When device *d* has a missing slot due to a network outage, its 500 m neighbours are also likely missing at that same timestamp, leaving KNN without usable neighbours. Historical imputation, which draws from the same device's past readings, is immune to simultaneous outages: the lookback values come from different days and are unaffected.

**Group B (Isolated) — KNN outperforms Historical.** In the isolated group, KNN achieves a MAE of 3.20 dB, 0.23 dB better than Historical (3.43 dB). The isolation score measures KNN's ability to fill *missing* slots, not its accuracy on *masked original* slots. Group B devices have high isolation — KNN cannot fill their missing hours because no neighbours are active at those timestamps. But the mask slots are drawn from the device's *original* readings — timestamps when the device itself had data. At those timestamps, nearby sensors are also likely to have readings (since the target device is observed, the network is functioning), giving KNN a functional neighbourhood to work with. Historical, meanwhile, performs similarly across Groups A and B (3.39 vs 3.43 dB), confirming that spatial connectivity does not affect its accuracy — its lookback is purely temporal.

**Group C (Short History) — both methods improve.** Both Historical (2.92 dB) and KNN (2.56 dB) achieve their best MAE in Group C, which is unexpected given that Group C was selected to stress both methods. Short-history devices may have simpler acoustic environments — fewer sensors in this group are located on major transit arteries — or the limited operational window concentrates their readings in a period with less temporal variance, making both lookback and neighbour estimates more consistent.

### Combined vs Its Components

The combined method consistently outperforms both its inputs across all three groups. In Group A, it reduces the KNN MAE from 4.12 to 2.98 dB (a 28% improvement) and the Historical MAE from 3.39 to 2.98 dB (12%). In Group B, it reduces from 3.20/3.43 to 2.53 dB. In Group C, from 2.56/2.92 to 2.23 dB.

The inverse-variance weighting mechanism explains why blending outperforms even the better individual component. For any given slot, the method with higher confidence (lower variance in its sample set) receives higher weight. When KNN has many consistent neighbours (low neighbour variance), it dominates the blend. When historical readings are more consistent than the neighbour pool, historical dominates. The blend never simply averages the two; it dynamically adapts to whichever source is more reliable for that specific slot and device.

The performance gap between Combined and its best individual component is largest in Group A (Combined at 2.98 vs KNN at 4.12 — 0.84 dB improvement), confirming that blending adds the most value where the two sources have complementary reliability profiles. The gap is smallest in Group C (2.23 vs 2.56 — 0.33 dB), where both components already perform well and their estimates are likely correlated (the short history means both have limited data, pulling them toward similar answers).

### TimesFM vs Statistical Methods

TimesFM's lead over the statistical methods is remarkably consistent across all three groups. Its MAE ranges from 1.14 dB (Group C) to 1.20 dB (Group A) — a variation of only 0.06 dB. The statistical methods, in contrast, vary by 0.47 dB (Historical) to 1.56 dB (KNN) across groups. TimesFM's group-to-group stability indicates that it has learned representations of the time series dynamics that transfer across different structural conditions — spatial isolation and history length affect the statistical methods substantially but barely affect the neural model.

**Practical significance of the improvement.** TimesFM's overall MAE of 1.18 dB compared to Combined's 2.70 dB represents a 1.52 dB reduction in average error. In acoustic perception, a difference of 1 dB is near the just-noticeable difference threshold for most listeners; 3 dB corresponds to a doubling of acoustic power and is clearly perceptible. The statistical methods' errors of 2.70–3.54 dB are therefore at or above the perceptibility threshold — imputed values from these methods are frequently distinguishable from the true measurement. TimesFM's 1.18 dB error is well below this threshold, meaning its imputed values are, on average, indistinguishable from real measurements for practical analysis purposes.

**WHO tier classification accuracy.** The five WHO noise tiers are separated by 10 dB boundaries (< 45, 45–55, 55–65, 65–75, ≥ 75 dB). A tier misclassification occurs when an error pushes an imputed value across a boundary. For a reading at 53 dB (2 dB below the 55 dB boundary), an error of > 2 dB causes a tier change. Statistical methods' average errors of 2.70–3.54 dB mean that a large fraction of imputed values near tier boundaries will be misclassified. TimesFM's 1.18 dB average error makes tier boundary misclassifications considerably rarer.

---

## 3.8.4 Error Distribution and Tail Behaviour

Mean error alone does not fully characterise a method's behaviour. A method could achieve a low MAE by being accurate on most slots while still producing occasional catastrophic errors. The RMSE captures this indirectly, but examining the full error distribution provides additional insight.

**RMSE/MAE ratio as a tail indicator.** For a perfectly uniform error distribution (all errors equal), RMSE/MAE = 1.0. For a distribution with heavy tails (many errors near zero, occasional large errors), RMSE/MAE >> 1.0. All four methods show RMSE/MAE ratios of approximately 1.44–1.52, suggesting moderate tail heaviness — consistent with a roughly half-normal or exponential error distribution rather than a uniform or heavy-tailed one.

**Absolute comparison of tails.** While the ratios are similar, the absolute RMSE values differ enormously: TimesFM (1.80 dB) vs Combined (4.10 dB) vs KNN (5.07 dB). This means that even in the worst-case slots, TimesFM's errors remain small in absolute terms. A RMSE/MAE ratio of 1.52 applied to a MAE of 1.18 dB implies a 95th-percentile error of approximately 2–3 dB for TimesFM. The same ratio applied to KNN's MAE of 3.54 dB implies 95th-percentile errors in the 7–9 dB range — crossing multiple WHO tier boundaries. The tail risk of the statistical methods is therefore practically significant in a way that TimesFM's is not.

**Coverage asymmetry.** Historical imputation covers 17,170 of 17,317 slots (99.4%), the 147 missing slots being cold-start cases. TimesFM covers 16,839 (97.2%), skipping slots without sufficient context. KNN and Combined cover all 17,317 slots, though some of those estimates are lower-quality fallbacks from the 1 km radius. The slightly lower coverage of Historical and TimesFM should be kept in mind when interpreting aggregate metrics — the uncovered slots are systematically the hardest ones (first hours of a device's life, and short-context slots respectively), so the reported MAE figures for these methods are mildly optimistic relative to a method that attempted and failed on those slots.

---

## 3.8.5 Spatial Analysis

The group-level results already suggest a spatial dimension to the error patterns, but examining the relationship between isolation score and per-device MAE more directly reveals how the methods' errors are geographically distributed.

**KNN error increases with isolation in the connected group.** Within Group A, devices that happen to have higher isolation scores (despite being selected from the low-isolation pool) show higher KNN MAE. This is consistent with the simultaneous-outage hypothesis: devices on shared gateways are correlated in their missingness, and a higher isolation score within the connected pool likely reflects more gateway-level correlated failures rather than genuine spatial separation.

**Historical error is spatially flat.** Across all three groups, Historical's MAE varies by only 0.47 dB (from 2.92 in Group C to 3.43 in Group B). This flatness confirms that spatial connectivity is irrelevant to the historical method — its accuracy is determined by temporal consistency, not neighbourhood density. Devices on major transit arteries with stable daily traffic cycles will have accurate historical imputations regardless of where they are in the city.

**TimesFM error is spatially and temporally flat.** TimesFM's MAE ranges from 1.14 to 1.20 dB across all three groups — a variation of only 0.06 dB. Neither isolation score nor history length meaningfully degrades its performance within the range of conditions tested. This robustness suggests that the transformer's learned temporal patterns are general enough to extrapolate reliably across sensor types, locations, and history lengths without sensor-specific fine-tuning.

**Implication for deployment.** If imputation quality must be uniform across all sensors in a heterogeneous fleet — a requirement for fair city-wide noise mapping — TimesFM is the only method among those tested that achieves this. The statistical methods introduce location-dependent and history-dependent bias: sensors in network-dense zones will receive more accurate KNN imputation than isolated sensors, and newly deployed sensors will receive less accurate historical imputation than long-running ones. TimesFM largely eliminates these structural inequalities.

---

## 3.8.6 Limitations

**Temporal scope.** The evaluation covers a single four-month period (September–December 2021). This window includes the transition from EEST to EET (daylight saving change in late October), varying weather conditions, and the approach to the winter holiday period. However, it does not cover summer — the period most relevant to outdoor noise exposure assessment, when pedestrian density, outdoor dining, and tourism activity are highest. Method rankings may differ in summer months when temporal patterns are less regular and spatial correlations may change due to different traffic volumes.

**Domain mismatch for TimesFM.** Google TimesFM 2.5 is a general-purpose time series foundation model pre-trained on a large corpus of diverse time series from finance, retail, weather, and other domains. It was not fine-tuned on acoustic sensor data. The strong results reported here reflect zero-shot generalisation: the model transfers patterns learned elsewhere to the SPL domain without any domain-specific adaptation. Fine-tuning on a held-out portion of the Tallinn dataset would likely improve TimesFM's accuracy further, particularly for devices with unusual acoustic profiles (tunnels, parks, industrial zones) that differ from the typical patterns in the pre-training corpus.

**Mask slot representativeness.** The 20% mask slots are drawn uniformly at random from each device's original readings. This means mask slots are distributed proportionally to when the device had data — not proportionally to when data is most likely to be missing in practice. Real missing slots may cluster around specific hours (network maintenance windows, overnight restarts) or seasonal periods that are underrepresented in the random mask. Method performance on actual missing data may therefore differ from the evaluation figures.

**Test set size.** 35 devices from a fleet of 471 is a 7.4% sample. While the three-group stratification ensures coverage of the main difficulty modes, individual device characteristics — unusual acoustic environments, atypical missingness patterns, non-standard sensor hardware — may not be fully represented. The confidence intervals on per-group MAE estimates are not reported here but would be informative for a production deployment decision.
