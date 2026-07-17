import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const unixInstaller = resolve(root, "scripts/install/install.sh");
const windowsInstaller = resolve(root, "scripts/install/install.ps1");
const version = "1.2.3";

function executable(path, content) {
  writeFileSync(path, content, { mode: 0o755 });
  chmodSync(path, 0o755);
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "alphaping-installer-test-"));
  const bin = join(directory, "bin");
  const asset = join(directory, "agent-asset");
  const serviceLog = join(directory, "service.log");
  const enrollmentLog = join(directory, "enrollment.log");
  mkdirSync(bin);
  executable(
    asset,
    `#!/bin/sh
set -eu
if [ "\${1:-}" = "--version" ]; then
  echo "alphaping-agent ${version}"
  exit 0
fi
if [ "\${1:-}" != "enroll" ]; then exit 2; fi
shift
CONFIG=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--config" ]; then CONFIG=$2; fi
  printf '%s\n' "$1" >>"$INSTALL_TEST_ENROLLMENT_LOG"
  shift
done
mkdir -p "$(dirname "$CONFIG")"
umask 077
printf 'enrolled = true\n' >"$CONFIG"
`,
  );
  const bytes = readFileSync(asset);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  return {
    directory,
    bin,
    asset,
    serviceLog,
    enrollmentLog,
    checksum,
    length: bytes.length,
  };
}

function installUnixCommands(fixture_) {
  executable(
    join(fixture_.bin, "curl"),
    `#!/bin/sh
set -eu
OUT=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) OUT=$2; shift 2 ;;
    --proto) shift 2 ;;
    --tlsv1.2|-f|-L|-fsSL|-fL) shift ;;
    *) shift ;;
  esac
done
if [ -z "$OUT" ]; then
  printf '%s\n' "$INSTALL_TEST_MANIFEST"
else
  cp "$INSTALL_TEST_ASSET" "$OUT"
fi
`,
  );
  executable(
    join(fixture_.bin, "uname"),
    `#!/bin/sh
case "\${1:-}" in
  -s) printf '%s\n' "$INSTALL_TEST_OS" ;;
  -m) printf '%s\n' "$INSTALL_TEST_ARCH" ;;
  *) exit 2 ;;
esac
`,
  );
  for (const command of ["systemctl", "launchctl"]) {
    executable(
      join(fixture_.bin, command),
      `#!/bin/sh
printf '${command} %s\n' "$*" >>"$INSTALL_TEST_SERVICE_LOG"
`,
    );
  }
}

function unixEnvironment(fixture_, os, arch, target, manifestVersion = version) {
  const assetName = `alphaping-agent-${target}`;
  const download = `https://github.com/alkinum/alphaping/releases/download/v${manifestVersion}/${assetName}`;
  return {
    ...process.env,
    PATH: `${fixture_.bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
    ALPHAPING_INSTALL_ROOT: join(fixture_.directory, "root"),
    INSTALL_TEST_ASSET: fixture_.asset,
    INSTALL_TEST_ENROLLMENT_LOG: fixture_.enrollmentLog,
    INSTALL_TEST_SERVICE_LOG: fixture_.serviceLog,
    INSTALL_TEST_OS: os,
    INSTALL_TEST_ARCH: arch,
    INSTALL_TEST_MANIFEST: `${manifestVersion} ${fixture_.length} ${fixture_.checksum} ${download}`,
  };
}

function runUnixInstaller(environment) {
  return spawnSync(
    "/bin/sh",
    [
      unixInstaller,
      "--endpoint",
      "https://ingest.example.test",
      "--manifest-origin",
      "https://monitor.example.test",
      "--machine",
      "018f5f7e-7d28-7e12-a521-23456789abcd",
      "--token",
      "installer-e2e-token",
    ],
    { encoding: "utf8", env: environment },
  );
}

test("Linux installer verifies the artifact and enables a hardened systemd service", () => {
  const fixture_ = fixture();
  try {
    installUnixCommands(fixture_);
    const environment = unixEnvironment(fixture_, "Linux", "x86_64", "linux-x86_64");
    const result = runUnixInstaller(environment);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /installed and started/);
    const installRoot = environment.ALPHAPING_INSTALL_ROOT;
    const unit = readFileSync(
      join(installRoot, "etc/systemd/system/alphaping-agent.service"),
      "utf8",
    );
    assert.match(unit, /Restart=always/);
    assert.match(unit, /NoNewPrivileges=true/);
    assert.match(unit, /ProtectSystem=strict/);
    assert.match(unit, /ExecStart=\/opt\/alphaping\/bin\/alphaping-agent/);
    assert.equal(statSync(join(installRoot, "etc/alphaping")).mode & 0o777, 0o700);
    assert.equal(statSync(join(installRoot, "etc/alphaping/agent.toml")).mode & 0o777, 0o600);
    const service = readFileSync(fixture_.serviceLog, "utf8");
    assert.match(service, /systemctl daemon-reload/);
    assert.match(service, /systemctl enable --now alphaping-agent\.service/);
    const enrollment = readFileSync(fixture_.enrollmentLog, "utf8");
    assert.match(enrollment, /--endpoint\nhttps:\/\/ingest\.example\.test/);
    assert.match(enrollment, /--machine\n018f5f7e-7d28-7e12-a521-23456789abcd/);
  } finally {
    rmSync(fixture_.directory, { force: true, recursive: true });
  }
});

test("macOS installer bootstraps a persistent launch daemon", () => {
  const fixture_ = fixture();
  try {
    installUnixCommands(fixture_);
    const environment = unixEnvironment(fixture_, "Darwin", "arm64", "macos-aarch64");
    const result = runUnixInstaller(environment);
    assert.equal(result.status, 0, result.stderr);
    const plistPath = join(
      environment.ALPHAPING_INSTALL_ROOT,
      "Library/LaunchDaemons/top.backrunner.alphaping.agent.plist",
    );
    const plist = readFileSync(plistPath, "utf8");
    assert.match(plist, /<key>RunAtLoad<\/key><true\/>/);
    assert.match(plist, /<key>KeepAlive<\/key><true\/>/);
    assert.match(plist, /\/Library\/Application Support\/AlphaPing\/agent\.toml/);
    assert.equal(statSync(plistPath).mode & 0o777, 0o600);
    const service = readFileSync(fixture_.serviceLog, "utf8");
    assert.match(service, /launchctl bootout system\/top\.backrunner\.alphaping\.agent/);
    assert.match(service, /launchctl bootstrap system/);
  } finally {
    rmSync(fixture_.directory, { force: true, recursive: true });
  }
});

test("Unix installer rejects plaintext origins and non-SemVer manifests", () => {
  const fixture_ = fixture();
  try {
    installUnixCommands(fixture_);
    const environment = unixEnvironment(fixture_, "Linux", "x86_64", "linux-x86_64");
    const plaintext = spawnSync(
      "/bin/sh",
      [
        unixInstaller,
        "--endpoint",
        "http://127.0.0.1",
        "--manifest-origin",
        "https://monitor.example.test",
        "--machine",
        "machine",
        "--token",
        "token",
      ],
      { encoding: "utf8", env: environment },
    );
    assert.equal(plaintext.status, 2);
    assert.match(plaintext.stderr, /must use HTTPS/);

    const invalidManifest = runUnixInstaller({
      ...environment,
      INSTALL_TEST_MANIFEST: `release ${fixture_.length} ${fixture_.checksum} https://github.com/alkinum/alphaping/releases/download/vrelease/alphaping-agent-linux-x86_64`,
    });
    assert.equal(invalidManifest.status, 1);
    assert.match(invalidManifest.stderr, /manifest fields are invalid/);
  } finally {
    rmSync(fixture_.directory, { force: true, recursive: true });
  }
});

