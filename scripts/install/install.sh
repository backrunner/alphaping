#!/bin/sh
set -eu
set -f
umask 077

fail() { echo "$*" >&2; exit 1; }
ENDPOINT=""
MANIFEST_ORIGIN=""
TOKEN=""
MACHINE=""
INSTALL_ROOT=${ALPHAPING_INSTALL_ROOT:-}
case "$INSTALL_ROOT" in ''|/*) ;; *) fail "Install root must be an absolute path" ;; esac

while [ "$#" -gt 0 ]; do
  if [ "$#" -lt 2 ] || [ -z "$2" ]; then fail "Installation option is missing a value"; fi
  case "$1" in
    --endpoint) ENDPOINT=$2 ;;
    --manifest-origin) MANIFEST_ORIGIN=$2 ;;
    --machine) MACHINE=$2 ;;
    --token) TOKEN=$2 ;;
    *) fail "Unknown installation option" ;;
  esac
  shift 2
done
if [ -z "$ENDPOINT" ] || [ -z "$MANIFEST_ORIGIN" ] || [ -z "$MACHINE" ] || [ -z "$TOKEN" ]; then
  echo "Usage: install.sh --endpoint URL --manifest-origin URL --machine MACHINE_ID --token TOKEN" >&2
  exit 2
fi
for ORIGIN in "$ENDPOINT" "$MANIFEST_ORIGIN"; do
  case "$ORIGIN" in https://?*) ;; *) echo "Endpoint and manifest origin must use HTTPS" >&2; exit 2 ;; esac
  AUTHORITY=${ORIGIN#https://}; AUTHORITY=${AUTHORITY%/}
  case "$AUTHORITY" in ''|*[!A-Za-z0-9.:[\]-]*|*/*) fail "Endpoint and manifest origin must be HTTPS origins without credentials, paths or queries" ;; esac
done
for COMMAND in curl install mktemp awk wc tr; do
  command -v "$COMMAND" >/dev/null 2>&1 || fail "Required command is missing: $COMMAND"
done
if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
  fail "Install sha256sum or shasum before running this script"
fi
if [ -z "$INSTALL_ROOT" ] && [ "$(id -u)" != 0 ]; then
  fail "Run this installer as root (sudo sh install.sh ...)"
fi
OS=$(uname -s)
ARCH=$(uname -m)
# A terminal running under Rosetta still needs the native Apple silicon artifact.
if [ "$OS" = Darwin ] && [ "$ARCH" = x86_64 ] && [ "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" = 1 ]; then ARCH=arm64; fi
case "$OS:$ARCH" in
  Linux:x86_64|Linux:amd64) TARGET=linux-x86_64 ;;
  Linux:aarch64|Linux:arm64) TARGET=linux-aarch64 ;;
  Darwin:x86_64) TARGET=macos-x86_64 ;;
  Darwin:arm64) TARGET=macos-aarch64 ;;
  *) fail "Unsupported platform: $OS $ARCH (64-bit Linux, macOS or Windows required)" ;;
esac

if [ "$OS" = Linux ]; then
  BINARY="$INSTALL_ROOT/opt/alphaping/bin/alphaping-agent"
  CONFIG="$INSTALL_ROOT/etc/alphaping/agent.toml"
  SPOOL="$INSTALL_ROOT/var/lib/alphaping/spool.db"
  if command -v systemctl >/dev/null 2>&1 && { [ -n "$INSTALL_ROOT" ] || [ -d /run/systemd/system ]; }; then
    MANAGER=systemd
    UNIT="$INSTALL_ROOT/etc/systemd/system/alphaping-agent.service"
  elif command -v rc-service >/dev/null 2>&1 && command -v rc-update >/dev/null 2>&1 && { [ -n "$INSTALL_ROOT" ] || [ -d /run/openrc ]; }; then
    MANAGER=openrc
    UNIT="$INSTALL_ROOT/etc/init.d/alphaping-agent"
  else
    fail "Linux requires a running systemd or OpenRC service manager; containers/WSL without an init system are unsupported"
  fi
