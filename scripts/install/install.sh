#!/bin/sh
set -eu

REPOSITORY="alkinum/alphaping"
ENDPOINT=""
TOKEN=""
MACHINE=""

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

if [ -z "$ENDPOINT" ] || [ -z "$MACHINE" ] || [ -z "$TOKEN" ]; then
  echo "Usage: install.sh --endpoint https://ingest.example.com --machine MACHINE_ID --token TOKEN" >&2
  exit 2
fi

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
BASE_URL="https://github.com/$REPOSITORY/releases/latest/download"
curl -fL --proto '=https' --tlsv1.2 "$BASE_URL/$ASSET" -o "$TMP_DIR/alphaping-agent"
curl -fL --proto '=https' --tlsv1.2 "$BASE_URL/$ASSET.sha256" -o "$TMP_DIR/agent.sha256"

EXPECTED=$(awk '{print $1}' "$TMP_DIR/agent.sha256")
if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL=$(sha256sum "$TMP_DIR/alphaping-agent" | awk '{print $1}')
else
  ACTUAL=$(shasum -a 256 "$TMP_DIR/alphaping-agent" | awk '{print $1}')
fi
if [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "Agent checksum verification failed" >&2
  exit 1
fi

install -m 0755 "$TMP_DIR/alphaping-agent" /usr/local/bin/alphaping-agent

if [ "$OS" = "Linux" ]; then
  install -d -m 0700 /etc/alphaping /var/lib/alphaping
  /usr/local/bin/alphaping-agent enroll \
    --endpoint "$ENDPOINT" \
    --machine "$MACHINE" \
    --token "$TOKEN" \
    --config /etc/alphaping/agent.toml
  cat >/etc/systemd/system/alphaping-agent.service <<'UNIT'
[Unit]
Description=AlphaPing monitoring agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/alphaping-agent /etc/alphaping/agent.toml
Restart=always
RestartSec=5s
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/lib/alphaping

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable --now alphaping-agent.service
else
  install -d -m 0700 "/Library/Application Support/AlphaPing"
  /usr/local/bin/alphaping-agent enroll \
    --endpoint "$ENDPOINT" \
    --machine "$MACHINE" \
    --token "$TOKEN" \
    --config "/Library/Application Support/AlphaPing/agent.toml"
  cat >/Library/LaunchDaemons/top.backrunner.alphaping.agent.plist <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>top.backrunner.alphaping.agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/alphaping-agent</string>
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
  install -d -m 0755 /Library/Logs/AlphaPing
  chmod 0600 /Library/LaunchDaemons/top.backrunner.alphaping.agent.plist
  launchctl bootout system/top.backrunner.alphaping.agent 2>/dev/null || true
  launchctl bootstrap system /Library/LaunchDaemons/top.backrunner.alphaping.agent.plist
fi

echo "AlphaPing Agent installed and started"
