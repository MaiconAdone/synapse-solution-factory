# ML Systems

This directory defines contracts for ML project delivery.

## Required Artifacts

- `data_contract.yaml`
- `model_card_template.md`
- `monitoring_plan.yaml`

## Runtime Layer

The backend exposes a local baseline model layer under `/models`.

- `POST /models/train` trains versioned local baselines:
  - `linear_regression` and `ridge_regression` for regression.
  - `logistic_regression` for binary classification.
  - `moving_average_forecast` and `seasonal_naive_forecast` for time series.
  - `neural_network_regression` and `neural_network_classifier` as small
    NumPy MLP baselines for local deep-learning-style experimentation.
- `GET /models` lists registered local models.
- `POST /models/{model_id}/predict` runs inference against a saved artifact.

Artifacts are saved under `artifacts/models/` and tracked in
`artifacts/models/registry.json`.
