#!/usr/bin/env bash
# BHA-BACKEND-CD-001-CP01: release policy for .github/workflows/backend-image.yml.
# Decisions and checks live here (not inline in YAML) so tests/test_backend_release.py can run them.
#
#   plan                      EVENT REF SOURCE_SHA GITHUB_SHA [MAIN_PUBLISH_ENABLED DEVELOP_PUBLISH_ENABLED INHERITED_*]
#                             -> source_sha, lane (main|develop|none), publish (true|false), inherited_*_set outputs
#   require-config <lane>     ROLE_ARN REGION REPOSITORY (+ INHERITED_*_SET for main) -> fails before any AWS call;
#                             on success exports role_arn, region, repository: the one validated set later steps use
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
  local lane=none publish=false deploy=false
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
  # Deploy (CP03) is a second, independent switch that only exists on a main push. Enabled without publishing is a
  # configuration error reported here, before any job could reach AWS; every other event/ref ignores the switch.
  if [[ "$lane" == main && "${MAIN_DEPLOY_ENABLED:-}" == "true" ]]; then
    [[ "$publish" == true ]] || fail "BACKEND_RELEASE_DEPLOY_ENABLED is true but BACKEND_RELEASE_PUBLISH_ENABLED is not: a release is deployed only from the image this run publishes. Nothing was published or deployed."
    deploy=true
  elif [[ "$lane" == main ]]; then notice "BACKEND_RELEASE_DEPLOY_ENABLED is not exactly 'true'; no deployment. DEPLOY: NOT_RUN."; fi
  out source_sha "$sha"
  out lane "$lane"
  out publish "$publish"
  out deploy "$deploy"
  out inherited_deploy_role_arn_set "$([[ -n "${INHERITED_DEPLOY_ROLE_ARN:-}" ]] && echo true || echo false)"
  out inherited_instance_id_set "$([[ -n "${INHERITED_INSTANCE_ID:-}" ]] && echo true || echo false)"
  out inherited_host_config_set "$([[ -n "${INHERITED_HOST_CONFIG:-}" ]] && echo true || echo false)"
  # The main release names (BACKEND_RELEASE_AWS_ROLE_ARN/_AWS_REGION/_ECR_REPOSITORY) must be owned by the
  # backend-production environment. This job runs outside any environment, so a non-empty value here was inherited
  # from the repository or organization. Only booleans leave this step, never the values.
  out inherited_role_arn_set "$([[ -n "${INHERITED_ROLE_ARN:-}" ]] && echo true || echo false)"
  out inherited_region_set "$([[ -n "${INHERITED_REGION:-}" ]] && echo true || echo false)"
  out inherited_repository_set "$([[ -n "${INHERITED_REPOSITORY:-}" ]] && echo true || echo false)"
  echo "source=$sha lane=$lane publish=$publish deploy=$deploy"
}

