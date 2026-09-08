export interface InstallCommandOptions {
  machineId: string;
  token: string;
  ingestOrigin: string;
  installOrigin: string;
  checksum: string;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function powershellQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function installCommand(mode: "unix" | "windows", options: InstallCommandOptions): string {
  const { machineId, token, ingestOrigin, installOrigin, checksum } = options;
  if (!/^[a-f0-9]{64}$/.test(checksum)) throw new Error("Invalid installer checksum");
  if (mode === "windows") {
    const q = powershellQuote;
    return `$script = Join-Path ([IO.Path]::GetTempPath()) ('alphaping-' + [Guid]::NewGuid() + '.ps1')
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -UseBasicParsing -Uri ${q(`${installOrigin}/install.ps1`)} -MaximumRedirection 0 -TimeoutSec 30 -OutFile $script
  if ((Get-FileHash -LiteralPath $script -Algorithm SHA256).Hash.ToLowerInvariant() -cne '${checksum}') { throw 'Installer checksum mismatch' }
  & ([scriptblock]::Create([IO.File]::ReadAllText($script))) -Endpoint ${q(ingestOrigin)} -ManifestOrigin ${q(installOrigin)} -Machine ${q(machineId)} -Token ${q(token)}
} finally { Remove-Item -LiteralPath $script -Force -ErrorAction SilentlyContinue }`;
  }
  const q = shellQuote;
  return `(set -eu
script=$(mktemp)
trap 'rm -f "$script"' 0
curl -fsS --proto '=https' --tlsv1.2 --connect-timeout 10 --max-time 30 --max-filesize 65536 ${q(`${installOrigin}/install.sh`)} -o "$script"
if command -v sha256sum >/dev/null 2>&1; then actual=$(sha256sum "$script"); else actual=$(shasum -a 256 "$script"); fi
[ "\${actual%% *}" = '${checksum}' ] || { echo 'Installer checksum mismatch' >&2; exit 1; }
if [ "$(id -u)" = 0 ]; then set -- sh; else set -- sudo sh; fi
"$@" "$script" --endpoint ${q(ingestOrigin)} --manifest-origin ${q(installOrigin)} --machine ${q(machineId)} --token ${q(token)}
)`;
}
