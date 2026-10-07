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
expect "admin session route answers 401 without a Staff session" 401 "$(status "$api/api/admin/v1/me")"

# Every image URL the API hands the browser (property gallery and room-type galleries) must be
# served as image/webp by the frontend origin it names. Read from the API, not from the manifest or
# the database: this is exactly what a guest's browser requests, and needs no database credentials.
# A 401 on the Staff session route through the TLS proxy (not 404) shows the forwarded scheme is trusted:
# a cleartext request to that route would be refused with 404.
urls="$(python3 - "$api" "${CA_CERT:-}" <<'PY'
import json, ssl, sys, urllib.request
api, ca = sys.argv[1], sys.argv[2]
context = ssl.create_default_context(cafile=ca or None)
get = lambda path: json.load(urllib.request.urlopen(api + path, context=context))
seen = []
for property in get("/api/v1/properties"):
    seen += [m["url"] for m in property["media"]]
    for room_type in get(f"/api/v1/properties/{property['id']}/room-types"):
        seen += [m["url"] for m in room_type["media"]]
print("\n".join(dict.fromkeys(seen)))
PY
)"
[[ -n "$urls" ]] || { echo "FAIL  the API returned no image URLs" >&2; exit 1; }
count=0
while read -r url; do
  [[ "$url" == "$media"/media/the-bha-riverside/* ]] || { echo "FAIL  image URL outside $media: $url" >&2; exit 1; }
  type="$(curl "${curl_opts[@]}" --output /dev/null --write-out '%{http_code} %{content_type}' "$url")"
  expect "image ${url##*/}" "200 image/webp" "$type"
  count=$((count + 1))
done <<< "$urls"
echo "smoke passed ($count distinct image URLs)"
