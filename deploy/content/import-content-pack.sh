#!/usr/bin/env bash
# BHA-CONTENT-PERSIST-001 — operator entrypoint: run the API image's content-pack command against the real database.
#   import-content-pack.sh dry-run|apply|verify
# Reads (from the environment, or a private file named by BHA_ENV_FILE that holds ConnectionStrings__TheBhaDatabase=...):
#   BHA_API_IMAGE        the API image to run (the same one that serves the site)
#   BHA_DB_NAME          the database's name — it must equal current_database(); the command refuses otherwise
#   BHA_MEDIA_BASE_URL   the Customer origin the catalog photographs are served from, e.g. https://example.com (no path)
#   BHA_ACTOR_EMAIL      an existing Staff account with Blog edit + publish (author of the imported posts); not needed with BHA_GROUPS=catalog,promotions
#   BHA_MEDIA_MOUNT      where the API's WebsiteMedia:RootPath lives: a docker volume name or an absolute host directory (the same one the API container uses)
#   BHA_KEYS_MOUNT       the Data Protection key ring volume/directory (Production refuses to start without one)
# Optional: BHA_GROUPS (website,catalog,promotions,blog), BHA_RESTORE_DELETED=1 (put back rows an earlier import placed and the staff deleted), BHA_DOCKER_ARGS (e.g. "--network host"), BHA_PACK_DIR (default: this pack).
# Never prints the connection string. Run "dry-run" first; "apply" is repeatable, never replaces a row that exists and does not put back what the staff deleted.
set -euo pipefail
mode="${1:-}"; case "$mode" in dry-run|apply|verify) ;; *) echo "usage: $0 dry-run|apply|verify" >&2; exit 2;; esac
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; pack="${BHA_PACK_DIR:-$here/bha-site-content}"
for v in BHA_API_IMAGE BHA_DB_NAME BHA_MEDIA_BASE_URL BHA_MEDIA_MOUNT BHA_KEYS_MOUNT; do [ -n "${!v:-}" ] || { echo "$v is required" >&2; exit 2; }; done
[ -d "$pack" ] || { echo "pack not found: $pack" >&2; exit 2; }
envargs=(); if [ -n "${BHA_ENV_FILE:-}" ]; then [ -f "$BHA_ENV_FILE" ] || { echo "BHA_ENV_FILE not found" >&2; exit 2; }; envargs=(--env-file "$BHA_ENV_FILE"); else [ -n "${ConnectionStrings__TheBhaDatabase:-}" ] || { echo "set BHA_ENV_FILE or ConnectionStrings__TheBhaDatabase" >&2; exit 2; }; envargs=(-e ConnectionStrings__TheBhaDatabase); fi
common=(--expected-database "$BHA_DB_NAME" --pack /pack --media-base-url "$BHA_MEDIA_BASE_URL")
[ -z "${BHA_ACTOR_EMAIL:-}" ] || common+=(--actor-email "$BHA_ACTOR_EMAIL")
[ -z "${BHA_GROUPS:-}" ] || common+=(--groups "$BHA_GROUPS")
[ -z "${BHA_RESTORE_DELETED:-}" ] || common+=(--restore-deleted)
case "$mode" in dry-run) verb=(--content-pack-import "${common[@]}" --dry-run);; apply) verb=(--content-pack-import "${common[@]}" --apply);; verify) verb=(--content-pack-verify "${common[@]}");; esac
# shellcheck disable=SC2086
exec docker run --rm ${BHA_DOCKER_ARGS:-} "${envargs[@]}" -e DataProtection__KeysPath=/var/keys -e WebsiteMedia__RootPath=/var/media \
  -v "$BHA_MEDIA_MOUNT":/var/media -v "$BHA_KEYS_MOUNT":/var/keys -v "$pack":/pack:ro "$BHA_API_IMAGE" "${verb[@]}"
