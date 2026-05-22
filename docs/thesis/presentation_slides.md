# Presentation Slides — Master's Thesis Defence
**Data Imputation and Animated Visualization of Sound Pressure Level in Tallinn Based on IoT Sensor Data**
Khamidjon Khamidov · Tallinn University of Technology · 2026
Supervisor: Jaanus Kaugerand

---

## Slide 1 — Title

**Data Imputation and Animated Visualization of Sound Pressure Level in Tallinn Based on IoT Sensor Data**

Khamidjon Khamidov
Master's Thesis · Software Engineering
Supervisor: Jaanus Kaugerand, Senior Researcher
Tallinn University of Technology · 2026

---

## Slide 2 — Outline

1. Background & Motivation
2. Problem Statement & Research Questions
3. Dataset
4. Imputation Methods
5. Evaluation Setup
6. Results
7. Visual Dashboard
8. Answers to Research Questions
9. Limitations & Future Work
10. Conclusion

---

## Slide 3 — Background: The Problem with Urban Noise in Tallinn

- Tallinn faces a serious urban noise challenge
- ~**40% of residents** exposed to traffic noise exceeding safety thresholds
- SPL peaks of **75 dB** along Liivalaia and Pärnu mnt — well above the 55 dB night-time residential limit
- Noise levels have led to **denial of building permits** in central districts
- City planning still relies on **static simulations from 2019**

> Urban noise is no longer just an annoyance — it is an environmental health concern with real policy consequences.

---

## Slide 4 — Background: The IoT Shift and Its Problem

**The opportunity:**
- Tallinn deployed **471 low-cost IoT sensors** with MEMS microphones across the city
- High-resolution, continuous, hourly SPL monitoring — "Test in Tallinn" initiative

**The problem:**
- Low-cost sensors are prone to data loss: network packet loss (LoRaWAN/WiFi), power failures, hardware issues
- Fleet-wide **missing data rate: ~26%** — roughly 1 in 4 expected hourly readings is absent
- Missing data is not uniform: some sensors have <1% missing, others >80%
- Raw fragmented data cannot be reliably used for noise exposure analysis or policy

---

## Slide 5 — Problem Statement & Research Questions

**Goal:** Develop and validate a hybrid imputation pipeline and interactive visualization dashboard that transforms fragmented IoT SPL data into a continuous, interpretable acoustic profile for Tallinn.

**Research Questions:**

- **RQ1:** To what extent does a hybrid approach (Self-Imputation, KNN, TimesFM) reduce error in reconstructed SPL datasets compared to using only KNN or self-imputation?

- **RQ2:** How does the hybrid statistical approach (KNN + Historical Median) compare to Google TimesFM in terms of accuracy and computational efficiency?

- **RQ3:** How can an interactive visual dashboard support the analysis of urban SPL data, including identification of faulty sensors, spatial noise patterns, and data quality?

---

## Slide 6 — Dataset

| Property | Value |
|---|---|
| Source | Tallinn IoT acoustic monitoring platform |
| Period | September – December 2021 (4 months) |
| Sensors | 471 devices with MEMS microphones |
| Raw readings | ~3 million individual measurements |
| Granularity | Aggregated to **hourly medians** per device |
| Missing rate | **~26% fleet-wide** |

**Pre-processing pipeline (3 Python scripts):**
1. `csv_to_sql.py` — builds device registry, deduplicates sensors
2. `csv_to_sp_levels.py` — converts readings to hourly medians in Tallinn local time
3. `compute_missing_hours.py` — calculates per-device coverage statistics

All transformations are reproducible from the original raw CSV.

---

## Slide 7 — Four Imputation Methods

| Method | Approach | Fill Rate |
|---|---|---|
| **Historical Median** | Median of last 10 same-hour readings from prior days | 91.9% |
| **Spatial KNN** | Median of ≤500 m neighbours at same timestamp (fallback 1 km) | 98.8% |
| **Combined** | Inverse-variance weighted blend of Historical + KNN | 99.9% |
| **TimesFM 2.5** | Google's 200M-param transformer, zero-shot, re-imputes statistical slots with ≥72h context | 99.9% |

Each method produces an **independent, complete imputation table** — not layered.

**Key idea of Combined method:**
- Weight each source by `w = 1 / max(Var(samples), 1.0)`
- Source with lower variance (more consistent readings) gets higher weight
- Final: `ŷ = round( (w_hist · ŷ_hist + w_knn · ŷ_knn) / (w_hist + w_knn) )`

---

## Slide 8 — Evaluation Setup

**Strategy:** Synthetic gap testing (stratified masking)

- **20%** of each test device's observed readings randomly removed as ground truth
- 35 test devices, **17,317 masked observations** total
- Three evaluation groups designed to expose different failure modes:

| Group | Description | Devices | Mask slots |
|---|---|---|---|
| **A — Connected** | Dense neighbours, long history | 15 | 8,563 |
| **B — Isolated** | Few spatial neighbours | 10 | 5,708 |
| **C — Short History** | Recently deployed, limited past data | 10 | 3,046 |

**Metrics:** MAE (Mean Absolute Error) and RMSE (Root Mean Square Error) in dB

Fully reproducible: random seed fixed at 42, temporal alignment enforced, mask slots naturally excluded from imputation inputs.

---

## Slide 9 — Results: Overall

| Method | N slots | MAE (dB) | RMSE (dB) |
|---|---|---|---|
| Historical Median | 17,170 | 3.32 | 4.79 |
| Spatial KNN | 17,317 | 3.54 | 5.07 |
| Combined (Hist + KNN) | 17,317 | 2.70 | 4.10 |
| **TimesFM** | **16,839** | **1.18** | **1.80** |

**Key takeaways:**
- TimesFM achieves **2.3× lower MAE** than Combined, **2.8× lower** than Historical
- Combined consistently outperforms both its components — adaptive weighting adds value
- KNN slightly underperforms Historical overall — but this reverses by group

---

## Slide 10 — Results: By Evaluation Group

| Group | Method | MAE (dB) |
|---|---|---|
| **A — Connected** | Historical | 3.39 |
| | KNN | **4.12** ← worse than Historical |
| | Combined | 2.98 |
| | TimesFM | **1.20** |
| **B — Isolated** | Historical | 3.43 |
| | KNN | **3.20** ← better than Historical |
| | Combined | 2.53 |
| | TimesFM | **1.18** |
| **C — Short History** | Historical | 2.92 |
| | KNN | 2.56 |
| | Combined | 2.23 |
| | TimesFM | **1.14** |

**TimesFM MAE range: 1.14–1.20 dB across all groups (only 0.06 dB variation)**
Statistical methods vary by up to 1.56 dB across groups.

---

## Slide 11 — Key Finding: Why KNN Underperforms in Connected Group

**Counterintuitive result:** KNN performs *worse* in Group A (Connected) than Group B (Isolated)
- MAE: 4.12 dB (Group A) vs 3.20 dB (Group B)

**Explanation — Correlated Missingness:**
- In dense urban areas, sensors share infrastructure (common gateways, network segments)
- When one device loses data, **nearby devices often fail simultaneously**
- KNN's neighbours become unavailable at exactly the moments when data is missing
- The very sensors KNN depends on are absent during critical gaps

**Historical method is immune** — it draws on past observations from a different time period, unaffected by concurrent outages.

> Spatial redundancy only helps when failures are **independent**. In real IoT networks, they often are not.

---

## Slide 12 — Key Finding: Why TimesFM Dominates

- Statistical methods assume sound levels follow **consistent hourly patterns** across days
- These assumptions **break down** during atypical events (public gatherings, road disruptions, extreme weather) — precisely when sensors are most likely to be missing
- TimesFM is a decoder-only transformer pre-trained on large, diverse real-world time series
- It learns **temporal dynamics** (trends, seasonality, abrupt changes) without domain-specific assumptions
- Applied in **zero-shot mode** — no fine-tuning on Tallinn data

**Result:** Reduces average error from above the ~3 dB perceptual threshold to below the ~1 dB just-noticeable difference.

- TimesFM MAE: **1.18 dB** → sub-perceptual error level
- Statistical methods: 2.70–3.54 dB → misclassification risk across WHO noise tiers

**Computational cost:** 13 hours CPU (one-time), vs minutes for statistical methods

---

## Slide 13 — Visual Dashboard: Overview

Interactive web-based dashboard built with **React + FastAPI + SQLite**

**7 pages:**
| Page | Purpose |
|---|---|
| Devices | Map of all 471 sensors colour-coded by missing data rate |
| SPL Static | Snapshot of SPL at any selected hour |
| SPL Daily Analysis | Per-device time series with imputation flag |
| SPL Chart | Line chart for any device over selected period |
| SPL Heatmap | Animated hourly SPL heatmap playback |
| Analysis | Fleet-wide hourly/DOW profiles, distribution, device ranking |
| Compare | Side-by-side MAE/RMSE comparison across imputation methods |

**Global control:** Imputation method selector (Original / Historical / KNN / Combined / TimesFM) — instantly switches all pages to the selected dataset.

---

## Slide 14 — Dashboard: Sensor Health Detection

**Devices page — fleet-wide completeness at a glance**

Colour coding by missing data rate:
- **Green** → < 20% missing (249 sensors)
- **Orange** → 20–50% missing (101 sensors)
- **Red** → > 50% missing (121 sensors)