test("Windows installer creates an automatic service with recovery actions", (context) => {
  const pwsh = spawnSync("pwsh", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], {
    encoding: "utf8",
  });
  if (pwsh.status !== 0) {
    context.skip("PowerShell is unavailable");
    return;
  }
  const fixture_ = fixture();
  try {
    const programFiles = join(fixture_.directory, "Program Files");
    const programData = join(fixture_.directory, "ProgramData");
    for (const command of ["icacls.exe", "sc.exe"]) {
      executable(
        join(fixture_.bin, command),
        `#!/bin/sh
printf '${command} %s\n' "$*" >>"$INSTALL_TEST_SERVICE_LOG"
`,
      );
    }
    const target = process.arch === "arm64" ? "windows-aarch64" : "windows-x86_64";
    const assetName = `alphaping-agent-${target}.exe`;
    const manifest = `${version} ${fixture_.length} ${fixture_.checksum} https://github.com/alkinum/alphaping/releases/download/v${version}/${assetName}`;
    const command = `& {
      function global:Invoke-WebRequest {
        param([string]$Uri, [string]$OutFile)
        if ($OutFile) { Copy-Item -LiteralPath $env:INSTALL_TEST_ASSET -Destination $OutFile -Force; return }
        return [pscustomobject]@{ Content = $env:INSTALL_TEST_MANIFEST }
      }
      function global:Get-Service { return $null }
      function global:Start-Sleep { param([int]$Seconds) }
      & '${windowsInstaller.replaceAll("'", "''")}' -Endpoint 'https://ingest.example.test' -ManifestOrigin 'https://monitor.example.test' -Machine '018f5f7e-7d28-7e12-a521-23456789abcd' -Token 'installer-e2e-token'
    }`;
    const result = spawnSync("pwsh", ["-NoProfile", "-Command", command], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fixture_.bin}:${process.env.PATH ?? ""}`,
        ProgramFiles: programFiles,
        ProgramData: programData,
        INSTALL_TEST_ASSET: fixture_.asset,
        INSTALL_TEST_MANIFEST: manifest,
        INSTALL_TEST_ENROLLMENT_LOG: fixture_.enrollmentLog,
        INSTALL_TEST_SERVICE_LOG: fixture_.serviceLog,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const service = readFileSync(fixture_.serviceLog, "utf8");
    assert.match(service, /sc\.exe create AlphaPingAgent/);
    assert.match(service, /start= auto/);
    assert.match(service, /sc\.exe failure AlphaPingAgent reset= 86400/);
    assert.match(service, /restart\/5000\/restart\/30000\/restart\/60000/);
    assert.match(service, /sc\.exe start AlphaPingAgent/);
    assert.equal(statSync(join(programData, "AlphaPing", "agent.toml")).mode & 0o777, 0o600);
  } finally {
    rmSync(fixture_.directory, { force: true, recursive: true });
  }
});
