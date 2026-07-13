# Operations

## Bootstrap

```powershell
.\scripts\bootstrap_enterprise_stack.ps1 -SkipRuflo
```

Use `-InstallPythonDeps` and `-InstallFrontendDeps` when dependency installation
is desired.

## Validate

```powershell
.\scripts\validate_enterprise_stack.ps1
```

The validation checks required files, backend syntax, runtime manifest contracts,
and frontend package metadata.

## Runtime Manifest

`config/runtime_manifest.json` is the machine-readable contract used by the
backend and validation scripts. Keep it aligned with `config/enterprise.yaml`
and `agents/definitions/enterprise_agents.yaml`.
