param(
    [string]$BackendUrl = "http://localhost:8000",
    [string]$CasesPath = "evals/prompt_cases.jsonl",
    [string]$ApiKey = $env:APP_API_KEY,
    [switch]$UseApi
)

if (!$UseApi) {
    $Root = Split-Path -Parent $PSScriptRoot
    Push-Location $Root
    try {
        python "$PSScriptRoot\run_evals.py" ai --cases-path $CasesPath
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
    cases_path = $CasesPath
    eval_type = "prompt"
} | ConvertTo-Json

try {
    Invoke-RestMethod `
        -Method Post `
        -Uri "$BackendUrl/evals/ai" `
        -Headers $headers `
        -Body $body `
        -ErrorAction Stop |
        ConvertTo-Json -Depth 8
}
catch {
    Write-Error "Falha ao executar eval IA via API: $($_.Exception.Message)"
    exit 1
}
