# Operations

## Bootstrap

```powershell
.\scripts\bootstrap_enterprise_stack.ps1
```

Use `-InstallPythonDeps` when dependency installation is desired.

## Validate

```powershell
.\scripts\validate_enterprise_stack.ps1
```

The validation checks required files, Python syntax, and runtime manifest
contracts.

## Runtime Manifest

`config/runtime_manifest.json` is the machine-readable contract used by the
project factory and validation scripts. Keep it aligned with
`config/enterprise.yaml` and `agents/definitions/enterprise_agents.yaml`.
