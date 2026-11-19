#!/bin/bash
# Bootstraps J.A.R.V.I.S. on Ubuntu 24.04 EC2: Node, the app, headless Playwright, Caddy (HTTPS +
# password), and a systemd service for the bridge with Claude on Bedrock via the instance role.
set -euxo pipefail
: "${JARVIS_PASSWORD:?}"
MODEL="${JARVIS_MODEL:-us.anthropic.claude-haiku-4-5-20251001-v1:0}"
REGION="${AWS_REGION:-us-east-1}"
REPO_URL="${REPO_URL:-https://github.com/wasihussain914/jarvis}"
U=ubuntu; H=/home/$U; APP=$H/jarvis

# Public hostname: 1.2.3.4 -> 1-2-3-4.sslip.io (free DNS that resolves to the IP, so Caddy can get a cert)
TOKEN=$(curl -fsS -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 300')
for i in $(seq 1 30); do
  IP=$(curl -fsS -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/public-ipv4 || true)
  [ -n "$IP" ] && break; sleep 5
done
HOST="${IP//./-}.sslip.io"

# Node 22 + Caddy
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs git debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
apt-get update -y && apt-get install -y caddy

# App: install, build the face with the bridge URL baked in
sudo -u $U git clone --depth 1 "$REPO_URL" $APP || sudo -u $U git -C $APP pull
cd $APP
sudo -u $U env npm_config_onnxruntime_node_install_cuda=skip npm ci
printf 'VITE_BACKEND=bridge\nVITE_BRIDGE_URL=wss://%s/bridge\nVITE_PUSH_TO_TALK=true\n' "$HOST" | sudo -u $U tee .env.local
sudo -u $U npm run build

# Hands: headless Chromium via the Playwright MCP server, registered the way Claude Code reads it
sudo -u $U npx -y playwright@latest install --with-deps chromium || npx -y playwright@latest install-deps chromium
sudo -u $U bash -c "cat > $H/.claude.json" <<JSON
{ "mcpServers": { "playwright": { "type": "stdio", "command": "npx",
  "args": ["-y", "@playwright/mcp@0.0.86", "--headless", "--isolated", "--browser", "chromium", "--output-dir", "$H/.jarvis/workspace/playwright"] } } }
JSON
sudo -u $U mkdir -p $H/.jarvis/workspace

# Brain: bridge as a service, Claude Code -> Bedrock with the instance role
cat > /etc/systemd/system/jarvis-bridge.service <<UNIT
[Unit]
Description=J.A.R.V.I.S. bridge
After=network-online.target
[Service]
User=$U
WorkingDirectory=$APP
Environment=HOME=$H
Environment=CLAUDE_CODE_USE_BEDROCK=1
Environment=AWS_REGION=$REGION
Environment=JARVIS_MODEL=$MODEL
Environment=JARVIS_EFFORT=low
Environment=JARVIS_ALLOWED_HOSTS=$HOST
Environment=JARVIS_ALLOWED_ORIGINS=https://$HOST
Environment=JARVIS_DISABLE=browser
Environment=JARVIS_ALLOW_WRITES=${JARVIS_ALLOW_WRITES:-0}
Environment=JARVIS_MCP_SERVERS=playwright
Environment=JARVIS_EXTRA_PROMPT_FILE=$APP/aws/job-hunter.md
ExecStart=/usr/bin/node bridge/server.mjs
Restart=always
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload && systemctl enable --now jarvis-bridge

# Face: Caddy serves the built app + proxies /bridge to the bridge, HTTPS + password
HASH=$(caddy hash-password --plaintext "$JARVIS_PASSWORD")
chmod o+x $H; chmod -R o+rX $APP/dist
cat > /etc/caddy/Caddyfile <<CADDY
$HOST {
  basic_auth {
    tony $HASH
  }
  handle_path /bridge* {
    reverse_proxy 127.0.0.1:8787
  }
  handle {
    root * $APP/dist
    try_files {path} /index.html
    file_server
  }
}
CADDY
systemctl restart caddy
echo "JARVIS READY at https://$HOST"
