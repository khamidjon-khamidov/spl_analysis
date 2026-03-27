# Conclusion & Future Work

## 5. Conclusion

### 5.1 Summary of Key Findings

This study developed and evaluated a complete pipeline for imputing missing data in Tallinn's urban acoustic sensor network and delivering the results through an interactive visualisation dashboard. The following key findings emerged from the work.

#### Data Reliability of the Sensor Network

The raw dataset spanning September–December 2021 reveals a significant reliability problem in the IoT acoustic infrastructure. Across 471 deployed sensors, approximately **26% of all device-hours** are missing from the original record. The distribution of missingness is highly uneven: a subset of sensors are nearly complete (< 5% missing), while a substantial minority have gaps exceeding 50% of their active lifespan. This non-uniform pattern is consistent with **hardware failure and connectivity issues** as the dominant cause of data loss, rather than a systemic network-wide problem — a finding that has direct implications for maintenance prioritisation.

The cold-start effect — where sensors newly deployed within the study period have no historical record to draw from — accounts for a significant portion of early gaps and is an inherent limitation of any temporally-based imputation strategy.

#### Imputation Effectiveness

The four-method imputation framework demonstrates that the large majority of missing data is recoverable:

- **Historical Median** recovers 91.9% of all possible device-hours using only each sensor's own prior readings. Its simplicity and speed make it a strong baseline, but it is blind to current spatial conditions and fails for new sensors.
- **Spatial KNN** recovers 98.8% by drawing on neighbouring sensors at the same timestamp. It complements the historical method precisely where the historical method fails: sensors with sparse own-history but active neighbours. The 500m / 1km dual-radius strategy proved effective in balancing spatial precision with coverage for isolated sensors.
- **Historical + KNN Combined** achieves 99.9% fill rate through inverse-variance weighting. By automatically up-weighting whichever source is more internally consistent at each slot, the combined method eliminates almost all remaining gaps without requiring manual parameter tuning.
- **TimesFM Neural Re-imputation** maintains 99.9% coverage while improving the temporal quality of imputed values for sensors with sufficient history. The 512-step context window (21 days of hourly data) allows the model to condition on realistic daily and weekly periodicity. On this dataset, 310,684 statistically-imputed slots were replaced with temporally coherent neural estimates, accounting for 26% of all rows in the final table.

The progression from statistical to neural methods confirms that statistical methods are highly competitive for coverage, while neural models offer advantages in temporal coherence for densely recorded sensors — at a substantially higher computational cost (~13 hours CPU time for a single dataset pass).

#### Visualisation Effectiveness

The interactive dashboard demonstrates that imputation method switching in real time, at the city-wide map level, is an effective tool for communicating data quality to non-technical users. The colour-coded missingness tiers (green / amber / red), combined with per-device popup coverage breakdowns across all four methods, provide immediate situational awareness about network health. The animated daily analysis page makes temporal patterns — morning rush hours, quiet weekend nights, specific high-noise corridors — directly perceptible without requiring users to interpret tabular data or write queries. The WHO noise health tier colouring grounds the visualisation in a recognised regulatory standard, making results directly interpretable by health and planning professionals.

---

### 5.2 Recommendations for the Tallinn Transport Department and City Planning

The tool and findings developed in this thesis have direct practical applications for city administration.

**Targeted sensor maintenance.** The per-device missing data statistics computed by the pipeline provide a ranked list of the most unreliable sensors in the network. The Transport Department can use the Devices page of the dashboard to immediately identify sensors with red missingness indicators (> 50% missing) and prioritise field inspection and repair. Because the data is disaggregated by imputation method, planners can distinguish between sensors that are simply isolated (high KNN fill rate but high original missingness) and sensors that are structurally problematic even after imputation.

**Noise corridor identification for urban planning.** The SPL Static and SPL Daily Analysis pages provide a city-wide snapshot of noise exposure at any chosen hour. City Planning can use these views to identify chronic high-noise corridors (consistently orange or red markers across multiple hours of the day) and correlate them with road categories, tram lines, and land use. This supports evidence-based decisions on traffic rerouting, speed limit changes, green buffer zones, and building permit conditions in sensitive areas.

