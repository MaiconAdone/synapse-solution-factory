param(
    [Parameter(Mandatory=$true)]
    [string]$ProjectName,

    [Parameter(Mandatory=$true)]
    [string]$InputPath,

    [string]$DestinoBase = "C:\Users\malves\Documents\Projetos"
)

$ErrorActionPreference = "Stop"

function Convert-ToSafeFileName {
    param([string]$Name)
    $BaseName = [System.IO.Path]::GetFileNameWithoutExtension($Name)
    $Extension = [System.IO.Path]::GetExtension($Name).ToLowerInvariant()
    $SafeBaseName = ($BaseName.ToLowerInvariant() -replace '[^a-z0-9_-]+', '-').Trim('-')
    if ([string]::IsNullOrWhiteSpace($SafeBaseName)) {
        $SafeBaseName = "attachment"
    }
    return "$SafeBaseName$Extension"
}

function Get-AttachmentKind {
    param([string]$Extension)
    $ImageExtensions = @(".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tif", ".tiff")
    $DatasetExtensions = @(".csv", ".tsv", ".xlsx", ".xls", ".json", ".jsonl", ".parquet", ".txt")
    if ($ImageExtensions -contains $Extension) {
        return "image"
    }
    if ($DatasetExtensions -contains $Extension) {
        return "dataset"
    }
    return "file"
}

$ProjectRoot = Join-Path $DestinoBase $ProjectName
if (!(Test-Path $ProjectRoot)) {
    Write-Host "ERRO: projeto nao encontrado: $ProjectRoot" -ForegroundColor Red
    exit 1
}

$ResolvedInput = Resolve-Path -LiteralPath $InputPath -ErrorAction SilentlyContinue
if ($null -eq $ResolvedInput) {
    Write-Host "ERRO: arquivo nao encontrado: $InputPath" -ForegroundColor Red
    exit 1
}

$SourceFile = Get-Item -LiteralPath $ResolvedInput.Path
if ($SourceFile.PSIsContainer) {
    Write-Host "ERRO: informe um arquivo, nao uma pasta: $InputPath" -ForegroundColor Red
    exit 1
}

$Extension = $SourceFile.Extension.ToLowerInvariant()
$Kind = Get-AttachmentKind $Extension
$SafeName = Convert-ToSafeFileName $SourceFile.Name

switch ($Kind) {
    "image" { $RelativeTargetDir = "data\uploads\images" }
    "dataset" { $RelativeTargetDir = "data\raw" }
    default { $RelativeTargetDir = "data\uploads\files" }
}

$TargetDir = Join-Path $ProjectRoot $RelativeTargetDir
New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null

$TargetPath = Join-Path $TargetDir $SafeName
if (Test-Path $TargetPath) {
    $Timestamp = Get-Date -Format "yyyyMMddHHmmss"
    $TargetPath = Join-Path $TargetDir "$([System.IO.Path]::GetFileNameWithoutExtension($SafeName))-$Timestamp$Extension"
}

Copy-Item -LiteralPath $SourceFile.FullName -Destination $TargetPath -Force

$ManifestDir = Join-Path $ProjectRoot "docs\briefings"
New-Item -ItemType Directory -Path $ManifestDir -Force | Out-Null
$ManifestPath = Join-Path $ManifestDir "codex_attachments_manifest.json"

$Existing = @()
if (Test-Path $ManifestPath) {
    $Parsed = Get-Content $ManifestPath -Raw | ConvertFrom-Json
    if ($Parsed.attachments) {
        $Existing = @($Parsed.attachments)
    }
}

$RelativePath = (Resolve-Path -LiteralPath $TargetPath).Path.Substring((Resolve-Path -LiteralPath $ProjectRoot).Path.Length + 1)
$Attachment = [ordered]@{
    original_name = $SourceFile.Name
    stored_path = $RelativePath.Replace("\", "/")
    kind = $Kind
    extension = $Extension
    size_bytes = $SourceFile.Length
    imported_at = (Get-Date).ToString("s")
    codex_context = "Arquivo anexado ao projeto para uso por Codex, Ruflo e agentes especializados."
}

$Manifest = [ordered]@{
    project = $ProjectName
    source = "scripts/import_project_file.ps1"
    usage = "Referencie stored_path no dialogo do Codex. Datasets em data/raw podem ser tratados com a task Codex: Tratar dados com Ruflo economico."
    attachments = @($Existing + [pscustomobject]$Attachment)
}

$Manifest | ConvertTo-Json -Depth 10 | Set-Content -Path $ManifestPath -Encoding UTF8

Write-Host "Arquivo anexado ao projeto." -ForegroundColor Green
Write-Host "Projeto: $ProjectName"
Write-Host "Tipo: $Kind"
Write-Host "Destino: $RelativePath"
Write-Host "Manifesto: docs\briefings\codex_attachments_manifest.json"
