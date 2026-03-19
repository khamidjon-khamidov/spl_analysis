# Sound Pressure Level — Data Imputation & Visual Analysis

A research project for imputation and animated visualization of Sound Pressure Level (SPL) data in Tallinn, based on IoT sensor data.

**Author:** Khamidjon Khamidov
**Supervisor:** Jaanus Kaugerand

## Overview

Tallinn's IoT sensor network monitors urban noise across major transit arteries. Low-cost sensors are prone to data gaps caused by network failures, power outages, and environmental interference. This project addresses that by:

1. **Imputing missing SPL data** using a hybrid pipeline — Self-Imputation (historical patterns), Weighted KNN (spatial neighbors), and Google TimesFM (foundation model for complex gaps)
2. **Visualizing the results** as an animated noise map that reveals temporal trends, detects faulty sensors, and highlights areas needing more coverage

## Tech Stack

- **Frontend**: React — interactive animated dashboard
- **Backend**: Python — data serving and API
- **Imputation**: Python scripts — multi-model imputation pipeline

## Project Structure

```
sound_pressure_level/
├── frontend/          # React dashboard
├── backend/           # Python API
├── imputation/        # Imputation scripts (Self, KNN, TimesFM)
└── data/
    ├── raw/           # Raw IoT sensor files (Excel)
    └── sql/           # Processed SQL output
```

## Imputation Methods

| Method | Type | Use Case |
|---|---|---|
| Self-Imputation | Temporal | Fills gaps using the sensor's own historical patterns |
| Weighted KNN | Spatial | Estimates values from geographically adjacent sensors |
| Google TimesFM | Foundation Model | Handles long-duration or complex gaps |

Accuracy is validated via **Synthetic Gap Analysis** using RMSE and MAE metrics.
