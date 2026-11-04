#!/bin/sh
# CI job `server-image` (Linux, Docker): builds and runs the deployment stack, then checks that no
# client address reaches the container logs, even on errors. A second Caddy without the log
# filter must log the address under the same requests, so the check can't pass by finding nothing.
# It contacts only containers on this runner.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
project=kilomita-ci
compose="docker compose -p $project -f $here/compose.yaml"
image=$(sed -n 's/^ *image: *\(caddy:.*\)$/\1/p' "$here/compose.yaml")
work=$(mktemp -d)

cleanup() {
  docker rm -f kilomita-control >/dev/null 2>&1 || true
  $compose down -v >/dev/null 2>&1 || true
  rm -f "$here/.env"
  rm -rf "$work"
}
trap cleanup EXIT

secret=$(head -c 32 /dev/urandom | base64)
cat >"$here/.env" <<EOF
KILOMITA_SERVER_HOST=localhost
KILOMITA_SERVER_ORIGINS=https://kilomita.example
KILOMITA_SERVER_TICKET_SECRET=$secret
EOF

$compose up -d --build --wait

# Caddy issues its own certificate for localhost; give it a moment.
ok=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -skf https://localhost/health | grep -q '"status":"ok"'; then ok=1; break; fi
  sleep 2
done
[ -n "$ok" ] || { echo "server-image: /health never answered ok" >&2; exit 1; }
code=$(curl -sk -o /dev/null -w '%{http_code}' https://localhost/ping)
[ "$code" = 403 ] || { echo "server-image: /ping without a ticket gave $code, not 403" >&2; exit 1; }
headers=$(curl -sk -D - -o /dev/null https://localhost/health | tr -d '\r')
printf '%s\n' "$headers" | grep -qi '^strict-transport-security: max-age=31536000$' \
  || { echo "server-image: no HSTS header" >&2; exit 1; }
printf '%s\n' "$headers" | grep -qi '^x-content-type-options: nosniff$' \
  || { echo "server-image: no nosniff header" >&2; exit 1; }
if printf '%s\n' "$headers" | grep -qi '^server:'; then
  echo "server-image: Caddy still names itself" >&2
  exit 1
fi
echo "server-image: health ok, ticketless ping refused, HSTS and nosniff sent"

network="${project}_default"
gateway=$(docker network inspect "$network" -f '{{(index .IPAM.Config 0).Gateway}}')
[ -n "$gateway" ] || { echo "server-image: no gateway address for $network" >&2; exit 1; }

# The requests that make Caddy log: a 502 (the server is down), plain HTTP on the TLS port, and a
# TLS handshake for a name it has no certificate for.
provoke() {
  port=$1
  curl -sk -o /dev/null "https://localhost:$port/ping" || true
  curl -s -o /dev/null "http://localhost:$port/" || true
  openssl s_client -connect "localhost:$port" -servername nobody.invalid </dev/null >/dev/null 2>&1 || true
  sleep 2
}

$compose stop server
code=$(curl -sk -o /dev/null -w '%{http_code}' https://localhost/ping)
[ "$code" = 502 ] || { echo "server-image: expected 502 with the server down, got $code" >&2; exit 1; }
provoke 443

# Positive control: the same site without the filter, on the same network.
printf 'localhost {\n\treverse_proxy server:3940\n}\n' >"$work/Caddyfile"
docker run -d --name kilomita-control --network "$network" -p 8443:443 \
  -v "$work/Caddyfile:/etc/caddy/Caddyfile:ro" "$image" >/dev/null
sleep 3
provoke 8443

if ! docker logs kilomita-control 2>&1 | grep -qF "$gateway"; then
  echo "server-image: the control Caddy never logged $gateway; this check would prove nothing" >&2
  docker logs kilomita-control >&2 || true
  exit 1
fi
if $compose logs --no-color 2>&1 | grep -F "$gateway"; then
  echo "server-image: a client address ($gateway) reached the deployment's logs" >&2
  exit 1
fi
echo "server-image: no client address in the logs (the unfiltered control logged $gateway)"
