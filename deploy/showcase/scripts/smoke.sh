#!/usr/bin/env bash
# Smoke checks against the showcase API through the proxy and the media the seeder referenced.
#   API_BASE=https://localhost:7443 CA_CERT=/path/to/rootCA.pem MEDIA_BASE=https://localhost:3000 ./smoke.sh
# Exits non-zero on the first failed check. CA_CERT is the local CA that signed the proxy's
# certificate; without it curl uses the system store.
set -euo pipefail
api="${API_BASE:-https://localhost:7443}"
media="${MEDIA_BASE:-https://localhost:3000}"
curl_opts=(--silent --show-error --max-time 15)
[[ -n "${CA_CERT:-}" ]] && curl_opts+=(--cacert "$CA_CERT")

status() { curl "${curl_opts[@]}" --output /dev/null --write-out '%{http_code}' "$@"; }
expect() { # description, expected, actual
  if [[ "$2" == "$3" ]]; then echo "ok    $1 ($3)"; else echo "FAIL  $1: expected $2, got $3" >&2; exit 1; fi
}

expect "health/ready" 200 "$(status "$api/health/ready")"
expect "properties list" 200 "$(status "$api/api/v1/properties")"
expect "admin board closed without a Staff session" 404 "$(status "$api/api/admin/v1/me")"

# Every media file the manifest publishes must be served as image/webp by the frontend origin.
manifest="$(cd "$(dirname "$0")/../../.." && pwd)/Front_End/Customer_Web/scripts/riverside-media/manifest.json"
python3 - "$manifest" <<'PY' | while read -r name; do
import json, sys
for item in json.load(open(sys.argv[1]))["published"]:
    print(item["derivative"])
PY
  type="$(curl "${curl_opts[@]}" --output /dev/null --write-out '%{http_code} %{content_type}' "$media/media/the-bha-riverside/$name")"
  expect "media $name" "200 image/webp" "$type"
done
echo "smoke passed"
