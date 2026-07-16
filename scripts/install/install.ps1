param(
  [Parameter(Mandatory = $true)][string]$Endpoint,
  [Parameter(Mandatory = $true)][string]$ManifestOrigin,
  [Parameter(Mandatory = $true)][string]$Machine,
  [Parameter(Mandatory = $true)][string]$Token
)

$ErrorActionPreference = "Stop"
if (-not $Endpoint.StartsWith("https://") -or -not $ManifestOrigin.StartsWith("https://")) {
  throw "Endpoint and manifest origin must use HTTPS"
}
$Architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
if ($Architecture -eq [System.Runtime.InteropServices.Architecture]::X64) {
  $Target = "windows-x86_64"
} elseif ($Architecture -eq [System.Runtime.InteropServices.Architecture]::Arm64) {
  $Target = "windows-aarch64"
} else {
  throw "Unsupported Windows architecture: $Architecture"
}

$InstallDirectory = Join-Path $env:ProgramFiles "AlphaPing"
$DataDirectory = Join-Path $env:ProgramData "AlphaPing"
$TemporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid())
New-Item -ItemType Directory -Path $TemporaryDirectory | Out-Null

try {
  $Asset = "alphaping-agent-$Target.exe"
  $Download = Join-Path $TemporaryDirectory "alphaping-agent.exe"
  $ManifestUrl = "$($ManifestOrigin.TrimEnd('/'))/agent-release/$Target"
  $Manifest = ((Invoke-WebRequest -Uri $ManifestUrl).Content.Trim() -split "\s+")
  if ($Manifest.Count -ne 4) { throw "Agent release manifest is invalid" }
  $Version = $Manifest[0]
  $Length = [long]$Manifest[1]
  $Expected = $Manifest[2]
  $DownloadUrl = $Manifest[3]
  $ExpectedUrl = "https://github.com/alkinum/alphaping/releases/download/v$Version/$Asset"
  if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$' -or
      $Length -le 0 -or $Length -gt 67108864 -or
      $Expected -notmatch '^[0-9a-f]{64}$' -or $DownloadUrl -ne $ExpectedUrl) {
    throw "Agent release manifest target is invalid"
  }
  Invoke-WebRequest -Uri $DownloadUrl -OutFile $Download
  $Actual = (Get-FileHash -Path $Download -Algorithm SHA256).Hash.ToLowerInvariant()
  $ActualLength = (Get-Item $Download).Length
  if ($Expected -ne $Actual -or $Length -ne $ActualLength) {
    throw "Agent checksum verification failed"
  }
  $ReportedVersion = (& $Download --version | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $ReportedVersion -ne "alphaping-agent $Version") {
    throw "Agent version does not match the trusted manifest"
  }

  New-Item -ItemType Directory -Force -Path $InstallDirectory, $DataDirectory | Out-Null
  & icacls.exe $DataDirectory /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed to protect the Agent data directory" }
  $Binary = Join-Path $InstallDirectory "alphaping-agent.exe"
  $ExistingService = Get-Service -Name AlphaPingAgent -ErrorAction SilentlyContinue
  if ($null -ne $ExistingService) {
    Stop-Service -Name AlphaPingAgent -Force
    $ExistingService.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Stopped, [TimeSpan]::FromSeconds(30))
  }
  Copy-Item $Download $Binary -Force
  $Config = Join-Path $DataDirectory "agent.toml"
  & $Binary enroll --endpoint $Endpoint --machine $Machine --token $Token --config $Config
  if ($LASTEXITCODE -ne 0) { throw "Agent enrollment failed" }

  if ($null -ne $ExistingService) {
    sc.exe delete AlphaPingAgent | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to replace the existing Agent service" }
    Start-Sleep -Seconds 1
  }
  sc.exe create AlphaPingAgent binPath= "`"$Binary`" service --config `"$Config`"" start= auto DisplayName= "AlphaPing Agent" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed to create the Agent service" }
  sc.exe failure AlphaPingAgent reset= 86400 actions= restart/5000/restart/30000/restart/60000 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed to configure Agent recovery" }
  sc.exe start AlphaPingAgent | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed to start the Agent service" }
  Write-Host "AlphaPing Agent installed and started"
} finally {
  Remove-Item -Recurse -Force $TemporaryDirectory -ErrorAction SilentlyContinue
}
