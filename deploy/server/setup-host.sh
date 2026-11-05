#!/usr/bin/env bash
# One-time host setup that needs root: nginx site + Let's Encrypt for frontdesk.sholaayeni.xyz.
#   sudo bash /home/runner/frontdesk/bin/setup-host.sh
# Safe to re-run: re-run after the DNS A record exists to obtain the certificate.
set -euo pipefail
host=frontdesk.sholaayeni.xyz
port=3110
[[ $EUID -eq 0 ]] || { echo "Run with sudo." >&2; exit 1; }

site=/etc/nginx/sites-available/$host
if [[ ! -f "$site" ]] || ! grep -q "managed by Certbot" "$site"; then
  cat > "$site" <<NGINX
server {
  listen 80;
  server_name $host;
  client_max_body_size 1m;
  server_tokens off;
  add_header X-Content-Type-Options nosniff always;
  add_header Referrer-Policy no-referrer always;
  location / {
    proxy_pass http://127.0.0.1:$port;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 60s;
  }
}
NGINX
fi
ln -sfn "$site" /etc/nginx/sites-enabled/$host
nginx -t
systemctl reload nginx
if getent hosts $host >/dev/null && [[ ! -d /etc/letsencrypt/live/$host ]]; then
  certbot --nginx -d $host --non-interactive --agree-tos --redirect --hsts -m ayenisholah@gmail.com
  systemctl reload nginx
elif [[ -d /etc/letsencrypt/live/$host ]]; then
  echo "Certificate already present."
else
  echo "DNS for $host does not resolve yet: add the A record, then re-run this script for HTTPS."
fi
echo "Host setup complete."