A network operator can immediately identify:
- Persistently disconnected sensors
- Sensors deployed for only part of the study period
- Hardware failures rendering devices largely inactive

> No need to inspect individual records — the geographic distribution of unreliable nodes is visible at once.

---

## Slide 15 — Dashboard: Spatial Noise Patterns

**Findings from animated heatmap and device ranking map:**

**Loudest locations:**
- Pallasti — high-traffic corridor
- Kalaranna — waterfront area
- Linnamäe tee — major arterial road

**Quietest locations:**
- Üliõpilaste tee — residential and academic surroundings

**Geographic structure:**
- Clear **east–west asymmetry**: western Tallinn is generally quieter than eastern parts
- Eastern areas more exposed to transit corridors and industrial activity
- Top 15 loudest and 15 quietest devices cluster in **spatially distinct zones**

> Noise inequality in Tallinn has a clear geographic structure — not randomly distributed across the network.

---

## Slide 16 — Dashboard: Temporal Noise Profiles

**Weekday vs Weekend (hourly average SPL):**

- **Weekdays:** SPL peaks broadly between **08:00 and 18:00** — sustained across the full working day
  - Driven by morning commute, commercial activity, afternoon peak hour
- **Weekends:** Daytime peak narrows to around **14:00** — reflecting later waking and reduced commute
- **Weekends 00:00–04:00:** Slightly elevated SPL — nighttime social activity (Fri/Sat nights)
- Overall weekend SPL is **lower** than weekday — traffic and commerce dominate noise, not residential activity

**Dashboard transparency:**
- Each sensor's imputation source (original / statistical / TimesFM) is visible in the map popup
- Users can judge confidence in any displayed value at the point of use

---

## Slide 17 — Answers to Research Questions

**RQ1:** Does a hybrid approach reduce error compared to individual methods?
→ **Yes.** Combined (MAE 2.70 dB) outperforms Historical (3.32) and KNN (3.54) across all groups. TimesFM (1.18 dB) further demonstrates that layered imputation with a foundation model provides the most accurate reconstruction.

**RQ2:** Hybrid statistical vs TimesFM — accuracy and efficiency?
→ **TimesFM wins on accuracy (2.3× better MAE), hybrid wins on speed (minutes vs 13h CPU).** For historical reconstruction, TimesFM's gain justifies the cost. For real-time monitoring, the hybrid fills gaps immediately with TimesFM applied retrospectively as a nightly batch.

**RQ3:** Can an interactive dashboard support SPL analysis?
→ **Yes — across three dimensions:** (1) Sensor health via colour-coded missing data map, (2) Spatial and temporal noise patterns via animated heatmap and analysis charts, (3) Data quality transparency via per-sensor imputation source visibility.

---

## Slide 18 — Limitations

**Temporal scope:**
- Data covers only September–December 2021
- Summer months (highest outdoor noise) are excluded — method rankings may differ under summer conditions

**Zero-shot TimesFM:**
- MAE of 1.18 dB is a conservative estimate — fine-tuning on Tallinn data would likely reduce error further
- Performance may be lower in acoustically atypical environments (tunnels, parks, industrial zones)

**Mask representativeness:**
- Evaluation uses random masking (20%) — real missing data tends to occur in clusters (multi-hour outages)
- The evaluation may underestimate challenges during anomalous or high-variance periods

---

## Slide 19 — Future Work

1. **Fine-tune TimesFM on Tallinn data** — even a few thousand device-hours should reduce error below the zero-shot baseline

2. **Extend evaluation to summer months** — assess whether method rankings hold under higher-variability acoustic conditions

3. **Evaluate on real missing segments** — replace synthetic masking with genuine gaps validated against reference instruments

4. **Hybrid real-time deployment** — statistical methods for immediate gap-filling; TimesFM as a scheduled nightly batch to retrospectively refine estimates. The pipeline architecture already supports this extension.

---

## Slide 20 — Conclusion

**What was built:**
- A reproducible 4-method imputation pipeline covering all 471 Tallinn sensors (Sep–Dec 2021)
- Stratified evaluation across 35 test devices and 17,317 observations
- Interactive web dashboard (React + FastAPI) for spatial, temporal, and diagnostic analysis

**Key results:**
- TimesFM achieves **MAE 1.18 dB** — sub-perceptual accuracy, consistent across all device types
- Combined hybrid method (MAE 2.70 dB) outperforms both its components through adaptive weighting
- Statistical methods can cause **WHO tier misclassification** — a direct policy risk
- Dashboard reveals clear geographic noise inequality in Tallinn (east–west asymmetry, identified hotspots)

**Broader contribution:**
Foundation models can achieve sub-perceptual accuracy in urban acoustic monitoring without any domain-specific training — extending zero-shot time series modelling to a new application domain.

---

*End of presentation*
