param(
    [string]$ModelId = "",
    [string]$CasesPath = "evals/ml_cases.jsonl"
)

$Root = Split-Path -Parent $PSScriptRoot
$Args = @("$PSScriptRoot\run_evals.py", "ml", "--cases-path", $CasesPath)
if ($ModelId) {
    $Args += @("--model-id", $ModelId)
}
Push-Location $Root
try {
    python @Args
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