else
  command -v launchctl >/dev/null 2>&1 || fail "macOS requires launchd"
  MANAGER=launchd
  BINARY="$INSTALL_ROOT/Library/Application Support/AlphaPing/bin/alphaping-agent"
  CONFIG="$INSTALL_ROOT/Library/Application Support/AlphaPing/agent.toml"
  SPOOL="$INSTALL_ROOT/Library/Application Support/AlphaPing/spool.db"
  UNIT="$INSTALL_ROOT/Library/LaunchDaemons/top.backrunner.alphaping.agent.plist"
fi
for EXISTING in "$BINARY" "$CONFIG" "$SPOOL" "$UNIT"; do
  if [ -e "$EXISTING" ] || [ -L "$EXISTING" ]; then
    fail "An Agent installation already exists at $EXISTING. Use the signed Agent updater; this installer will not stop or overwrite an existing identity."
  fi
done

TMP_DIR=$(mktemp -d)
INSTALLED=false
cleanup() {
  RESULT=$?
  trap - 0
  rm -rf "$TMP_DIR"
  if [ "$RESULT" -ne 0 ] && [ "$INSTALLED" = true ]; then
    echo "Installation did not complete. Enrollment state was preserved at $CONFIG; inspect the service and run the Agent self-test before restarting. Do not delete spool or identity to retry." >&2
  fi
  exit "$RESULT"
}
trap cleanup 0
trap 'exit 130' INT
trap 'exit 143' TERM
# ulimit bounds even chunked downloads on older curl versions. -f is in 512-byte blocks.
# Run it in a subshell so enrollment/spool writes do not inherit the file-size limit.
download() (
  LIMIT=$1; URL=$2; OUTPUT=$3
  ulimit -f $(( (LIMIT + 511) / 512 ))
  curl -fsSL --proto '=https' --proto-redir '=https' --tlsv1.2 \
    --connect-timeout 15 --max-time 180 --retry 2 --retry-max-time 240 \
    --max-filesize "$LIMIT" "$URL" -o "$OUTPUT"
)
ASSET="alphaping-agent-$TARGET"
download 4096 "${MANIFEST_ORIGIN%/}/agent-release/$TARGET" "$TMP_DIR/manifest"
MANIFEST=$(cat "$TMP_DIR/manifest")
set -- $MANIFEST
[ "$#" -eq 4 ] || fail "Agent release manifest is invalid"
VERSION=$1; LENGTH=$2; EXPECTED=$3; DOWNLOAD_URL=$4
if ! printf '%s\n' "$VERSION" | awk 'BEGIN { ok=0 } /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/ { ok=1 } END { exit !ok }'; then
  fail "Agent release manifest fields are invalid"
fi
case "$LENGTH" in ''|*[!0-9]*) fail "Agent release manifest fields are invalid" ;; esac
case "$EXPECTED" in ''|*[!0-9a-f]*) fail "Agent release manifest fields are invalid" ;; esac
[ "${#LENGTH}" -le 8 ] || fail "Agent release manifest target is invalid"
[ "${#EXPECTED}" -eq 64 ] && [ "$LENGTH" -gt 0 ] && [ "$LENGTH" -le 67108864 ] || fail "Agent release manifest target is invalid"
[ "$DOWNLOAD_URL" = "https://github.com/BackRunner/alphaping/releases/download/v$VERSION/$ASSET" ] || fail "Agent release manifest target is invalid"
download "$LENGTH" "$DOWNLOAD_URL" "$TMP_DIR/alphaping-agent"
if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL=$(sha256sum "$TMP_DIR/alphaping-agent" | awk '{print $1}')
else
  ACTUAL=$(shasum -a 256 "$TMP_DIR/alphaping-agent" | awk '{print $1}')
