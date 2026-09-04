#!/usr/bin/env bash
#
# Regression harness for tools/bha-sync/bha-sync.sh.
#
# Deliberately plain bash + a stubbed `gh` on PATH: this project's existing
# harnesses are dotnet test (Back_End) and vitest (Front_End), neither of
# which is an appropriate or available home for a governance shell script.
# Adding a third framework to cover one script would cost more than it
# verifies, so this stays a self-contained script with no dependencies
# beyond git and bash — the two things bha-sync itself already requires.
#
# Each scenario runs against a real throwaway git repository, so the merge
# commit containment check exercises real git rather than a mock.
#
# Stub scope: the stub emits the post-`--jq` TSV that `gh pr view` would
# produce, not raw JSON, which keeps the harness free of a jq dependency.
# What is under test is bha-sync's claim parsing, lifecycle mapping,
# comparison and fail-closed behavior — not gh's own JSON serialization.
#
# Usage: tools/bha-sync/tests/run-tests.sh
# Exit code: 0 all scenarios passed, 1 otherwise.

set -uo pipefail
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BHA_SYNC="$SCRIPT_DIR/../bha-sync.sh"

pass_count=0
fail_count=0

ok()   { printf '  ok   — %s\n' "$1"; pass_count=$((pass_count + 1)); }
fail() { printf '  FAIL — %s\n' "$1"; fail_count=$((fail_count + 1)); }

check_eq() {
  local what="$1" expected="$2" actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    ok "$what (= $expected)"
  else
    fail "$what: expected '$expected', got '$actual'"
  fi
}

check_contains() {
  local what="$1" needle="$2" haystack="$3"
  if [[ "$haystack" == *"$needle"* ]]; then
    ok "$what"
  else
    fail "$what: output did not contain '$needle'"
    printf '%s\n' "$haystack" | sed 's/^/         | /'
  fi
}

check_not_contains() {
  local what="$1" needle="$2" haystack="$3"
  if [[ "$haystack" != *"$needle"* ]]; then
    ok "$what"
  else
    fail "$what: output unexpectedly contained '$needle'"
  fi
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# --- throwaway repository -------------------------------------------------
REPO="$WORK/repo"
mkdir -p "$REPO"
git -C "$REPO" init --quiet
git -C "$REPO" config user.email "test@example.invalid"
git -C "$REPO" config user.name "bha-sync tests"
git -C "$REPO" checkout -q -b develop

printf 'base\n' > "$REPO/file.txt"
git -C "$REPO" add file.txt
git -C "$REPO" commit -q -m "base"
BASE_SHA="$(git -C "$REPO" rev-parse HEAD)"

printf 'merged\n' > "$REPO/file.txt"
git -C "$REPO" commit -q -am "feat: something (#41)"
MERGE_SHA="$(git -C "$REPO" rev-parse HEAD)"

# A commit that exists but is deliberately NOT on develop.
git -C "$REPO" checkout -q -b sidetrack "$BASE_SHA"
printf 'side\n' > "$REPO/file.txt"
git -C "$REPO" commit -q -am "side"
SIDE_SHA="$(git -C "$REPO" rev-parse HEAD)"
git -C "$REPO" checkout -q develop

# --- stub gh --------------------------------------------------------------
STUB_BIN="$WORK/bin"
mkdir -p "$STUB_BIN"
cat > "$STUB_BIN/gh" <<'STUB_EOF'
#!/usr/bin/env bash
# Stubbed GitHub CLI. Behavior is selected by BHA_TEST_GH_MODE.
set -uo pipefail
case "${1:-}" in
  auth)
    [[ "${BHA_TEST_GH_MODE:-}" == "auth-fail" ]] && exit 1
    exit 0 ;;
  repo) printf 'owner/repo\n'; exit 0 ;;
  pr)
    [[ "${BHA_TEST_GH_MODE:-}" == "api-fail" ]] && exit 1
    # Emit the post---jq TSV: state, isDraft, mergedAt, mergeCommit, base, url
    printf '%s\t%s\t%s\t%s\t%s\t%s\n' \
      "MERGED" "false" "2026-09-03T03:11:21Z" \
      "${BHA_TEST_MERGE_SHA:-}" "develop" "https://example.invalid/pull/41"
    exit 0 ;;
