# ML Systems Playbook

## System Design

- Map the learning problem as experience/data, task, and performance measure.
- Define the hypothesis family, assumptions, and bias/variance expectation.
- State the loss, estimator, optimization method, and regularization plan.
- Define prediction target, label source, training data window, and serving path.
- Separate data validation, feature generation, training, evaluation, and serving.
- Track dataset version, model version, code version, and evaluation report.
- Monitor data drift, prediction drift, business metric drift, and failure rate.

## Release Checklist

- Data contract exists.
- Baseline model exists.
- Evaluation split is documented.
- Hypothesis, assumptions, feature transformations, and leakage checks are documented.
- Statistical validation or confidence around the baseline delta is documented.
- Model card is complete.
- Monitoring plan exists.
- Retraining trigger is defined.