**Regulatory compliance monitoring.** By colouring sensor readings against the WHO noise health tiers, the dashboard makes it straightforward to identify locations persistently exceeding the 65 dB (moderate concern) or 75 dB (dangerous) thresholds. This supports reporting obligations under the EU Environmental Noise Directive and the preparation of strategic noise maps required under Directive 2002/49/EC.

**Evaluating the impact of interventions.** Because the full time series for each sensor is stored and queryable, the tool can be used to measure before/after noise levels when transport interventions are made — for example, after a new tram route opens, a road is closed for reconstruction, or a 30 km/h zone is introduced. The per-device SPL Chart page makes this comparison directly accessible.

**Data-driven network expansion.** Spatial KNN fill rates reveal which areas of the city have poor neighbour coverage — sensors whose KNN fill rate is significantly lower than the network average are in spatially isolated positions. This information can guide the placement of new sensors to maximise redundancy and network-wide imputation quality.

---

### 5.3 Future Work

Several directions would substantially extend the value and scientific rigour of this work.

#### Integration of Real-Time Traffic Flow Data

The current imputation pipeline treats missing acoustic values as a function of the sensor's own history and its spatial neighbours, with no knowledge of the underlying causal factors. Incorporating real-time or historical **traffic flow counts** (available from the Tallinn traffic management system) as covariates would enable more accurate imputation for sensors on major arterials, where noise is strongly correlated with vehicle volume and speed. A regression-based or attention-based model conditioned on traffic flow could recover not just a plausible noise level but one that is mechanistically consistent with observed road conditions at that timestamp.

#### Integration of Weather and Environmental Conditions

Acoustic propagation is significantly affected by wind speed, wind direction, precipitation, and temperature inversion. A rainy hour at 14:00 and a dry hour at 14:00 may differ by several dB even with identical traffic. Incorporating **weather station data** (ERA5 reanalysis or local meteorological measurements) as model features would reduce systematic bias in imputed values during adverse weather events and improve the credibility of comparisons across seasons.

#### Held-Out Evaluation of Imputation Quality

The current pipeline has no ground-truth evaluation for imputed slots, because the missing values are genuinely unknown. A rigorous evaluation could be constructed by **artificially masking** a random subset of observed values (known-good readings) before imputation, then comparing the imputed estimates against the true values. This would produce quantitative accuracy metrics (MAE, RMSE, coverage probability) for each method and allow statistically grounded comparison between historical median, KNN, combined, and TimesFM approaches.

#### GPU-Accelerated and Online TimesFM Inference

The TimesFM re-imputation step required approximately 13 hours on CPU for the four-month dataset. Deploying the model on a GPU (CUDA or Apple Metal Performance Shaders) would reduce this to under one hour, making it practical to re-run imputation when new sensor data arrives. Combined with an incremental ingestion pipeline that appends only new data rather than rebuilding the entire database, this would enable near-real-time imputation for a live production deployment.

#### Probabilistic Imputation and Uncertainty Quantification

All methods currently produce point estimates. A natural extension is to output **prediction intervals** alongside imputed values. TimesFM already produces quantile forecasts internally (it is trained with quantile loss); these quantile outputs could be stored and surfaced in the dashboard as shaded confidence bands on the SPL Chart page, giving users visibility into how certain each imputed reading is. This would be particularly valuable for regulatory compliance reporting, where it matters whether a sensor is confidently above or only marginally above a noise threshold.

#### Automated Anomaly Detection

The pipeline currently flags data gaps but does not distinguish between a sensor that is offline and a sensor that is online but reporting implausible values (e.g., 120 dB readings caused by sensor malfunction, or 0 dB readings from a stuck sensor). Integrating a simple anomaly detection layer — based on z-scores within a rolling window or an isolation forest — would improve the quality of the original data before imputation and prevent corrupted readings from contaminating the historical and KNN lookups.

#### Extension to Other Cities

The pipeline is not Tallinn-specific. The only city-specific inputs are the sensor CSV export and the `Europe/Tallinn` timezone. Packaging the pipeline as a configurable tool with a single configuration file (CSV path, timezone, coordinate reference system) would allow it to be deployed for other municipal IoT acoustic networks with minimal adaptation — contributing to broader urban noise monitoring capacity across the Baltic region and beyond.