esac
exit 0
STUB_EOF
chmod +x "$STUB_BIN/gh"

# --- fixture ---------------------------------------------------------------
# Mirrors the real §1 table shape: the PR rows and the `develop` HEAD row are
# the only things bha-sync reads claims from.
write_snapshot() {
  local dest="$1" pr41_row="$2" head_sha="$3"
  cat > "$dest" <<FIXTURE_EOF
# THE BHA — SNAPSHOT (fixture)

## 1. Repository state

| Thuộc tính | Giá trị |
|---|---|
| Repository | \`owner/repo\` |
| Base branch | \`develop\` |
| \`develop\` HEAD | \`$head_sha\` |
$pr41_row
| Open execution PR khác | không có. |
FIXTURE_EOF
}

STALE_ROW="| PR #41 (work item hiện tại) | **Draft, OPEN**, base \`develop\` — baseline \`$BASE_SHA\`. **Chưa merge, chưa đóng.** |"
FIXED_ROW="| PR #41 | merged — \`feat: something\`, merge commit \`$MERGE_SHA\`, merged \`2026-09-03T03:11:21Z\`. |"
WRONG_SHA_ROW="| PR #41 | merged — \`feat: something\`, merge commit \`$BASE_SHA\`, merged \`2026-09-03T03:11:21Z\`. |"
NOT_CONTAINED_ROW="| PR #41 | merged — \`feat: something\`, merge commit \`$SIDE_SHA\`, merged \`2026-09-03T03:11:21Z\`. |"

run_sync() {
  local snapshot="$1"
  ( cd "$REPO" \
    && PATH="$STUB_BIN:$PATH" "$BHA_SYNC" \
         --snapshot "$snapshot" --repo owner/repo --base-ref develop 2>&1 )
}

SNAP="$REPO/snapshot.md"

# --- 1. drift: snapshot says Draft/OPEN, GitHub says Merged ---------------
printf '\n[1] Open/Draft snapshot vs merged PR is reported as drift\n'
export BHA_TEST_GH_MODE="ok" BHA_TEST_MERGE_SHA="$MERGE_SHA"
write_snapshot "$SNAP" "$STALE_ROW" "$BASE_SHA"
out="$(run_sync "$SNAP")"; code=$?
check_eq "exit code is DRIFT_DETECTED(3)" "3" "$code"
check_contains "reports the drifted lifecycle field" "PR #41: lifecycle" "$out"
check_contains "names the snapshot's stale value" "snapshot: DRAFT" "$out"
check_contains "names the live value" "github:   MERGED" "$out"
check_contains "also catches the stale develop HEAD" "develop HEAD: sha" "$out"
check_contains "refuses the baseline" "Baseline is NOT synchronized" "$out"

# --- 2. corrected snapshot reconciles ------------------------------------
printf '\n[2] Corrected snapshot is accepted\n'
write_snapshot "$SNAP" "$FIXED_ROW" "$MERGE_SHA"
out="$(run_sync "$SNAP")"; code=$?
check_eq "exit code is SYNCHRONIZED(0)" "0" "$code"
check_contains "confirms merged lifecycle" "snapshot=MERGED github=MERGED" "$out"
check_contains "clears the baseline for planning" "Baseline may be used for planning" "$out"

# --- 3. idempotency -------------------------------------------------------
printf '\n[3] A second run changes nothing\n'
before="$(cksum < "$SNAP")"
out2="$(run_sync "$SNAP")"; code2=$?
after="$(cksum < "$SNAP")"
check_eq "second run has the same exit code" "0" "$code2"
check_eq "second run has byte-identical output" "$out" "$out2"
check_eq "snapshot file is untouched" "$before" "$after"

# --- 4. GitHub lookup failure fails closed -------------------------------
printf '\n[4] GitHub lookup failure fails closed and infers nothing\n'
write_snapshot "$SNAP" "$STALE_ROW" "$BASE_SHA"
before="$(cksum < "$SNAP")"
export BHA_TEST_GH_MODE="api-fail"
out="$(run_sync "$SNAP")"; code=$?
after="$(cksum < "$SNAP")"
check_eq "exit code is SYNC_UNVERIFIED(4)" "4" "$code"
check_contains "says it could not verify" "GitHub lookup failed" "$out"
check_not_contains "does not claim the PR is merged" "github:   MERGED" "$out"
check_not_contains "does not report SYNCHRONIZED" "bha-sync: SYNCHRONIZED" "$out"
check_eq "snapshot file is untouched" "$before" "$after"

printf '\n[4b] Unauthenticated gh fails closed\n'
export BHA_TEST_GH_MODE="auth-fail"
out="$(run_sync "$SNAP")"; code=$?
check_eq "exit code is SYNC_UNVERIFIED(4)" "4" "$code"
check_contains "names the auth failure" "not authenticated" "$out"

printf '\n[4c] Missing gh binary fails closed\n'
# A PATH that still has everything bha-sync legitimately needs, but no gh —
# emptying PATH entirely would only prove that bash itself went missing.
NOGH_BIN="$WORK/nogh"
mkdir -p "$NOGH_BIN"
for tool in bash git grep sort tr sed cat; do
  tool_path="$(command -v "$tool")" && ln -sf "$tool_path" "$NOGH_BIN/$tool"
done
out="$( cd "$REPO" && PATH="$NOGH_BIN" "$BHA_SYNC" \
        --snapshot "$SNAP" --repo owner/repo --base-ref develop 2>&1 )"
code=$?
check_not_contains "gh really is absent from that PATH" "gh" "$(ls "$NOGH_BIN")"
check_eq "exit code is SYNC_UNVERIFIED(4)" "4" "$code"
check_contains "names the missing dependency" "not installed" "$out"

# --- 5. merge-commit evidence is checked, not just lifecycle -------------
printf '\n[5] A merged claim carrying the wrong merge commit is drift\n'
export BHA_TEST_GH_MODE="ok" BHA_TEST_MERGE_SHA="$MERGE_SHA"
write_snapshot "$SNAP" "$WRONG_SHA_ROW" "$MERGE_SHA"
out="$(run_sync "$SNAP")"; code=$?
check_eq "exit code is DRIFT_DETECTED(3)" "3" "$code"
check_contains "reports the mergeCommit field" "PR #41: mergeCommit" "$out"

printf '\n[6] A merge commit not contained by the base ref is drift\n'
export BHA_TEST_MERGE_SHA="$SIDE_SHA"
write_snapshot "$SNAP" "$NOT_CONTAINED_ROW" "$MERGE_SHA"
out="$(run_sync "$SNAP")"; code=$?
check_eq "exit code is DRIFT_DETECTED(3)" "3" "$code"
check_contains "reports the containment failure" "not an ancestor" "$out"

# --- 7. JSON output stays machine-readable -------------------------------
printf '\n[7] --json emits a parseable result\n'
export BHA_TEST_MERGE_SHA="$MERGE_SHA"
write_snapshot "$SNAP" "$STALE_ROW" "$BASE_SHA"
out="$( cd "$REPO" && PATH="$STUB_BIN:$PATH" "$BHA_SYNC" \
        --snapshot "$SNAP" --repo owner/repo --base-ref develop --json 2>&1 )"
code=$?
check_eq "exit code is DRIFT_DETECTED(3)" "3" "$code"
check_contains "carries the status" '"status": "DRIFT_DETECTED"' "$out"
check_contains "carries the drifted field" '"field": "lifecycle"' "$out"
if command -v python3 >/dev/null 2>&1; then
  if printf '%s' "$out" | python3 -c 'import json,sys; json.load(sys.stdin)' 2>/dev/null; then
    ok "output is valid JSON"
  else
    fail "output is not valid JSON"
  fi
fi

printf '\n----------------------------------------\n'
printf 'passed: %d   failed: %d\n' "$pass_count" "$fail_count"
[[ $fail_count -eq 0 ]]
