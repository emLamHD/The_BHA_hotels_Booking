#!/usr/bin/env bash
# BHA-BACKEND-CD-001-CP01: release policy for .github/workflows/backend-image.yml.
# Decisions and checks live here (not inline in YAML) so tests/test_backend_release.py can run them.
#
#   plan                      EVENT REF SOURCE_SHA GITHUB_SHA [MAIN_PUBLISH_ENABLED DEVELOP_PUBLISH_ENABLED ...]
#                             -> source_sha, lane (main|develop|none), publish (true|false) outputs
#   require-config <lane>     ROLE_ARN REGION REPOSITORY (+ REPO_LEVEL_*) -> fails before any AWS call
#   check-image <image>       EXPECT_SOURCE_SHA EXPECT_SOURCE_URL [EXPECT_IMAGE_ID] -> image_id output
#   pack <image> <dir>        docker save + metadata.json + tar_sha256/image_id outputs
#   unpack <dir> <image>      verify tar integrity + metadata, docker load, check-image
#
# Nothing here talks to AWS. Annotations go to stdout (GitHub reads workflow commands there).
set -euo pipefail

fail() { echo "::error::$*"; exit 1; }
notice() { echo "::notice::$*"; }
out() { if [[ -n "${GITHUB_OUTPUT:-}" ]]; then echo "$1=$2" >> "$GITHUB_OUTPUT"; fi; }

plan() {
  local event="${EVENT:?EVENT is required}" ref="${REF:?REF is required}"
  local sha="${SOURCE_SHA:?SOURCE_SHA is required}" github_sha="${GITHUB_SHA:?GITHUB_SHA is required}"
  local lane=none publish=false
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || fail "SOURCE_SHA is not a full lowercase 40-character commit SHA."
  case "$event" in
    push)
      # A push builds the pushed commit itself; there is no other source it could mean.
      [[ "$sha" == "$github_sha" ]] || fail "A push run must build the pushed commit (SOURCE_SHA differs from GITHUB_SHA)."
      case "$ref" in
        refs/heads/main)
          lane=main
          if [[ "${MAIN_PUBLISH_ENABLED:-}" == "true" ]]; then publish=true
          else notice "BACKEND_RELEASE_PUBLISH_ENABLED is not exactly 'true'; main release publish is disabled. Verify and build only. PUBLISH: NOT_RUN."; fi ;;
        refs/heads/develop)
          lane=develop
          if [[ "${DEVELOP_PUBLISH_ENABLED:-}" == "true" ]]; then publish=true
          else notice "ECR_PUBLISH_ENABLED is not 'true'; develop publish is disabled. Verify and build only. PUBLISH: NOT_RUN."; fi ;;
        *) notice "Ref is neither develop nor main; verify and build only." ;;
      esac ;;
    pull_request) notice "Pull request: verify and build the PR head only. No AWS, no publish." ;;
    *) notice "Event does not publish; verify and build only." ;;
  esac
  out source_sha "$sha"
  out lane "$lane"
  out publish "$publish"
  # The publish job runs inside an Environment, where a missing variable silently falls back to the
  # repository-level one. Only this job sees the repository level, so it hands the values over.
  out repo_level_region "${REPO_LEVEL_REGION:-}"
  out repo_level_repository "${REPO_LEVEL_REPOSITORY:-}"
  out repo_level_role_arn_set "$([[ -n "${REPO_LEVEL_ROLE_ARN:-}" ]] && echo true || echo false)"
  echo "source=$sha lane=$lane publish=$publish"
}

