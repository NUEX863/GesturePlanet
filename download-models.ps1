$ErrorActionPreference = 'Stop'
$assetDirectory = Join-Path $PSScriptRoot 'assets/mediapipe-hands'
New-Item -ItemType Directory -Force -Path $assetDirectory | Out-Null
$version = '0.4.1675469240'
$providers = @("https://unpkg.com/@mediapipe/hands@$version", "https://cdn.jsdelivr.net/npm/@mediapipe/hands@$version")
$manifest = Get-Content -LiteralPath (Join-Path $assetDirectory 'manifest.json') -Raw | ConvertFrom-Json
foreach ($file in $manifest.files) {
    $destination = Join-Path $assetDirectory $file.name
    $valid = $false
    if (Test-Path -LiteralPath $destination) {
        $bytes = [IO.File]::ReadAllBytes($destination)
        $valid = $bytes.Length -eq $file.size -and [Convert]::ToBase64String([Security.Cryptography.SHA256]::HashData($bytes)) -eq $file.hash
    }
    if ($valid) { Write-Output "Verified: $($file.name)"; continue }
    foreach ($provider in $providers) {
        try {
            Invoke-WebRequest -Uri "$provider/$($file.name)" -OutFile "$destination.part" -TimeoutSec 90
            $bytes = [IO.File]::ReadAllBytes("$destination.part")
            if ($bytes.Length -ne $file.size -or [Convert]::ToBase64String([Security.Cryptography.SHA256]::HashData($bytes)) -ne $file.hash) { throw 'Size or SHA-256 mismatch' }
            Move-Item -LiteralPath "$destination.part" -Destination $destination -Force
            $valid = $true
            Write-Output "Downloaded and verified: $($file.name)"
            break
        } catch { Write-Warning "$($file.name): $($_.Exception.Message)" }
    }
    if (-not $valid) { throw "Could not download $($file.name)" }
}
Write-Output 'All hand-tracking assets are ready for GitHub Pages.'
