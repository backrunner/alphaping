#requires -Version 5.1
param(
  [Parameter(Mandatory = $true)][string]$Endpoint,
  [Parameter(Mandatory = $true)][string]$ManifestOrigin,
  [Parameter(Mandatory = $true)][string]$Machine,
  [Parameter(Mandatory = $true)][string]$Token
)

$ErrorActionPreference = "Stop"
foreach ($Origin in @($Endpoint, $ManifestOrigin)) {
  $Parsed = [Uri]$Origin
  if (-not $Parsed.IsAbsoluteUri -or $Parsed.Scheme -ne "https" -or
      $Parsed.UserInfo -or $Parsed.AbsolutePath -ne "/" -or $Parsed.Query -or $Parsed.Fragment) {
    throw "Endpoint and manifest origin must be HTTPS origins without credentials, paths or queries"
  }
}
function Assert-InstallEnvironment {
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw "This installer requires Windows; use install.sh on Linux or macOS"
}
$Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$Principal = New-Object Security.Principal.WindowsPrincipal($Identity)
if (-not $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Open PowerShell as Administrator before installing AlphaPing"
}
}
Assert-InstallEnvironment
# PROCESSOR_ARCHITEW6432 reports the native OS from a 32-bit PowerShell process.
$Architecture = $env:PROCESSOR_ARCHITEW6432
if (-not $Architecture) { $Architecture = $env:PROCESSOR_ARCHITECTURE }
switch ($Architecture) {
  "AMD64" { $Target = "windows-x86_64" }
  "ARM64" { $Target = "windows-aarch64" }
  default { throw "Unsupported Windows architecture: $Architecture" }
}
$InstallDirectory = Join-Path $env:ProgramFiles "AlphaPing"
$DataDirectory = Join-Path $env:ProgramData "AlphaPing"
$Binary = Join-Path $InstallDirectory "alphaping-agent.exe"
$Config = Join-Path $DataDirectory "agent.toml"
$Spool = Join-Path $DataDirectory "spool.db"
if ((Get-Service -Name AlphaPingAgent -ErrorAction SilentlyContinue) -or
    (Test-Path -LiteralPath $Binary) -or (Test-Path -LiteralPath $Config) -or (Test-Path -LiteralPath $Spool)) {
  throw "An Agent installation already exists. Use the signed Agent updater; existing service and identity were preserved."
}

Add-Type -AssemblyName System.Net.Http
# Use bounded streaming on both Windows PowerShell 5.1 and PowerShell 7. Do not use
# Invoke-WebRequest defaults (IE parsing, unbounded files and implicit redirects).
function Download-BoundedFile([string]$Url, [string]$Destination, [long]$MaximumBytes) {
  $Handler = New-Object System.Net.Http.HttpClientHandler
  $Handler.AllowAutoRedirect = $false
  $Handler.SslProtocols = [System.Security.Authentication.SslProtocols]::Tls12
  $Client = New-Object System.Net.Http.HttpClient($Handler)
  $Cancellation = New-Object System.Threading.CancellationTokenSource
  $Cancellation.CancelAfter(180000)
  try {
    for ($Redirect = 0; $Redirect -le 5; $Redirect++) {
      $Uri = [Uri]$Url
      if ($Uri.Scheme -ne "https" -or $Uri.UserInfo) { throw "Download requires HTTPS without URL credentials" }
      $Response = $Client.GetAsync($Uri, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead, $Cancellation.Token).GetAwaiter().GetResult()
      try {
        $Status = [int]$Response.StatusCode
        if ($Status -in @(301, 302, 303, 307, 308)) {
          if ($Redirect -eq 5 -or -not $Response.Headers.Location) { throw "Download redirect limit exceeded" }
          $Url = (New-Object Uri($Uri, $Response.Headers.Location)).AbsoluteUri
          continue
        }
        $Response.EnsureSuccessStatusCode() | Out-Null
        if ($Response.Content.Headers.ContentLength -gt $MaximumBytes) { throw "Download exceeds size limit" }
        $InputStream = $Response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $OutputStream = [IO.File]::Open($Destination, [IO.FileMode]::CreateNew)
        try {
          $Buffer = New-Object byte[] 8192
          [long]$Total = 0
          while (($Count = $InputStream.ReadAsync($Buffer, 0, $Buffer.Length, $Cancellation.Token).GetAwaiter().GetResult()) -gt 0) {
            $Total += $Count
            if ($Total -gt $MaximumBytes) { throw "Download exceeds size limit" }
            $OutputStream.Write($Buffer, 0, $Count)
          }
          $OutputStream.Flush($true)
        } finally {
          $OutputStream.Dispose()
          $InputStream.Dispose()
        }
        return
      } finally { $Response.Dispose() }
    }
  } finally {
    $Client.Dispose()
    $Cancellation.Dispose()
  }
}

$TemporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $TemporaryDirectory | Out-Null
$Installed = $false
try {
  & icacls.exe $TemporaryDirectory /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed to protect the installer directory" }
  $Asset = "alphaping-agent-$Target.exe"
  $Download = Join-Path $TemporaryDirectory "alphaping-agent.exe"
  $ManifestFile = Join-Path $TemporaryDirectory "manifest.txt"
  Download-BoundedFile "$($ManifestOrigin.TrimEnd('/'))/agent-release/$Target" $ManifestFile 4096
  $Manifest = ([IO.File]::ReadAllText($ManifestFile).Trim() -split "\s+")
  if ($Manifest.Count -ne 4) { throw "Agent release manifest is invalid" }
  $Version = $Manifest[0]
  $Length = [long]$Manifest[1]
  $Expected = $Manifest[2]
  $DownloadUrl = $Manifest[3]
  $ExpectedUrl = "https://github.com/BackRunner/alphaping/releases/download/v$Version/$Asset"
  if ($Version -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$' -or
      $Length -le 0 -or $Length -gt 67108864 -or
      $Expected -cnotmatch '^[0-9a-f]{64}$' -or $DownloadUrl -cne $ExpectedUrl) {
    throw "Agent release manifest target is invalid"
  }
  Download-BoundedFile $DownloadUrl $Download $Length
  $Actual = (Get-FileHash -LiteralPath $Download -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($Expected -cne $Actual -or $Length -ne (Get-Item -LiteralPath $Download).Length) {
    throw "Agent checksum verification failed"
  }
  $ReportedVersion = (& $Download --version | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $ReportedVersion -cne "alphaping-agent $Version") {
    throw "Agent version does not match the trusted manifest"
  }
  New-Item -ItemType Directory -Force -Path $InstallDirectory, $DataDirectory | Out-Null
  foreach ($Directory in @($InstallDirectory, $DataDirectory)) {
    & icacls.exe $Directory /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to protect the Agent directory" }
  }
  Copy-Item -LiteralPath $Download -Destination "$Binary.new"
  Move-Item -LiteralPath "$Binary.new" -Destination $Binary
  $Installed = $true
  & $Binary enroll --endpoint $Endpoint --machine $Machine --token $Token --config $Config
  if ($LASTEXITCODE -ne 0) { throw "Agent enrollment failed" }
  $Token = ""
  & $Binary self-test --config $Config
  if ($LASTEXITCODE -ne 0) { throw "Agent self-test failed" }
  & sc.exe create AlphaPingAgent binPath= "`"$Binary`" service --config `"$Config`"" start= auto DisplayName= "AlphaPing Agent" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed to create the Agent service" }
  & sc.exe failure AlphaPingAgent reset= 86400 actions= restart/5000/restart/30000/restart/60000 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed to configure Agent recovery" }
  & sc.exe start AlphaPingAgent | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed to start the Agent service" }
  (Get-Service AlphaPingAgent).WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Running, [TimeSpan]::FromSeconds(30))
  $Installed = $false
  Write-Host "AlphaPing Agent installed and started ($Target)"
} finally {
  Remove-Item -LiteralPath $TemporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue
  if ($Installed) { Write-Warning "Installation did not complete. Enrollment state was preserved at $Config. Inspect the service and run the Agent self-test before restarting; do not delete spool or identity to retry." }
}