require_config() {
  local lane="${1:?lane}" role_name region_name repo_name missing=() inherited=()
  case "$lane" in
    # Main uses its own names only: no fallback to AWS_ROLE_ARN, AWS_ECR_ROLE_ARN, AWS_REGION or ECR_REPOSITORY.
    main) role_name=BACKEND_RELEASE_AWS_ROLE_ARN; region_name=BACKEND_RELEASE_AWS_REGION; repo_name=BACKEND_RELEASE_ECR_REPOSITORY ;;
    develop) role_name=AWS_ECR_ROLE_ARN; region_name=AWS_REGION; repo_name=ECR_REPOSITORY ;;
    *) fail "Unknown publish lane." ;;
  esac
  if [[ "$lane" == main ]]; then
    # Inside the environment, `vars` silently falls back to repository/organization values. The plan job saw only those
    # outer scopes, so anything other than an explicit "false" (including missing information) is refused.
    [[ "${INHERITED_ROLE_ARN_SET:-}" == false ]] || inherited+=("$role_name")
    [[ "${INHERITED_REGION_SET:-}" == false ]] || inherited+=("$region_name")
    [[ "${INHERITED_REPOSITORY_SET:-}" == false ]] || inherited+=("$repo_name")
    if (( ${#inherited[@]} )); then
      fail "${inherited[*]} must be defined only in the backend-production environment; a value at organization/repository scope (or unknown scope) is refused. Nothing was published."
    fi
  fi
  [[ -n "${ROLE_ARN:-}" ]] || missing+=("$role_name")
  [[ -n "${REGION:-}" ]] || missing+=("$region_name")
  [[ -n "${REPOSITORY:-}" ]] || missing+=("$repo_name")
  if (( ${#missing[@]} )); then
    fail "Publishing is enabled but the variable(s) ${missing[*]} are missing; nothing was published."
  fi
  [[ "$ROLE_ARN" =~ ^arn:aws(-[a-z]+)*:iam::[0-9]{12}:role/[A-Za-z0-9+=,.@_/-]{1,512}$ ]] || fail "$role_name is not an IAM role ARN."
  [[ "$REGION" =~ ^[a-z]{2}(-[a-z]+)+-[0-9]+$ ]] || fail "$region_name is not an AWS region name."
  [[ "${#REPOSITORY}" -le 256 && "$REPOSITORY" =~ ^[a-z0-9]+([._-][a-z0-9]+)*(/[a-z0-9]+([._-][a-z0-9]+)*)*$ ]] || fail "$repo_name is not a valid ECR repository name."
  out role_arn "$ROLE_ARN"
  out region "$REGION"
  out repository "$REPOSITORY"
  echo "release configuration present and well-formed for lane $lane"
}

# CP03: the deployment configuration. Same pattern as the release configuration: the three deploy names belong to the
# backend-production environment only (the plan job reports booleans for inherited values), nothing downstream reads `vars`
# again, and the gate runs before any OIDC/SSM call. Role, registry (from the image this run published) and the publish role
# must name one AWS account; the region comes from the already validated release configuration.
account_of_arn() { local a="${1#arn:}"; a="${a#*:}"; a="${a#*:}"; a="${a#*:}"; printf '%s' "${a%%:*}"; }
require_deploy_config() {
  local d_role=BACKEND_RELEASE_DEPLOY_AWS_ROLE_ARN d_inst=BACKEND_RELEASE_EC2_INSTANCE_ID d_cfg=BACKEND_RELEASE_HOST_CONFIG_PATH bad=() missing=()
  [[ "${INHERITED_DEPLOY_ROLE_ARN_SET:-}" == false ]] || bad+=("$d_role")
  [[ "${INHERITED_INSTANCE_ID_SET:-}" == false ]] || bad+=("$d_inst")
  [[ "${INHERITED_HOST_CONFIG_SET:-}" == false ]] || bad+=("$d_cfg")
  if (( ${#bad[@]} )); then
    fail "${bad[*]} must be defined only in the backend-production environment; a value at organization/repository scope (or unknown scope) is refused. Nothing was deployed."
  fi
  [[ -n "${DEPLOY_ROLE_ARN:-}" ]] || missing+=("$d_role")
  [[ -n "${INSTANCE_ID:-}" ]] || missing+=("$d_inst")
  [[ -n "${HOST_CONFIG_PATH:-}" ]] || missing+=("$d_cfg")
  [[ -n "${REGION:-}" ]] || missing+=(BACKEND_RELEASE_AWS_REGION)
  if (( ${#missing[@]} )); then fail "Deployment is enabled but the variable(s) ${missing[*]} are missing; nothing was deployed."; fi
  [[ "$DEPLOY_ROLE_ARN" =~ ^arn:aws(-[a-z]+)*:iam::[0-9]{12}:role/[A-Za-z0-9+=,.@_/-]{1,512}$ ]] || fail "$d_role is not an IAM role ARN."
  [[ "$INSTANCE_ID" =~ ^i-[0-9a-f]{17}$ ]] || fail "$d_inst is not an EC2 instance ID."
  [[ "$HOST_CONFIG_PATH" =~ ^/[A-Za-z0-9_./+-]{1,200}$ && "$HOST_CONFIG_PATH" != *..* && "$HOST_CONFIG_PATH" != *//* ]] || fail "$d_cfg is not a canonical absolute path."
  [[ "$REGION" =~ ^[a-z]{2}(-[a-z]+)+-[0-9]+$ ]] || fail "BACKEND_RELEASE_AWS_REGION is not an AWS region name."
  # The only thing that may be deployed is the image the publish job of THIS run produced for THIS commit.
  if [[ -n "${IMAGE_URI:-}" || -n "${IMAGE_DIGEST:-}" || -n "${PUBLISHED_SHA:-}" ]]; then
    [[ "${SOURCE_SHA:-}" =~ ^[0-9a-f]{40}$ && "${PUBLISHED_SHA:-}" == "$SOURCE_SHA" ]] || fail "The published source SHA is not the SHA of this run."
    [[ "${IMAGE_URI:-}" == *":$SOURCE_SHA" ]] || fail "The published image URI does not carry this run's full SHA tag."
    [[ "${IMAGE_DIGEST:-}" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "The published image digest is not a sha256 digest."
  fi
  local d_acct p_acct i_acct
  d_acct="$(account_of_arn "$DEPLOY_ROLE_ARN")"
  [[ -z "${PUBLISH_ROLE_ARN:-}" ]] || { p_acct="$(account_of_arn "$PUBLISH_ROLE_ARN")"; [[ "$d_acct" == "$p_acct" ]] || fail "The deploy role and the release (publish) role belong to different AWS accounts."; }
  if [[ -n "${IMAGE_URI:-}" ]]; then
    i_acct="${IMAGE_URI%%.dkr.ecr.*}"
    [[ "$IMAGE_URI" =~ ^[0-9]{12}\.dkr\.ecr\.${REGION}\.amazonaws\.com/ ]] || fail "The published image is not in an ECR registry of the configured region."
    [[ "$i_acct" == "$d_acct" ]] || fail "The deploy role and the registry of the published image belong to different AWS accounts."
  fi
  out deploy_role_arn "$DEPLOY_ROLE_ARN"
  out instance_id "$INSTANCE_ID"
  out host_config_path "$HOST_CONFIG_PATH"
  out deploy_region "$REGION"
  echo "deployment configuration present and well-formed"
}

# CP03: a run that is no longer the tip of main must not deploy (an older run re-run later would otherwise act as an
# implicit rollback). Race limit: main can still advance between this read and the remote swap; the host lock and
# the engine's exact-history/expected-current gates remain the control for that window.
check_main_head() {
  local url="${MAIN_REMOTE_URL:?MAIN_REMOTE_URL}" sha="${SOURCE_SHA:?SOURCE_SHA}" head line
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || fail "SOURCE_SHA is not a full lowercase 40-character commit SHA."
  line="$(timeout 60 git ls-remote "$url" refs/heads/main)" || fail "Could not read refs/heads/main; nothing was deployed (STALE_CHECK_FAILED)."
  head="${line%%[[:space:]]*}"
  [[ "$head" =~ ^[0-9a-f]{40}$ ]] || fail "refs/heads/main did not resolve (STALE_CHECK_FAILED)."
  [[ "$head" == "$sha" ]] || fail "This run's commit is not the current tip of main (STALE_RUN); a stale run never deploys. Nothing was sent."
  echo "this run's commit is the tip of main"
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
  require-deploy-config) require_deploy_config ;;
  check-main-head) check_main_head ;;
  check-image) check_image "${2:-}" ;;
  pack) pack "${2:-}" "${3:-}" ;;
  unpack) unpack "${2:-}" "${3:-}" ;;
  *) echo "usage: $0 plan | require-config <main|develop> | check-image <image> | pack <image> <dir> | unpack <dir> <image>" >&2; exit 2 ;;
esac
