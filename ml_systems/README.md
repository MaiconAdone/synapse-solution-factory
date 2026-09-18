# ML Systems

This directory defines contracts for ML project delivery.

## Required Artifacts

- `data_contract.yaml`
- `model_card_template.md`
- `monitoring_plan.yaml`

## Runtime Layer

`scripts/synapse_lib/model_service.py` exposes a local baseline model layer
through the `ModelService` class, used directly from Python or through
`scripts/run_evals.py`.

- `ModelService.train(request)` trains versioned local baselines:
  - `linear_regression` and `ridge_regression` for regression.
  - `logistic_regression` for binary classification.
  - `moving_average_forecast` and `seasonal_naive_forecast` for time series.
  - `neural_network_regression` and `neural_network_classifier` as small
    NumPy MLP baselines for local deep-learning-style experimentation.
- `ModelService.list_models()` lists registered local models.
- `ModelService.predict(model_id, request)` runs inference against a saved
  artifact.

Artifacts are saved under `artifacts/models/` and tracked in
`artifacts/models/registry.json`.
