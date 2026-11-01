param(
  [string]$BaseUrl = "http://127.0.0.1:3000",
  [string]$DeviceKey = $env:DEVICE_KEY,
  [string]$WhSecret = $env:WH_SECRET
)

$vectorsDir = Join-Path $PSScriptRoot "..\data\test-vectors"
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

function Send-CurlRaw($url, $headers, $bodyFile) {
  $args = @("-s", "-w", "`nHTTP_CODE: %{http_code}`n", "-X", "POST", $url)
  foreach ($h in $headers) { $args += @("-H", $h) }
  if ($bodyFile) { $args += @("-d", "@$bodyFile") }
  $output = & curl.exe @args 2>$null
  $match = $output | Select-String "HTTP_CODE: (\d+)"
  if ($match) { return [int]$match.Matches[0].Groups[1].Value }
  return 0
}

function Test-Case($name, $expectedStatus, $scriptBlock) {
  Write-Host ("TEST: " + $name) -NoNewline
  try {
    $statusCode = & $scriptBlock
    if ($statusCode -eq $expectedStatus) {
      Write-Host " PASS" -ForegroundColor Green
      return $true
    } else {
      Write-Host (" FAIL (expected $expectedStatus, got $statusCode)") -ForegroundColor Red
      return $false
    }
  } catch {
    Write-Host (" FAIL (exception: $($_.Exception.Message))") -ForegroundColor Red
    return $false
  }
}

# Case 1: valid signed payload -> 200
Test-Case "valid signed payload" 200 {
  $bodyFile = Join-Path $vectorsDir "valid.body"
  $sigFile = Join-Path $vectorsDir "valid.sig"
  $keyFile = Join-Path $vectorsDir "valid.key"
  $sig = [System.IO.File]::ReadAllText($sigFile)
  $key = [System.IO.File]::ReadAllText($keyFile)
  $headers = @("Content-Type: application/json", "x-device-key: $key", "x-sig: $sig")
  Send-CurlRaw "$BaseUrl/api/v1/upi/notify" $headers $bodyFile
} | Out-Null

# Case 2: bad device key -> 401
Test-Case "bad device key" 401 {
  $bodyFile = Join-Path $vectorsDir "valid.body"
  $sigFile = Join-Path $vectorsDir "valid.sig"
  $sig = [System.IO.File]::ReadAllText($sigFile)
  $headers = @("Content-Type: application/json", "x-device-key: wrongkey", "x-sig: $sig")
  Send-CurlRaw "$BaseUrl/api/v1/upi/notify" $headers $bodyFile
} | Out-Null

# Case 3: bad HMAC -> 401
Test-Case "bad HMAC" 401 {
  $bodyFile = Join-Path $vectorsDir "valid.body"
  $headers = @("Content-Type: application/json", "x-device-key: $DeviceKey", "x-sig: badsignature")
  Send-CurlRaw "$BaseUrl/api/v1/upi/notify" $headers $bodyFile
} | Out-Null

# Case 4: disallowed sender -> 422
Test-Case "disallowed sender" 422 {
  $bodyFile = Join-Path $vectorsDir "bad_sender.body"
  $sigFile = Join-Path $vectorsDir "bad_sender.sig"
  $keyFile = Join-Path $vectorsDir "bad_sender.key"
  $sig = [System.IO.File]::ReadAllText($sigFile)
  $key = [System.IO.File]::ReadAllText($keyFile)
  $headers = @("Content-Type: application/json", "x-device-key: $key", "x-sig: $sig")
  Send-CurlRaw "$BaseUrl/api/v1/upi/notify" $headers $bodyFile
} | Out-Null

# Case 5: duplicate UTR replay -> 200
Test-Case "duplicate UTR replay" 200 {
  $bodyFile = Join-Path $vectorsDir "duplicate.body"
  $sigFile = Join-Path $vectorsDir "duplicate.sig"
  $keyFile = Join-Path $vectorsDir "duplicate.key"
  $sig = [System.IO.File]::ReadAllText($sigFile)
  $key = [System.IO.File]::ReadAllText($keyFile)
  $headers = @("Content-Type: application/json", "x-device-key: $key", "x-sig: $sig")
  Send-CurlRaw "$BaseUrl/api/v1/upi/notify" $headers $bodyFile
} | Out-Null

# Case 6: garbage body -> 200
Test-Case "garbage body" 200 {
  $bodyFile = Join-Path $vectorsDir "garbage.body"
  $sigFile = Join-Path $vectorsDir "garbage.sig"
  $keyFile = Join-Path $vectorsDir "garbage.key"
  $sig = [System.IO.File]::ReadAllText($sigFile)
  $key = [System.IO.File]::ReadAllText($keyFile)
  $headers = @("Content-Type: application/json", "x-device-key: $key", "x-sig: $sig")
  Send-CurlRaw "$BaseUrl/api/v1/upi/notify" $headers $bodyFile
} | Out-Null

# Case 7: unsigned valid payload -> 401
Test-Case "unsigned valid payload" 401 {
  $bodyFile = Join-Path $vectorsDir "unsigned.body"
  $headers = @("Content-Type: application/json", "x-device-key: $DeviceKey")
  Send-CurlRaw "$BaseUrl/api/v1/upi/notify" $headers $bodyFile
} | Out-Null

Write-Host ""
Write-Host "Test battery complete."
