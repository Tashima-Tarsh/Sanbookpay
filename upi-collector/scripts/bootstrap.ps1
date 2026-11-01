param(
  [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'

Write-Host "=== UPI Collector Bootstrap ==="

if (-not $SkipInstall) {
  Write-Host "Installing npm dependencies..."
  npm ci
  if ($LASTEXITCODE -ne 0) {
    Write-Error "npm ci failed"
    exit 1
  }
}

if (-not (Test-Path .env)) {
  Write-Host "Generating secrets..."
  & ./scripts/gen-secrets.ps1 | Out-Null
  Write-Host "Copy the DEVICE_KEY and WH_SECRET values above into .env (copy .env.example to .env first)."
} else {
  Write-Host ".env already exists, skipping secret generation."
}

Write-Host ""
Write-Host "=== Bootstrap complete ==="
Write-Host "Next steps:"
Write-Host "1. Edit .env and set DEVICE_KEY, WH_SECRET, NTFY_TOPIC, GMAIL_* values"
Write-Host "2. Run: npm run dev"
Write-Host "3. Run: npm run test-webhook"
Write-Host "4. Set up Android phone with SmsForwarder pointing to http://<LAN-IP>:3000/api/v1/upi/notify"
