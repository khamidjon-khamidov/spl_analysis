# Combining Historical Median and KNN Imputation

## Inverse-Variance Weighting — Deep Dive

### Core Idea

When you have two independent estimates of the same unknown value, the optimal way to combine them is to trust the one that is **more certain** (less spread out) more heavily. Certainty is measured as `1 / variance`.

---

### Step by Step for a Missing Slot

Say device **D** is missing a reading at **Tuesday 14:00**.

**Step 1 — Historical estimate**

Pull the last 10 available readings for device D at hour 14 from previous days:
```
[62, 65, 61, 63, 64, 60, 63, 62, 65, 61]

hist_est = median = 62.5
hist_var = variance = 2.7   → low variance, stable device
```

**Step 2 — KNN estimate**

Pull readings from neighbours within 500m at Tuesday 14:00:
```
[58, 71, 63, 55, 69]

knn_est = median = 63.0
knn_var = variance = 36.7  → high variance, neighbours disagree
```

**Step 3 — Compute precision weights**
```
w_hist = 1 / hist_var = 1 / 2.7  = 0.370
w_knn  = 1 / knn_var  = 1 / 36.7 = 0.027

total  = 0.370 + 0.027 = 0.397
```

**Step 4 — Weighted blend**
```
value = (0.370 × 62.5 + 0.027 × 63.0) / 0.397
      = (23.1 + 1.7) / 0.397
      = 62.6
```

The result is pulled almost entirely from the historical estimate because it was far more consistent. KNN barely contributed because the neighbours were noisy.

---

### Why This is Optimal

If both estimators are:
- **Unbiased** (their expected value equals the true value)
- **Independent** (historical pattern and neighbour values don't share error sources)

Then inverse-variance weighting produces the **minimum possible mean squared error** among all linear combinations. No other fixed weighting scheme can do better on average. This is a proven result from estimation theory (Gauss-Markov theorem).

---

### Edge Cases Handled Automatically

| Situation | What happens |
|---|---|
| Only historical data available | `w_knn = 0` → pure historical |
| Only KNN data available | `w_hist = 0` → pure KNN |
| Historical variance = 0 (perfectly stable device) | `w_hist → ∞` → historical dominates completely |
| Both agree exactly | Weights don't matter, result is the same value |
| Both disagree wildly | The lower-variance one wins |

---

### One Nuance: Variance from Small Samples

With only a few samples (e.g. 3 neighbours), the **sample variance is unstable** — it can be 0 if they all happen to match, giving infinite weight. Two practical fixes:

1. **Add a small floor**: `var = max(sample_var, ε)` where ε ≈ 1.0 dB²
2. **Use Bessel's correction**: divide by `n-1` not `n` when computing variance

Both prevent a single lucky coincidence from dominating the estimate.

---

### Intuition as a Diagram

```
hist readings:  [62, 65, 61, 63, 64]   tight cluster  → high weight
                      ↓
                  ████████████░░  (wide bar = high weight)

knn readings:   [55, 63, 71, 58, 70]   spread out     → low weight
                      ↓
                  ███░░░░░░░░░░░  (narrow bar = low weight)

combined:       ────────────●──────────  (closer to historical)
                           62.6
```
