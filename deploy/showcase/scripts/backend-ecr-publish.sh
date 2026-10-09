#!/usr/bin/env bash
# BHA-BACKEND-CD-001-CP01: push the already-built, already-checked image to ECR under the source SHA tag.
#
# Env: SOURCE_SHA REPOSITORY REGISTRY IMAGE (the local image to push) [IMAGE_ID GITHUB_OUTPUT GITHUB_STEP_SUMMARY
#      GITHUB_RUN_ID GITHUB_RUN_ATTEMPT SUMMARY_TITLE]. AWS credentials come from the caller (OIDC).
#
# Fail-closed rules:
#   - the repository must exist and be exactly IMMUTABLE (a describe error is an error, not "absent");
#   - the tag counts as absent only on exit 254 + "(ImageNotFoundException) ... DescribeImages";
#   - an existing tag is never overwritten, deleted, re-tagged or reused (no trusted provenance mechanism
#     exists yet, so reuse is not offered);
#   - a failed push (including an immutability rejection in a race) fails the run;
#   - the registry digest must be a sha256 and equal the digest `docker push` reported.
set -euo pipefail

fail() { echo "::error::$*"; exit 1; }
out() { if [[ -n "${GITHUB_OUTPUT:-}" ]]; then echo "$1=$2" >> "$GITHUB_OUTPUT"; fi; }

: "${SOURCE_SHA:?}" "${REPOSITORY:?}" "${REGISTRY:?}" "${IMAGE:?}"
[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "SOURCE_SHA is not a full lowercase 40-character commit SHA."
[[ "$REGISTRY" =~ ^[0-9]{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$ ]] || fail "Registry is not an ECR registry host."
[[ "$REPOSITORY" =~ ^[a-z0-9]+([._-][a-z0-9]+)*(/[a-z0-9]+([._-][a-z0-9]+)*)*$ ]] || fail "Not a valid ECR repository name."

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
first_line() { head -n1 "$work/err" | cut -c1-300; }

# 1. The repository exists, belongs to this registry and is immutable.
if ! repo_info="$(aws ecr describe-repositories --repository-names "$REPOSITORY" \
    --query 'repositories[0].[imageTagMutability,repositoryUri]' --output text 2>"$work/err")"; then
  fail "Cannot describe the ECR repository: $(first_line)"
fi
read -r mutability uri <<< "$repo_info"
[[ "$mutability" == "IMMUTABLE" ]] || fail "ECR repository tag mutability is '$mutability'; exactly IMMUTABLE is required."
[[ "$uri" == "$REGISTRY/$REPOSITORY" ]] || fail "Repository URI does not match the authenticated registry."

# 2. The SHA tag must be provably absent.
set +e
aws ecr describe-images --repository-name "$REPOSITORY" --image-ids "imageTag=$SOURCE_SHA" \
  --query 'imageDetails[0].imageDigest' --output text > /dev/null 2>"$work/err"
rc=$?
set -e
if [[ "$rc" -eq 0 ]]; then
  fail "Tag $SOURCE_SHA already exists in the repository; not overwriting, re-tagging or reusing it (fail closed)."
elif [[ "$rc" -ne 254 ]] || ! grep -qF '(ImageNotFoundException) when calling the DescribeImages operation' "$work/err"; then
  fail "Tag lookup failed with exit $rc, which is not 'image not found': $(first_line)"
fi

# 3. Push the image that was built and checked earlier in this run (no rebuild here).
target="$REGISTRY/$REPOSITORY:$SOURCE_SHA"
docker tag "$IMAGE" "$target"
if ! docker push "$target" > "$work/push" 2>&1; then
  cat "$work/push"
  fail "docker push failed (a duplicate/immutable rejection is a failure, never a success)."
fi
cat "$work/push"
pushed="$(sed -n 's/.*digest: \(sha256:[0-9a-f]\{64\}\).*/\1/p' "$work/push" | tail -n1)"
[[ "$pushed" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "docker push did not report a sha256 digest."

# 4. Read the digest back from the registry by repository + full-SHA tag.
if ! digest="$(aws ecr describe-images --repository-name "$REPOSITORY" --image-ids "imageTag=$SOURCE_SHA" \
    --query 'imageDetails[0].imageDigest' --output text 2>"$work/err")"; then
  fail "Cannot read the digest back after the push: $(first_line)"
fi
[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "Registry returned an invalid image digest."
[[ "$digest" == "$pushed" ]] || fail "Registry digest differs from the digest reported by docker push."

out source_sha "$SOURCE_SHA"
out ecr_repository "$REPOSITORY"
out image_uri "$target"
out image_digest "$digest"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "### ${SUMMARY_TITLE:-Published} (not deployed)"
    echo "- source SHA: \`$SOURCE_SHA\`"
    echo "- image URI (tag): \`$target\`"
    echo "- image URI (digest): \`$REGISTRY/$REPOSITORY@$digest\`"
    echo "- registry digest: \`$digest\`"
    [[ -z "${IMAGE_ID:-}" ]] || echo "- local Docker image ID (a different identity from the digest): \`$IMAGE_ID\`"
    echo "- run: \`${GITHUB_RUN_ID:-?}\` attempt \`${GITHUB_RUN_ATTEMPT:-?}\`"
    echo "No service was rolled out by this workflow."
  } >> "$GITHUB_STEP_SUMMARY"
fi
echo "published $target digest=$digest"
