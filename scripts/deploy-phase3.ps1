# Phase 3 — Firebase rules, Storage rules, frontend build, Hosting deploy.
# Prereqs: Node.js, npm, Firebase CLI via npx; run `npx firebase-tools@latest login` once.
# Cloud Run is separate: use deploy-cloud-run.ps1 after Google Cloud SDK is installed.
#
# Usage (from repo root):
#   powershell -ExecutionPolicy Bypass -File .\scripts\deploy-phase3.ps1
#
param(
    [switch]$SkipRules,
    [switch]$SkipHosting,
    [string]$ProjectId = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $RepoRoot

$FirebaseCmd = "npx"
$FirebaseArgs = @("-y", "firebase-tools@latest")

function Test-FirebaseAuth {
    & $FirebaseCmd @($FirebaseArgs + @("projects:list")) 2>&1 | Out-Null
    return ($LASTEXITCODE -eq 0)
}

Write-Host "=== Blackpot Phase 3: Firebase (rules + Hosting) ===" -ForegroundColor Cyan
Write-Host "Repo: $RepoRoot"

if (-not (Test-FirebaseAuth)) {
    Write-Host ""
    Write-Host "Firebase CLI is not logged in. Run:" -ForegroundColor Yellow
    Write-Host "  npx -y firebase-tools@latest login" -ForegroundColor White
    Write-Host "Then re-run this script." -ForegroundColor Yellow
    exit 1
}

if ($ProjectId) {
    Write-Host "Using Firebase project: $ProjectId"
    & $FirebaseCmd @($FirebaseArgs + @("use", $ProjectId))
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if (-not $SkipRules) {
    Write-Host ""
    Write-Host "Deploying Firestore rules + Storage rules..." -ForegroundColor Cyan
    & $FirebaseCmd @($FirebaseArgs + @("deploy", "--only", "firestore:rules,storage"))
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if (-not $SkipHosting) {
    Write-Host ""
    Write-Host "Building frontend..." -ForegroundColor Cyan
    Push-Location (Join-Path $RepoRoot "frontend")
    npm run build
    if ($LASTEXITCODE -ne 0) { Pop-Location; exit $LASTEXITCODE }
    Pop-Location

    Write-Host ""
    Write-Host "Deploying Hosting..." -ForegroundColor Cyan
    & $FirebaseCmd @($FirebaseArgs + @("deploy", "--only", "hosting"))
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host ""
Write-Host "Done. Default site URL (check Hosting dashboard for exact URL):" -ForegroundColor Green
Write-Host "  https://blackpot-c2794.web.app" -ForegroundColor White
Write-Host ""
Write-Host "Next: deploy the API to Cloud Run (requires gcloud):" -ForegroundColor Yellow
Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\deploy-cloud-run.ps1" -ForegroundColor White
Write-Host "Then Firebase Console -> Authentication -> Authorized domains -> add your hosting domain." -ForegroundColor Yellow
