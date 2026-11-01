param(
  [string]$BaseUrl = "http://127.0.0.1:3000",
  [string]$NtfyTopic = $env:NTFY_TOPIC,
  [int]$StaleMinutes = 10
)

Write-Host "=== Heartbeat Monitor ==="
Write-Host "Base URL: $BaseUrl"
Write-Host "Ntfy topic: $NtfyTopic"
Write-Host "Stale threshold: $StaleMinutes minutes"
Write-Host ""

while ($true) {
  try {
    $response = Invoke-RestMethod -Uri "$BaseUrl/api/v1/health" -Method Get -ContentType "application/json" -TimeoutSec 10
    $lastSms = $response.last_sms_at
    $queueDepth = $response.queue_depth

    if ($lastSms) {
      $lastSmsDate = [DateTime]$lastSms
      $ageMinutes = (Get-Date) - $lastSmsDate
      if ($ageMinutes.TotalMinutes -gt $StaleMinutes) {
        $msg = "HEARTBEAT ALERT: No SMS received for $([Math]::Round($ageMinutes.TotalMinutes,1)) minutes. Queue depth: $queueDepth"
        Write-Host $msg -ForegroundColor Yellow
        if ($NtfyTopic) {
          try {
            Invoke-RestMethod -Uri "https://ntfy.sh/$NtfyTopic" -Method Post -Body $msg -ContentType "text/plain"
          } catch {
            Write-Host "Failed to send ntfy alert" -ForegroundColor Red
          }
        }
      } else {
        Write-Host "OK: Last SMS $ageMinutes minutes ago. Queue: $queueDepth" -ForegroundColor Green
      }
    } else {
      Write-Host "WARNING: No SMS events ever recorded." -ForegroundColor Yellow
    }
  } catch {
    Write-Host "ERROR: Cannot reach health endpoint at $BaseUrl" -ForegroundColor Red
    if ($NtfyTopic) {
      try {
        Invoke-RestMethod -Uri "https://ntfy.sh/$NtfyTopic" -Method Post -Body "HEARTBEAT ALERT: UPI Collector server unreachable at $BaseUrl" -ContentType "text/plain"
      } catch {}
    }
  }

  Start-Seconds -Seconds 30
}
