param(
    [string]$CasesPath = "evals/rag_cases.jsonl"
)

$Root = Split-Path -Parent $PSScriptRoot
Push-Location $Root
try {
    python "$PSScriptRoot\run_evals.py" rag --cases-path $CasesPath
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
