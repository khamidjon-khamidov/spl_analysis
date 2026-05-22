# Natural Exclusion of Mask Slots

For the evaluation to be valid, none of the four methods must be allowed to see the true value of the slot it is trying to predict. If a method could access the answer it is supposed to estimate, its accuracy score would be artificially inflated and the comparison would be meaningless. One way to prevent this is to explicitly delete each masked slot from the data before calling the method. However, a simpler and more reliable approach is possible here: each method is designed in a way that makes it structurally impossible to access the target slot's own value, without any special removal step.

**Historical Median** builds its estimate from readings that occurred on previous days at the same hour. Only observations with a timestamp strictly earlier than the slot being predicted are considered. Since the target slot's timestamp is never strictly less than itself, the slot is automatically excluded from its own lookback window — regardless of whether it is physically present in the data or not.

**Spatial KNN** builds its estimate from readings taken by other sensors at the same timestamp. The list of neighbours used for any device is precomputed to contain only other device IDs, never the device itself. Since the target slot belongs to the device being predicted, and that device is never in its own neighbour list, the target value is structurally unreachable by the KNN estimator.

**The Combined method** calls the Historical and KNN estimators internally and blends their outputs. Because both components already exclude the target slot by their own design, the combined method inherits this property automatically without needing any additional logic.

**TimesFM** builds its forecast from a window of recent values for the same device, but only values with a timestamp strictly earlier than the slot being predicted are included in that window. Since each hourly slot has a unique timestamp, this strict condition precisely excludes the target slot and nothing else.

The practical benefit of this approach is reliability. An explicit masking step — manually removing a slot before prediction — can be accidentally bypassed by a bug that forgets to apply the filter in some code path. Structural exclusion cannot be bypassed in this way: the logic that excludes the target slot is the same logic that defines how the method works, so it applies automatically every time.

| Method | How the target slot is excluded |
|---|---|
| Historical | Only reads timestamps strictly before the target — never the target itself |
| KNN | Only reads from other devices — never the device being predicted |
| Combined | Inherits exclusion from both Historical and KNN |
| TimesFM | Only reads timestamps strictly before the target — never the target itself |
