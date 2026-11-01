$key = [System.Web.Security.Membership]::GeneratePassword(64, 0)
$secret = [System.Web.Security.Membership]::GeneratePassword(64, 0)

Write-Host "DEVICE_KEY=$key"
Write-Host "WH_SECRET=$secret"
Write-Host ""
Write-Host "Copy these into .env:"