require_config() {
  local lane="${1:?lane}" role_name region_name=AWS_REGION repo_name=ECR_REPOSITORY missing=()
  case "$lane" in
    main) role_name=AWS_ROLE_ARN ;;
    develop) role_name=AWS_ECR_ROLE_ARN ;;
    *) fail "Unknown publish lane." ;;
  esac
  [[ -n "${ROLE_ARN:-}" ]] || missing+=("$role_name")
  [[ -n "${REGION:-}" ]] || missing+=("$region_name")
  [[ -n "${REPOSITORY:-}" ]] || missing+=("$repo_name")
  if (( ${#missing[@]} )); then
    fail "Publishing is enabled but the variable(s) ${missing[*]} are missing; nothing was published."
  fi
  [[ "$ROLE_ARN" =~ ^arn:aws(-[a-z]+)*:iam::[0-9]{12}:role/[A-Za-z0-9+=,.@_/-]{1,512}$ ]] || fail "$role_name is not an IAM role ARN."
  [[ "$REGION" =~ ^[a-z]{2}(-[a-z]+)+-[0-9]+$ ]] || fail "$region_name is not an AWS region name."
  [[ "${#REPOSITORY}" -le 256 && "$REPOSITORY" =~ ^[a-z0-9]+([._-][a-z0-9]+)*(/[a-z0-9]+([._-][a-z0-9]+)*)*$ ]] || fail "$repo_name is not a valid ECR repository name."
  if [[ "$lane" == main ]]; then
    [[ "${REPO_LEVEL_ROLE_ARN_SET:-false}" != "true" ]] || fail "AWS_ROLE_ARN must be defined only in the backend-production environment, not as a repository variable."
    # Cannot be told apart from a deliberate identical value, so it is a warning, not a failure.
    [[ -z "${REPO_LEVEL_REGION:-}" || "$REGION" != "$REPO_LEVEL_REGION" ]] || echo "::warning::AWS_REGION equals the repository-level variable; confirm it is defined in the backend-production environment (a missing environment value falls back silently)."
    [[ -z "${REPO_LEVEL_REPOSITORY:-}" || "$REPOSITORY" != "$REPO_LEVEL_REPOSITORY" ]] || echo "::warning::ECR_REPOSITORY equals the repository-level variable; confirm it is defined in the backend-production environment (a missing environment value falls back silently)."
  fi
  echo "release configuration present and well-formed for lane $lane"
}

check_image() {
  local image="${1:?image}" id rev src
  : "${EXPECT_SOURCE_SHA:?}" "${EXPECT_SOURCE_URL:?}"
  id="$(docker image inspect --format '{{.Id}}' "$image")" || fail "Image $image is not present."
  [[ "$id" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "Image identity is not a sha256 ID."
  rev="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")"
  src="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.source"}}' "$image")"
  [[ "$rev" == "$EXPECT_SOURCE_SHA" ]] || fail "OCI revision label does not equal the source SHA."
  [[ "$src" == "$EXPECT_SOURCE_URL" ]] || fail "OCI source label does not equal the source repository URL."
  if [[ -n "${EXPECT_IMAGE_ID:-}" && "$id" != "$EXPECT_IMAGE_ID" ]]; then fail "Image ID changed (expected the one recorded at build)."; fi
  out image_id "$id"
  echo "image_id=$id revision=$rev source=$src"
}

pack() {
  local image="${1:?image}" dir="${2:?dir}" sha id
  mkdir -p "$dir"
  docker save --output "$dir/image.tar" "$image"
  sha="$(sha256sum "$dir/image.tar")"; sha="${sha%% *}"
  id="$(docker image inspect --format '{{.Id}}' "$image")"
  jq -n --arg source_sha "${EXPECT_SOURCE_SHA:?}" --arg repository "${GITHUB_REPOSITORY:?}" \
    --arg run_id "${GITHUB_RUN_ID:?}" --arg run_attempt "${GITHUB_RUN_ATTEMPT:?}" \
    --arg image_id "$id" --arg tar_sha256 "$sha" \
    '{source_sha:$source_sha, repository:$repository, run_id:$run_id, run_attempt:$run_attempt, image_id:$image_id, tar_sha256:$tar_sha256}' > "$dir/metadata.json"
  out tar_sha256 "$sha"
  out image_id "$id"
  echo "packed $image: image_id=$id tar_sha256=$sha"
}

unpack() {
  local dir="${1:?dir}" image="${2:?image}" sha field
  : "${EXPECT_TAR_SHA256:?}" "${EXPECT_IMAGE_ID:?}" "${EXPECT_SOURCE_SHA:?}" "${GITHUB_RUN_ID:?}"
  [[ -f "$dir/image.tar" && -f "$dir/metadata.json" ]] || fail "Artifact does not contain image.tar and metadata.json."
  sha="$(sha256sum "$dir/image.tar")"; sha="${sha%% *}"
  [[ "$sha" == "$EXPECT_TAR_SHA256" ]] || fail "Image tar checksum differs from the one recorded by the build job."
  for field in "source_sha=$EXPECT_SOURCE_SHA" "run_id=$GITHUB_RUN_ID" "image_id=$EXPECT_IMAGE_ID" "tar_sha256=$sha"; do
    [[ "$(jq -r ".${field%%=*} // empty" "$dir/metadata.json")" == "${field#*=}" ]] || fail "Artifact metadata field ${field%%=*} does not match this run."
  done
  docker load --input "$dir/image.tar" > /dev/null
  check_image "$image"
}

case "${1:-}" in
  plan) plan ;;
  require-config) require_config "${2:-}" ;;
  check-image) check_image "${2:-}" ;;
  pack) pack "${2:-}" "${3:-}" ;;
  unpack) unpack "${2:-}" "${3:-}" ;;
  *) echo "usage: $0 plan | require-config <main|develop> | check-image <image> | pack <image> <dir> | unpack <dir> <image>" >&2; exit 2 ;;
esac