fi
ACTUAL_LENGTH=$(wc -c <"$TMP_DIR/alphaping-agent" | tr -d '[:space:]')
[ "$EXPECTED" = "$ACTUAL" ] && [ "$LENGTH" = "$ACTUAL_LENGTH" ] || fail "Agent checksum verification failed"
chmod 0755 "$TMP_DIR/alphaping-agent"
[ "$("$TMP_DIR/alphaping-agent" --version)" = "alphaping-agent $VERSION" ] || fail "Agent version does not match the trusted manifest or cannot run on this system"

if [ "$OS" = Linux ]; then
  install -d -m 0755 "$INSTALL_ROOT/opt/alphaping/bin"
  install -d -m 0700 "$INSTALL_ROOT/etc/alphaping" "$INSTALL_ROOT/var/lib/alphaping"
else
  install -d -m 0700 "$INSTALL_ROOT/Library/Application Support/AlphaPing"
  install -d -m 0755 "$INSTALL_ROOT/Library/Application Support/AlphaPing/bin"
fi
# Copy beside the final executable, then rename atomically on the same filesystem.
install -m 0755 "$TMP_DIR/alphaping-agent" "$BINARY.new"
mv "$BINARY.new" "$BINARY"
INSTALLED=true
"$BINARY" enroll --endpoint "$ENDPOINT" --machine "$MACHINE" --token "$TOKEN" --config "$CONFIG"
TOKEN=""
"$BINARY" self-test --config "$CONFIG"

if [ "$MANAGER" = systemd ]; then
  install -d -m 0755 "$INSTALL_ROOT/etc/systemd/system"
  cat >"$UNIT" <<'UNIT'
[Unit]
Description=AlphaPing monitoring agent
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=120
StartLimitBurst=10

[Service]
Type=simple
ExecStart=/opt/alphaping/bin/alphaping-agent /etc/alphaping/agent.toml
Restart=always
RestartSec=5s
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ProtectControlGroups=true
ProtectKernelModules=true
ProtectKernelTunables=true
ReadWritePaths=/var/lib/alphaping /opt/alphaping/bin /etc/alphaping

[Install]
WantedBy=multi-user.target
UNIT
  chmod 0644 "$UNIT"
  systemctl daemon-reload
  systemctl enable --now alphaping-agent.service
  systemctl is-active --quiet alphaping-agent.service
elif [ "$MANAGER" = openrc ]; then
  install -d -m 0755 "$INSTALL_ROOT/etc/init.d"
  cat >"$UNIT" <<'UNIT'
#!/sbin/openrc-run
name="AlphaPing Agent"
description="AlphaPing monitoring agent"
supervisor="supervise-daemon"
command="/opt/alphaping/bin/alphaping-agent"
command_args="/etc/alphaping/agent.toml"
respawn_delay=5
respawn_max=10
respawn_period=120
umask 0077
depend() { need net; after firewall; }
UNIT
  chmod 0755 "$UNIT"
  rc-update add alphaping-agent default
  rc-service alphaping-agent start
  rc-service alphaping-agent status
else
  install -d -m 0755 "$INSTALL_ROOT/Library/LaunchDaemons"
  # Keep launchd stdio disconnected to avoid unbounded flat log files.
  # Use self-test or a foreground run for local diagnostics.
  cat >"$UNIT" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>top.backrunner.alphaping.agent</string>
  <key>ProgramArguments</key><array>
    <string>/Library/Application Support/AlphaPing/bin/alphaping-agent</string>
    <string>/Library/Application Support/AlphaPing/agent.toml</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>Umask</key><integer>63</integer>
  <key>ProcessType</key><string>Background</string>
</dict></plist>
PLIST
  chmod 0600 "$UNIT"
  launchctl bootstrap system "$UNIT"
  launchctl print system/top.backrunner.alphaping.agent >/dev/null
fi
INSTALLED=false
echo "AlphaPing Agent installed and started ($TARGET, $MANAGER)"
