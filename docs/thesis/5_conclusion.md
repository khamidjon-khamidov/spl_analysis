# 5. Conclusion

## 5.1 Summary of Contributions

This thesis addressed the problem of fragmented and incomplete IoT sensor data in Tallinn's urban acoustic monitoring network. The central argument was that raw SPL data, with its fleet-wide missing rate of approximately 26%, cannot support reliable noise exposure analysis without systematic reconstruction — and that the choice of reconstruction method has quantifiable consequences for the accuracy of the resulting dataset.

To address this, a reproducible four-method imputation pipeline was designed, implemented, and evaluated: a historical median baseline exploiting temporal periodicity, a spatial KNN method exploiting geographic correlation, an inverse-variance weighted combination of the two, and Google TimesFM 2.5, a pre-trained time series foundation model applied in zero-shot mode. Each method produces an independent, fully materialised imputation table covering all 471 devices across the September–December 2021 study period. The pipeline is deterministic, seeded, and re-executable from the raw CSV source without modification.

The evaluation was conducted using a stratified masking framework across 35 test devices and 17,317 held-out ground-truth slots, designed to expose the specific failure modes of each method rather than measure performance only under favourable conditions. The results were made accessible through an interactive React-based dashboard providing seven analytical views — spatial snapshots, temporal animation, time series inspection, heatmap visualisation, fleet analysis, and method comparison — connected to all four imputation tables through a global data source selector.

---

## 5.2 Answers to Research Questions

**RQ1: To what extent does a hybrid approach reduce error in reconstructed SPL datasets compared to using KNN or self-imputation alone?**

The hybrid Combined method achieves an overall MAE of 2.70 dB, outperforming both the Historical median (3.32 dB) and Spatial KNN (3.54 dB) across all three evaluation groups without exception. The improvement is consistent and structural: inverse-variance weighting allocates confidence to whichever source is more reliable for each individual slot, delivering gains that no fixed-weight blend could replicate. TimesFM extends this further, achieving 1.18 dB MAE — a 2.3× improvement over Combined and a 2.8× improvement over Historical — through zero-shot generalisation from a pre-trained transformer. Together, the results confirm that a layered hybrid approach, culminating in a foundation model, substantially and reliably reduces reconstruction error compared to any single statistical method.

**RQ2: How can animated visual analysis be used to detect systemic failures such as broken sensors or biased data that are invisible in static reports?**

The SPL Daily and SPL Heatmap pages demonstrate that temporal animation makes failure patterns visible that aggregate statistics conceal. A sensor reporting a constant value across hours appears unremarkable in a daily average table but immediately stands out as a frozen marker in an animated sequence where all neighbouring sensors fluctuate with the morning and evening traffic cycle. Similarly, a spatial blind spot — a district where all sensors go dark simultaneously during a network outage — is indistinguishable from a genuinely quiet period in a static heatmap, but is clearly identifiable in animation as a coordinated disappearance across a geographic zone. The Devices page completeness map provides a complementary static diagnostic, colouring each sensor by its fill rate and flagging devices whose imputation coverage drops significantly relative to their neighbours.

**RQ3: In what ways does visualising imputation uncertainty allow urban planners to identify geographical blind spots for future sensor deployment?**

The imputation provenance flag — distinguishing original measurements (imputed = 0), retained statistical estimates (imputed = 1), and TimesFM replacements (imputed = 2) — is surfaced in the SPL Static map popup for each sensor at any selected timestamp. Areas where a high proportion of displayed values carry imputed = 1 or 2 across most timestamps indicate zones where the monitoring network cannot self-sustain: the sensors present are too few, too isolated, or too recently deployed to provide reliable statistical imputation. These zones are direct candidates for additional sensor deployment. The Devices page, filtered to show high-isolation or low-completeness sensors, provides a ranked list of the specific locations where network reinforcement would yield the largest improvement in data quality.

---

## 5.3 Future Work

**Fine-tuning TimesFM on Tallinn data.** The 1.18 dB MAE reported here is a zero-shot baseline — the model was not exposed to any Tallinn SPL data during training. Fine-tuning on a held-out subset of the dataset would expose TimesFM to the specific distributional properties of MEMS acoustic sensors, Tallinn's traffic network, and the local seasonal patterns, likely reducing error further and improving performance for acoustically atypical sensors such as those in tunnels or parks. Even a small domain-specific fine-tuning set, on the order of a few thousand device-hours, would be sufficient to assess the size of this gain.

**Evaluation on summer months.** The current evaluation covers September–December 2021 only. Summer months — with higher pedestrian densities, outdoor events, and longer daylight hours — represent the period of highest outdoor noise exposure and the period most relevant to noise policy decisions in northern European cities. Replicating the stratified evaluation on a summer dataset would reveal whether the method rankings observed in the autumn window hold under a qualitatively different acoustic regime.

**Real missing slot evaluation.** The synthetic mask procedure samples held-out slots uniformly at random from observed readings, which does not replicate the clustered, correlated structure of actual missing data. A future evaluation using genuinely missing slots — with ground truth obtained from a reference instrument or a second data collection period — would provide a more operationally realistic assessment of each method's performance in the conditions where imputation is actually needed.

**Hybrid real-time deployment architecture.** The current pipeline is designed for offline, one-time imputation of a fixed historical dataset. For a production monitoring system with continuous data ingestion, a natural extension is a two-stage architecture: statistical methods fill new gaps immediately as data arrives, and TimesFM runs as a scheduled nightly batch to retroactively replace statistical estimates with model predictions wherever sufficient context exists. The three-valued imputed flag and separate table structure of the current implementation already support this architecture with minimal modification.

**Multi-city and mixed-hardware generalisation.** All sensors in the Tallinn fleet use the same MEMS microphone hardware. Extending the pipeline to a deployment combining multiple sensor types, or applying it to a different city with a different network topology and acoustic environment, would test the generalisability of both the imputation framework and the evaluation methodology. TimesFM's zero-shot capability makes it a natural candidate for cross-city transfer, but the degree to which the Combined method's weighting parameters require recalibration for different hardware or urban morphologies is an open question.

---

## 5.4 Closing Remark

Tallinn's "Smart City" ambitions rest on the premise that continuous, reliable environmental data can inform urban planning decisions — from building permit regulation to noise abatement strategy. The acoustic monitoring network provides the sensing infrastructure; this thesis addresses the gap between that infrastructure and a dataset that can actually be trusted. By demonstrating that a foundation model can reconstruct missing SPL readings with sub-perceptual-threshold accuracy across a heterogeneous fleet, and by making those reconstructions explorable through an interactive visual interface, this work moves the Tallinn noise monitoring system one step closer to producing a continuous acoustic profile of the city that is complete enough, accurate enough, and interpretable enough to support evidence-based decisions about where people live, work, and move.
