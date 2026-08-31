# Capitulo 8 — Validacao

Para o Synapse:

```powershell
python -m pytest tests/test_backend_contracts.py
python -m pytest tests/test_business_transformation.py
```

Para projeto criado:

```powershell
python -m pytest tests
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\diagnose_project.ps1 -ProjectName nome_do_projeto
```
