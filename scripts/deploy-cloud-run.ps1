# Deploy FastAPI backend to Cloud Run (must match firebase.json: blackpot-api, us-central1).
# Prereqs: Google Cloud SDK (gcloud), billing enabled, same GCP project as Firebase.
#
# 1) Copy backend\cloud-run-env.yaml.example to backend\cloud-run-env.yaml and edit values.
# 2) From repo root:
#    powershell -ExecutionPolicy Bypass -File .\scripts\deploy-cloud-run.ps1
#
# First-time: gcloud auth login && gcloud config set project blackpot-c2794
#
param(
    [string]$Service = "blackpot-api",
    [string]$Region = "us-central1",
    [string]$EnvFile = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Backend = Join-Path $RepoRoot "backend"

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    Write-Host "gcloud not found. Install Google Cloud SDK:" -ForegroundColor Red
    Write-Host "  https://cloud.google.com/sdk/docs/install" -ForegroundColor White
    exit 1
}

$yaml = if ($EnvFile) { $EnvFile } else { Join-Path $Backend "cloud-run-env.yaml" }
if (-not (Test-Path $yaml)) {
    Write-Host "Missing env file: $yaml" -ForegroundColor Red
    Write-Host "Copy backend\cloud-run-env.yaml.example -> backend\cloud-run-env.yaml and edit." -ForegroundColor Yellow
    exit 1
}

Write-Host "=== Cloud Run deploy: $Service ($Region) ===" -ForegroundColor Cyan
Write-Host "Env file: $yaml"
Set-Location $Backend

gcloud run deploy $Service `
    --source . `
    --region $Region `
    --env-vars-file $yaml

if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Ensure the Cloud Run service account can use Firebase Admin (Firestore, etc.)." -ForegroundColor Yellow
Write-Host "After first deploy, open the hosted app and smoke-test sign-in + /api/session + Settings." -ForegroundColor Green
