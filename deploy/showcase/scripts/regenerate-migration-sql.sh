#!/usr/bin/env bash
# Regenerates ../migrations/idempotent.sql from the EF Core migrations (all of them, idempotent:
# safe to run against an empty database or one already at any earlier migration). Needs dotnet-ef.
# With --check, writes nothing and exits 1 when the committed file is out of date.
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
target="$root/deploy/showcase/migrations/idempotent.sql"
out="$target"
[[ "${1:-}" == "--check" ]] && out="$(mktemp)"

dotnet ef migrations script --idempotent --configuration Release \
  --project "$root/Back_End/src/TheBha.Infrastructure/TheBha.Infrastructure.csproj" \
  --startup-project "$root/Back_End/src/TheBha.Api/TheBha.Api.csproj" \
  --output "$out" >/dev/null
sed -i '1s/^\xEF\xBB\xBF//' "$out"

if [[ "${1:-}" == "--check" ]]; then
  if diff -q "$out" "$target" >/dev/null; then echo "idempotent.sql is up to date"; rm -f "$out"; exit 0; fi
  echo "idempotent.sql is out of date; run regenerate-migration-sql.sh" >&2; rm -f "$out"; exit 1
fi
echo "wrote $target"
