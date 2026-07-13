param(
    [string]$BackendUrl = "http://localhost:8000",
    [string]$ModelId = "",
    [string]$CasesPath = "evals/ml_cases.jsonl",
    [string]$ApiKey = $env:APP_API_KEY,
    [switch]$UseApi
)

if (!$UseApi) {
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
}

$headers = @{ "Content-Type" = "application/json" }
if ($ApiKey) {
    $headers["X-API-Key"] = $ApiKey
}

$body = @{
    model_id = if ($ModelId) { $ModelId } else { $null }
    cases_path = $CasesPath
} | ConvertTo-Json

try {
    Invoke-RestMethod `
        -Method Post `
        -Uri "$BackendUrl/evals/ml" `
        -Headers $headers `
        -Body $body `
        -ErrorAction Stop |
        ConvertTo-Json -Depth 8
}
catch {
    Write-Error "Falha ao executar eval ML via API: $($_.Exception.Message)"
    exit 1
}
