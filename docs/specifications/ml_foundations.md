# ML Foundations Policy

Synapse ML and hybrid projects use the local PDF provided by the user,
*Foundations of Machine Learning - Lecture Notes*, as a conceptual reference.
No book text is copied into Synapse. The reference is translated into
operational design gates that assistants must apply before model selection,
training, evaluation, or release.

## Required Gates

Every ML or hybrid solution must document:

- Learning problem mapping: experience/data, prediction task, and performance measure.
- Hypothesis space and bias: model family, assumptions, and expected bias/variance tradeoff.
- Probabilistic assumptions: probability outputs, calibration needs, independence assumptions, and distribution checks.
- Estimation objective: loss function, estimator, and optimization method.
- Statistical validation: split strategy, baseline delta, confidence or significance checks.
- Regularization and optimization: regularization, convergence criteria, and expected failure modes.
- Attribute selection and transformation: feature policy, leakage checks, and transformations.

## Analyzer Contract

`BusinessSolutionAnalyzer` must expose an `ml_foundations` section for ML and
hybrid analyses. Generated `config/business_solution_analysis.json` and
`docs/briefings/business_solution_analysis.md` must include the active gates and
algorithm guidance.

## Algorithm Guidance

The policy does not force a single algorithm. It asks the assistant to compare
the business problem against foundational candidates such as decision trees,
naive Bayes, logistic regression, k-nearest neighbors, kernel methods,
regularized regression, perceptron, SVM, and calibrated classifiers.

Existing Synapse baselines remain valid. Missing candidates are recorded as
future implementation options when they would improve the selected archetype.

## Release Rule

An ML release is incomplete until the model card, data contract, eval cases,
monitoring plan, local registry evidence, and the foundations gates agree with the
business metric and risk level.
