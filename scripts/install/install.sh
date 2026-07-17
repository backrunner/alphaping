#!/bin/sh
set -eu

ENDPOINT=""
MANIFEST_ORIGIN=""
TOKEN=""
MACHINE=""
INSTALL_ROOT=${ALPHAPING_INSTALL_ROOT:-}

case "$INSTALL_ROOT" in
  ''|/*) ;;
  *)
    echo "Install root must be an absolute path" >&2
    exit 2
    ;;
esac

while [ "$#" -gt 0 ]; do
  case "$1" in
    --endpoint)
      ENDPOINT=${2:-}
      shift 2
      ;;
    --token)
      TOKEN=${2:-}
      shift 2
      ;;
    --manifest-origin)
      MANIFEST_ORIGIN=${2:-}
      shift 2
      ;;
    --machine)
      MACHINE=${2:-}
      shift 2
      ;;
    *)
      echo "Unknown argument" >&2
      exit 2
      ;;
  esac
done

if [ -z "$ENDPOINT" ] || [ -z "$MANIFEST_ORIGIN" ] || [ -z "$MACHINE" ] || [ -z "$TOKEN" ]; then
  echo "Usage: install.sh --endpoint URL --manifest-origin URL --machine MACHINE_ID --token TOKEN" >&2
  exit 2
fi
case "$ENDPOINT:$MANIFEST_ORIGIN" in
  https://*:https://*) ;;
  *)
    echo "Endpoint and manifest origin must use HTTPS" >&2
    exit 2
    ;;
esac

OS=$(uname -s)
ARCH=$(uname -m)
case "$OS:$ARCH" in
  Linux:x86_64) TARGET="linux-x86_64" ;;
  Linux:aarch64|Linux:arm64) TARGET="linux-aarch64" ;;
  Darwin:x86_64) TARGET="macos-x86_64" ;;
  Darwin:arm64) TARGET="macos-aarch64" ;;
  *)
    echo "Unsupported platform: $OS $ARCH" >&2
    exit 1
    ;;
esac

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM
ASSET="alphaping-agent-$TARGET"
MANIFEST=$(curl -fsSL --proto '=https' --tlsv1.2 \
  "${MANIFEST_ORIGIN%/}/agent-release/$TARGET")
set -- $MANIFEST
if [ "$#" -ne 4 ]; then
  echo "Agent release manifest is invalid" >&2
  exit 1
fi
VERSION=$1
LENGTH=$2
EXPECTED=$3
DOWNLOAD_URL=$4
case "$VERSION" in
  ''|*[!0-9A-Za-z.+-]*)
    echo "Agent release manifest fields are invalid" >&2
    exit 1
    ;;
esac
VERSION_CORE=${VERSION%%-*}
VERSION_CORE=${VERSION_CORE%%+*}
OLD_IFS=$IFS
IFS=.
set -- $VERSION_CORE
IFS=$OLD_IFS
if [ "$#" -ne 3 ]; then
  echo "Agent release manifest fields are invalid" >&2
  exit 1
fi
for PART in "$@"; do
  case "$PART" in
    ''|*[!0-9]*)
      echo "Agent release manifest fields are invalid" >&2
      exit 1
      ;;
  esac
done
case "$LENGTH" in
  ''|*[!0-9]*)
    echo "Agent release manifest fields are invalid" >&2
    exit 1
    ;;
esac
case "$EXPECTED" in
  ''|*[!0-9a-f]*)
    echo "Agent release manifest fields are invalid" >&2
    exit 1
    ;;
esac
EXPECTED_URL="https://github.com/alkinum/alphaping/releases/download/v$VERSION/$ASSET"
if [ "$DOWNLOAD_URL" != "$EXPECTED_URL" ] || [ "${#EXPECTED}" -ne 64 ] || [ "$LENGTH" -le 0 ] || [ "$LENGTH" -gt 67108864 ]; then
  echo "Agent release manifest target is invalid" >&2
  exit 1
fi
curl -fL --proto '=https' --tlsv1.2 "$DOWNLOAD_URL" -o "$TMP_DIR/alphaping-agent"

if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL=$(sha256sum "$TMP_DIR/alphaping-agent" | awk '{print $1}')
else
  ACTUAL=$(shasum -a 256 "$TMP_DIR/alphaping-agent" | awk '{print $1}')
fi
ACTUAL_LENGTH=$(wc -c <"$TMP_DIR/alphaping-agent" | tr -d ' ')
if [ "$EXPECTED" != "$ACTUAL" ] || [ "$LENGTH" != "$ACTUAL_LENGTH" ]; then
  echo "Agent checksum verification failed" >&2
  exit 1
fi
chmod 0755 "$TMP_DIR/alphaping-agent"
if [ "$("$TMP_DIR/alphaping-agent" --version)" != "alphaping-agent $VERSION" ]; then
  echo "Agent version does not match the trusted manifest" >&2
  exit 1
fi

if [ "$OS" = "Linux" ]; then
  BINARY="$INSTALL_ROOT/opt/alphaping/bin/alphaping-agent"
  CONFIG="$INSTALL_ROOT/etc/alphaping/agent.toml"
  UNIT="$INSTALL_ROOT/etc/systemd/system/alphaping-agent.service"
  systemctl stop alphaping-agent.service 2>/dev/null || true
  install -d -m 0755 "$INSTALL_ROOT/opt/alphaping/bin" "$INSTALL_ROOT/etc/systemd/system"
  install -d -m 0700 "$INSTALL_ROOT/etc/alphaping" "$INSTALL_ROOT/var/lib/alphaping"
  install -m 0755 "$TMP_DIR/alphaping-agent" "$BINARY"
  "$BINARY" enroll \
    --endpoint "$ENDPOINT" \
    --machine "$MACHINE" \
    --token "$TOKEN" \
    --config "$CONFIG"
  cat >"$UNIT" <<'UNIT'
[Unit]
Description=AlphaPing monitoring agent
After=network-online.target
Wants=network-online.target

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
ReadWritePaths=/var/lib/alphaping /opt/alphaping/bin

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable --now alphaping-agent.service
else
  BINARY="$INSTALL_ROOT/Library/Application Support/AlphaPing/bin/alphaping-agent"
  CONFIG="$INSTALL_ROOT/Library/Application Support/AlphaPing/agent.toml"
  PLIST="$INSTALL_ROOT/Library/LaunchDaemons/top.backrunner.alphaping.agent.plist"
  launchctl bootout system/top.backrunner.alphaping.agent 2>/dev/null || true
  install -d -m 0700 "$INSTALL_ROOT/Library/Application Support/AlphaPing"
  install -d -m 0755 "$INSTALL_ROOT/Library/Application Support/AlphaPing/bin" \
    "$INSTALL_ROOT/Library/LaunchDaemons" "$INSTALL_ROOT/Library/Logs/AlphaPing"
  install -m 0755 "$TMP_DIR/alphaping-agent" "$BINARY"
  "$BINARY" enroll \
    --endpoint "$ENDPOINT" \
    --machine "$MACHINE" \
    --token "$TOKEN" \
    --config "$CONFIG"
  cat >"$PLIST" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>top.backrunner.alphaping.agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Library/Application Support/AlphaPing/bin/alphaping-agent</string>
    <string>/Library/Application Support/AlphaPing/agent.toml</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>/Library/Logs/AlphaPing/agent.log</string>
  <key>StandardErrorPath</key><string>/Library/Logs/AlphaPing/agent-error.log</string>
</dict>
</plist>
PLIST
  chmod 0600 "$PLIST"
  launchctl bootstrap system "$PLIST"
fi

echo "AlphaPing Agent installed and started"
