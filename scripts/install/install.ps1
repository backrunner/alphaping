param(
  [Parameter(Mandatory = $true)][string]$Endpoint,
  [Parameter(Mandatory = $true)][string]$Machine,
  [Parameter(Mandatory = $true)][string]$Token
)

$ErrorActionPreference = "Stop"
$Repository = "alkinum/alphaping"
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
  $BaseUrl = "https://github.com/$Repository/releases/latest/download"
  $Download = Join-Path $TemporaryDirectory "alphaping-agent.exe"
  $Checksum = Join-Path $TemporaryDirectory "agent.sha256"
  Invoke-WebRequest -Uri "$BaseUrl/$Asset" -OutFile $Download
  Invoke-WebRequest -Uri "$BaseUrl/$Asset.sha256" -OutFile $Checksum
  $Expected = ((Get-Content $Checksum -Raw).Trim() -split "\s+")[0].ToLowerInvariant()
  $Actual = (Get-FileHash -Path $Download -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($Expected -ne $Actual) { throw "Agent checksum verification failed" }

  New-Item -ItemType Directory -Force -Path $InstallDirectory, $DataDirectory | Out-Null
  $Binary = Join-Path $InstallDirectory "alphaping-agent.exe"
  Copy-Item $Download $Binary -Force
  $Config = Join-Path $DataDirectory "agent.toml"
  & $Binary enroll --endpoint $Endpoint --machine $Machine --token $Token --config $Config
  if ($LASTEXITCODE -ne 0) { throw "Agent enrollment failed" }

  sc.exe stop AlphaPingAgent 2>$null | Out-Null
  sc.exe delete AlphaPingAgent 2>$null | Out-Null
  sc.exe create AlphaPingAgent binPath= "`"$Binary`" `"$Config`"" start= auto DisplayName= "AlphaPing Agent" | Out-Null
  sc.exe failure AlphaPingAgent reset= 86400 actions= restart/5000/restart/30000/restart/60000 | Out-Null
  sc.exe start AlphaPingAgent | Out-Null
  Write-Host "AlphaPing Agent installed and started"
} finally {
  Remove-Item -Recurse -Force $TemporaryDirectory -ErrorAction SilentlyContinue
}
