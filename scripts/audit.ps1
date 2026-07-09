# Submit a one-page audit and watch it complete.
# Reads INTERNAL_API_KEY from .env. Edit $ApiBase if you run locally.
#
#   ./scripts/audit.ps1 -Url "https://yoursite.com"
#   ./scripts/audit.ps1 -Url "https://yoursite.com/pricing" -Goals "locate the pricing","find the primary call-to-action"
#   ./scripts/audit.ps1 -Url "https://staging.yoursite.com/contact" -Goals "complete the contact form" -Environment staging

param(
  [Parameter(Mandatory = $true)] [string]   $Url,
  [string[]] $Goals = @("find and click the primary call-to-action", "locate the pricing"),
  [ValidateSet("production", "staging")] [string] $Environment = "production",
  [string] $Name = "audit",
  [string] $ApiBase = "https://legible-wmvn.onrender.com"
)

$key = ((Get-Content .env | Where-Object { $_ -match '^INTERNAL_API_KEY=' }) -replace '^INTERNAL_API_KEY=', '').Trim()
if (-not $key) { throw "INTERNAL_API_KEY not found in .env" }

# First goal is marked primary (the main conversion goal).
$goalObjects = @()
for ($i = 0; $i -lt $Goals.Count; $i++) {
  $goalObjects += @{ goal = $Goals[$i]; primary = ($i -eq 0) }
}
$payload = @{
  name        = $Name
  environment = $Environment
  pages       = @(@{ url = $Url; goals = $goalObjects })
} | ConvertTo-Json -Depth 6

try {
  $submit = Invoke-RestMethod -Uri "$ApiBase/api/batches" -Method Post -ContentType "application/json" `
    -Headers @{ "x-api-key" = $key } -Body $payload
} catch {
  $resp = $_.Exception.Response
  if ($resp) {
    $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
    Write-Host "API rejected the batch:" -ForegroundColor Red
    Write-Host $reader.ReadToEnd()
    Write-Host ""
    Write-Host "Tip: goals need a read-only verb (find/locate/...) or they're treated as" -ForegroundColor Yellow
    Write-Host "     mutating and blocked against production. Rephrase, or use -Environment staging."
  }
  return
}
$batchId = $submit.batchId
Write-Host "submitted batch $batchId for $Url"

$r = $null
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Seconds 15
  $r = Invoke-RestMethod -Uri "$ApiBase/api/batches/$batchId" -Headers @{ "x-api-key" = $key }
  Write-Host ("  ...{0}  scored {1}/{2}" -f $r.batch.status, $r.progress.scored, $r.progress.total)
  if ($r.batch.status -eq "complete") { break }
}

Write-Host ""
Write-Host ("SCORE: {0}   (prior: {1})" -f $r.scores[0].score, $r.scores[0].prior_score)
$r.scores[0].findings | ForEach-Object { Write-Host ("  [{0}] {1}" -f $_.severity, $_.message) }
Write-Host ""
Write-Host "full report: $ApiBase/api/pages/$($r.pages[0].id)  (or open the dashboard)"
