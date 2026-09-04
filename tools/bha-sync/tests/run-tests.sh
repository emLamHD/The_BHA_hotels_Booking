#!/usr/bin/env bash
#
# Regression harness for tools/bha-sync/bha-sync.sh.
#
# Plain bash plus a stubbed `gh`: this repository's harnesses are dotnet test
# (Back_End) and vitest (Front_End), neither of which is a home for a
# governance shell script, and adding a third framework to cover one script
# would cost more than it verifies. Dependencies are exactly the ones bha-sync
# itself already requires — bash >= 4 and git.
#
# Every scenario runs against a real throwaway git repository, so checkpoint
# ancestry and the post-merge simulation exercise a real commit graph rather
# than a mock of one.
#
# The `gh` stub validates the argument shape production code actually sends and
# exits 99 if it is wrong, so a regression in the query itself surfaces as a
# failure here instead of being silently absorbed. Fixtures are field-per-line
# with an explicit @@NULL@@ sentinel, exactly what the production `--jq` emits,
# including the null merge fields that every Open/Draft/Closed PR carries.
#
# Usage:  tools/bha-sync/tests/run-tests.sh
# Exit:   0 = every scenario passed, 1 = otherwise.

set -uo pipefail
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BHA_SYNC="$SCRIPT_DIR/../bha-sync.sh"

readonly EXPECTED_JSON_FIELDS="state,isDraft,mergedAt,mergeCommit,baseRefName,url"

scenario_count=0
assert_pass=0
assert_fail=0
failed_scenarios=()
current_scenario=""

scenario() {
  current_scenario="$1"
  scenario_count=$((scenario_count + 1))
  printf '\n[%02d] %s\n' "$scenario_count" "$1"
}

ok()   { printf '  ok   — %s\n' "$1"; assert_pass=$((assert_pass + 1)); }
fail() {
  printf '  FAIL — %s\n' "$1"
  assert_fail=$((assert_fail + 1))
  failed_scenarios+=("$current_scenario: $1")
}

check_eq() {
  if [[ "$2" == "$3" ]]; then ok "$1 (= $2)"; else fail "$1: expected '$2', got '$3'"; fi
}
check_contains() {
  if [[ "$3" == *"$2"* ]]; then ok "$1"; else
    fail "$1: output lacked '$2'"
    printf '%s\n' "$3" | sed 's/^/         | /'
  fi
}
check_not_contains() {
  if [[ "$3" != *"$2"* ]]; then ok "$1"; else fail "$1: output unexpectedly contained '$2'"; fi
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# ---------------------------------------------------------------------------
# Throwaway repository with a real commit graph
# ---------------------------------------------------------------------------
REPO="$WORK/repo"
mkdir -p "$REPO"
git -C "$REPO" init --quiet
git -C "$REPO" config user.email "test@example.invalid"
git -C "$REPO" config user.name "bha-sync tests"
git -C "$REPO" checkout -q -b develop

printf 'base\n' > "$REPO/file.txt"
git -C "$REPO" add file.txt
git -C "$REPO" commit -q -m "A: recorded checkpoint"
SHA_A="$(git -C "$REPO" rev-parse HEAD)"

printf 'merged\n' > "$REPO/file.txt"
git -C "$REPO" commit -q -am "merge of PR 41"
SHA_MERGE41="$(git -C "$REPO" rev-parse HEAD)"

# bha-sync resolves the base ref as origin/<canonical base-branch>, so the
# throwaway repo needs a real remote-tracking ref, exactly as a fetched clone
# would have. sync_origin() is re-called whenever develop moves.
sync_origin() { git -C "$REPO" update-ref refs/remotes/origin/develop "$(git -C "$REPO" rev-parse develop)"; }
sync_origin

# A real commit that is deliberately NOT on develop.
git -C "$REPO" checkout -q -b sidetrack "$SHA_A"
printf 'side\n' > "$REPO/file.txt"
git -C "$REPO" commit -q -am "side"
SHA_SIDE="$(git -C "$REPO" rev-parse HEAD)"
git -C "$REPO" checkout -q develop

# ---------------------------------------------------------------------------
# gh stub
# ---------------------------------------------------------------------------
STUB_BIN="$WORK/bin"
mkdir -p "$STUB_BIN"
cat > "$STUB_BIN/gh" <<'STUB_EOF'
#!/usr/bin/env bash
# Stubbed GitHub CLI. Asserts the production argument shape, then replays a
# fixture. Exits 99 on an unexpected invocation so a query regression fails
# loudly rather than being absorbed as a generic lookup failure.
set -uo pipefail
printf '%s\n' "$*" >> "${GH_CALL_LOG:-/dev/null}"

die() { printf 'gh stub: %s\n' "$1" >&2; exit 99; }

case "${1:-}" in
  auth)
    [[ "${2:-}" == "status" ]] || die "unexpected auth subcommand: ${2:-}"
    [[ "${BHA_TEST_GH_MODE:-ok}" == "auth-fail" ]] && exit 1
    exit 0 ;;
  pr)
    [[ "${2:-}" == "view" ]] || die "unexpected pr subcommand: ${2:-}"
    pr_number="${3:-}"
    [[ "$pr_number" =~ ^[0-9]+$ ]] || die "PR number not passed positionally: ${3:-}"
    shift 3
    repo=""; json_fields=""; saw_jq=0
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --repo) [[ $# -ge 2 ]] || die "--repo without value"; repo="$2"; shift 2 ;;
        --json) [[ $# -ge 2 ]] || die "--json without value"; json_fields="$2"; shift 2 ;;
        --jq)   [[ $# -ge 2 ]] || die "--jq without value"; saw_jq=1; shift 2 ;;
        *) die "unexpected flag: $1" ;;
      esac
    done
    [[ -n "$repo" ]] || die "missing --repo"
    [[ $saw_jq -eq 1 ]] || die "missing --jq"
    [[ "$json_fields" == "${BHA_TEST_EXPECTED_JSON:?}" ]] || die "unexpected --json list: $json_fields"
    [[ "${BHA_TEST_GH_MODE:-ok}" == "api-fail" ]] && exit 1
    fixture="${BHA_TEST_FIXTURES:?}/pr-$pr_number.txt"
    [[ -f "$fixture" ]] || exit 1      # absent PR: gh exits nonzero
    cat "$fixture"
    exit 0 ;;
esac
die "unexpected gh invocation: $*"
STUB_EOF
chmod +x "$STUB_BIN/gh"

FIXTURES="$WORK/fixtures"
GH_LOG="$WORK/gh-calls.log"

reset_fixtures() { rm -rf "$FIXTURES"; mkdir -p "$FIXTURES"; : > "$GH_LOG"; }

# fixture <pr> <state> <isDraft> <mergedAt> <mergeCommit> <base> [url]
fixture() {
  local pr="$1" url="${7:-https://github.com/owner/repo/pull/$1}"
  printf '%s\n%s\n%s\n%s\n%s\n%s\n' "$2" "$3" "$4" "$5" "$6" "$url" > "$FIXTURES/pr-$pr.txt"
}
readonly N='@@NULL@@'

# ---------------------------------------------------------------------------
# Snapshot fixtures
# ---------------------------------------------------------------------------
SNAP="$REPO/snapshot.md"

# write_snapshot <checkpoint> <pr-rows...>   (one "num|base|lifecycle|sha|at" each)
write_snapshot() {
  local checkpoint="$1"; shift
  local row num base life sha at
  {
    printf '# Fixture snapshot\n\n## 1. Repository state\n\n### 1.1 Canonical record\n\n'
    printf '<!-- BHA-SYNC:BEGIN -->\n\n'
    printf '| Canonical field | Giá trị |\n|---|---|\n'
    printf '| repository | `owner/repo` |\n'
    printf '| base-branch | `develop` |\n'
    [[ "$checkpoint" == "OMIT" ]] || printf '| develop-checkpoint | `%s` |\n' "$checkpoint"
    printf '\n| PR | Base | Lifecycle | Merge commit | Merged at |\n|---|---|---|---|---|\n'
    for row in "$@"; do
      IFS='|' read -r num base life sha at <<<"$row"
      printf '| %s | `%s` | `%s` | `%s` | `%s` |\n' "$num" "$base" "$life" "$sha" "$at"
    done
    printf '\n<!-- BHA-SYNC:END -->\n'
  } > "$SNAP"
}

append_historical() { printf '\n%s\n' "$1" >> "$SNAP"; }

run_sync() {
  ( cd "$REPO" \
    && BHA_TEST_FIXTURES="$FIXTURES" GH_CALL_LOG="$GH_LOG" \
       BHA_TEST_EXPECTED_JSON="$EXPECTED_JSON_FIELDS" \
       PATH="$STUB_BIN:$PATH" "$BHA_SYNC" --snapshot "$SNAP" "$@" 2>&1 )
}

# Full worktree fingerprint: tracked status plus every file's content hash.
worktree_state() {
  ( cd "$REPO" && git status --porcelain --untracked-files=all
    find "$REPO" -path "$REPO/.git" -prune -o -type f -print0 \
      | sort -z | xargs -0 cksum 2>/dev/null )
}

MERGED_ROW_41="41|develop|MERGED|$SHA_MERGE41|2026-09-03T03:11:21Z"

# ===========================================================================

scenario "Merged PR is synchronized"
reset_fixtures
export BHA_TEST_GH_MODE=ok
fixture 41 MERGED false 2026-09-03T03:11:21Z "$SHA_MERGE41" develop
write_snapshot "$SHA_A" "$MERGED_ROW_41"
out="$(run_sync)"; code=$?
check_eq "exit SYNCHRONIZED(0)" 0 "$code"
check_contains "reports merged lifecycle" "snapshot=MERGED github=MERGED" "$out"
check_contains "stub saw the exact --json list" "--json $EXPECTED_JSON_FIELDS" "$(cat "$GH_LOG")"

scenario "Draft PR is synchronized (null merge fields preserved)"
reset_fixtures
fixture 50 OPEN true "$N" "$N" develop
write_snapshot "$SHA_A" "50|develop|DRAFT|—|—"
out="$(run_sync)"; code=$?
check_eq "exit SYNCHRONIZED(0)" 0 "$code"
check_contains "classified as DRAFT" "snapshot=DRAFT github=DRAFT" "$out"
check_not_contains "never misread as merged" "github=MERGED" "$out"

scenario "Open non-draft PR is synchronized"
reset_fixtures
fixture 51 OPEN false "$N" "$N" develop
write_snapshot "$SHA_A" "51|develop|OPEN|—|—"
out="$(run_sync)"; code=$?
check_eq "exit SYNCHRONIZED(0)" 0 "$code"
check_contains "classified as OPEN" "snapshot=OPEN github=OPEN" "$out"
check_not_contains "never misread as merged" "github=MERGED" "$out"

scenario "Closed-unmerged PR is synchronized"
reset_fixtures
fixture 52 CLOSED false "$N" "$N" develop
write_snapshot "$SHA_A" "52|develop|CLOSED|—|—"
out="$(run_sync)"; code=$?
check_eq "exit SYNCHRONIZED(0)" 0 "$code"
check_contains "classified as CLOSED" "snapshot=CLOSED github=CLOSED" "$out"
check_not_contains "never misread as merged" "github=MERGED" "$out"

scenario "Snapshot says Draft while GitHub says Merged → drift"
reset_fixtures
fixture 41 MERGED false 2026-09-03T03:11:21Z "$SHA_MERGE41" develop
write_snapshot "$SHA_A" "41|develop|DRAFT|—|—"
out="$(run_sync)"; code=$?
check_eq "exit DRIFT_DETECTED(3)" 3 "$code"
check_contains "names the lifecycle field" "PR #41: lifecycle" "$out"
check_contains "shows the snapshot value" "snapshot: DRAFT" "$out"
check_contains "shows the live value" "github:   MERGED" "$out"
check_not_contains "never reports synchronized" "bha-sync: SYNCHRONIZED" "$out"

scenario "GitHub base branch mismatch → drift even when merge fields match"
reset_fixtures
fixture 41 MERGED false 2026-09-03T03:11:21Z "$SHA_MERGE41" main
write_snapshot "$SHA_A" "$MERGED_ROW_41"
out="$(run_sync)"; code=$?
check_eq "exit DRIFT_DETECTED(3)" 3 "$code"
check_contains "names baseRefName" "PR #41: baseRefName" "$out"
check_contains "shows the live base" "github:   main" "$out"
check_not_contains "never reports synchronized" "bha-sync: SYNCHRONIZED" "$out"

scenario "Absent PR / gh nonzero → unverified"
reset_fixtures
write_snapshot "$SHA_A" "$MERGED_ROW_41"   # no fixture written
out="$(run_sync)"; code=$?
check_eq "exit SYNC_UNVERIFIED(4)" 4 "$code"
check_contains "says the lookup failed" "GitHub lookup failed" "$out"
check_not_contains "never reports synchronized" "bha-sync: SYNCHRONIZED" "$out"

scenario "Missing field in the GitHub response → unverified"
reset_fixtures
printf 'MERGED\nfalse\n2026-09-03T03:11:21Z\n%s\ndevelop\n' "$SHA_MERGE41" > "$FIXTURES/pr-41.txt"
write_snapshot "$SHA_A" "$MERGED_ROW_41"
out="$(run_sync)"; code=$?
check_eq "exit SYNC_UNVERIFIED(4)" 4 "$code"
check_contains "reports the field count" "expected 6 fields" "$out"

scenario "Malformed isDraft → unverified"
reset_fixtures
fixture 51 OPEN "maybe" "$N" "$N" develop
write_snapshot "$SHA_A" "51|develop|OPEN|—|—"
out="$(run_sync)"; code=$?
check_eq "exit SYNC_UNVERIFIED(4)" 4 "$code"
check_contains "names isDraft" "isDraft is not a boolean" "$out"

scenario "Contradictory lifecycle data → unverified, never guessed"
reset_fixtures
fixture 60 OPEN false "$N" "$SHA_MERGE41" develop          # open, yet merged
fixture 61 MERGED false "$N" "$SHA_MERGE41" develop        # merged, no mergedAt
fixture 62 MERGED false 2026-09-03T03:11:21Z "$N" develop  # merged, no commit
fixture 63 SUPERPOSED false "$N" "$N" develop              # unknown enum
for pr in 60 61 62 63; do
  write_snapshot "$SHA_A" "$pr|develop|OPEN|—|—"
  out="$(run_sync)"; code=$?
  check_eq "PR #$pr exits SYNC_UNVERIFIED(4)" 4 "$code"
  check_not_contains "PR #$pr never reports synchronized" "bha-sync: SYNCHRONIZED" "$out"
done

scenario "Duplicate canonical PR row → unverified"
reset_fixtures
fixture 41 MERGED false 2026-09-03T03:11:21Z "$SHA_MERGE41" develop
write_snapshot "$SHA_A" "$MERGED_ROW_41" "41|develop|DRAFT|—|—"
out="$(run_sync)"; code=$?
check_eq "exit SYNC_UNVERIFIED(4)" 4 "$code"
check_contains "names the duplicate" "lists PR #41 more than once" "$out"

scenario "Missing canonical checkpoint row → unverified"
reset_fixtures
fixture 41 MERGED false 2026-09-03T03:11:21Z "$SHA_MERGE41" develop
write_snapshot OMIT "$MERGED_ROW_41"
out="$(run_sync)"; code=$?
check_eq "exit SYNC_UNVERIFIED(4)" 4 "$code"
check_contains "names the missing record" "exactly one repository, base-branch and develop-checkpoint" "$out"

scenario "Historical row outside the canonical block cannot satisfy canonical state"
reset_fixtures
fixture 41 MERGED false 2026-09-03T03:11:21Z "$SHA_MERGE41" develop
write_snapshot "$SHA_A" "41|develop|DRAFT|—|—"
append_historical "## 9. History

| PR #41 | merged — merge commit \`$SHA_MERGE41\`, merged \`2026-09-03T03:11:21Z\`. |"
out="$(run_sync)"; code=$?
check_eq "history cannot rescue a stale canonical row" 3 "$code"
check_contains "still reports the canonical drift" "PR #41: lifecycle" "$out"
check_not_contains "never reports synchronized" "bha-sync: SYNCHRONIZED" "$out"

scenario "Multiple independently tracked PRs"
reset_fixtures
fixture 41 MERGED false 2026-09-03T03:11:21Z "$SHA_MERGE41" develop
fixture 50 OPEN true "$N" "$N" develop
fixture 52 CLOSED false "$N" "$N" develop
write_snapshot "$SHA_A" "$MERGED_ROW_41" "50|develop|DRAFT|—|—" "52|develop|CLOSED|—|—"
out="$(run_sync)"; code=$?
check_eq "exit SYNCHRONIZED(0)" 0 "$code"
check_contains "counts every PR plus the checkpoint" "4 subject(s) checked" "$out"
fixture 50 OPEN false "$N" "$N" develop     # one of the three drifts
out="$(run_sync)"; code=$?
check_eq "one drifted PR fails the whole run" 3 "$code"
check_contains "isolates the drifted PR" "PR #50: lifecycle" "$out"
check_not_contains "does not implicate a correct PR" "PR #41: lifecycle" "$out"

scenario "Unfetchable base ref → unverified"
reset_fixtures
fixture 41 MERGED false 2026-09-03T03:11:21Z "$SHA_MERGE41" develop
write_snapshot "$SHA_A" "$MERGED_ROW_41"
out="$(run_sync --base-ref origin/does-not-exist)"; code=$?
check_eq "exit SYNC_UNVERIFIED(4)" 4 "$code"
check_contains "tells the operator to fetch" "cannot resolve origin/does-not-exist" "$out"

scenario "Checkpoint not an ancestor of live head → drift"
reset_fixtures
fixture 41 MERGED false 2026-09-03T03:11:21Z "$SHA_MERGE41" develop
write_snapshot "$SHA_SIDE" "$MERGED_ROW_41"
out="$(run_sync)"; code=$?
check_eq "exit DRIFT_DETECTED(3)" 3 "$code"
check_contains "names the checkpoint" "develop checkpoint: ancestor of" "$out"

scenario "Live head strictly ahead of the checkpoint is still synchronized"
reset_fixtures
fixture 41 MERGED false 2026-09-03T03:11:21Z "$SHA_MERGE41" develop
write_snapshot "$SHA_A" "$MERGED_ROW_41"   # develop is at SHA_MERGE41, ahead of A
out="$(run_sync)"; code=$?
check_eq "a descendant live head is not drift" 0 "$code"
check_contains "states the ancestor relationship" "is an ancestor of" "$out"

scenario "Post-merge correction simulation — no follow-up PR required"
# Commit A is the recorded checkpoint. A correction branched from A is merged,
# producing live commit B. The merged content still records A. That must be
# SYNCHRONIZED, otherwise every reconciliation would demand another one.
reset_fixtures
git -C "$REPO" checkout -q -b correction "$SHA_A"
printf 'correction\n' > "$REPO/correction.txt"
git -C "$REPO" add correction.txt
git -C "$REPO" commit -q -m "correction prepared from A"
git -C "$REPO" checkout -q develop
git -C "$REPO" merge -q --no-ff -m "merge correction" correction
SHA_B="$(git -C "$REPO" rev-parse HEAD)"
sync_origin
fixture 41 MERGED false 2026-09-03T03:11:21Z "$SHA_MERGE41" develop
write_snapshot "$SHA_A" "$MERGED_ROW_41"   # merged content still records A
out="$(run_sync)"; code=$?
check_eq "A is still an ancestor of B" 0 "$(git -C "$REPO" merge-base --is-ancestor "$SHA_A" "$SHA_B"; echo $?)"
check_eq "live head advanced past the checkpoint" "different" \
  "$([[ "$SHA_A" != "$SHA_B" ]] && echo different || echo same)"
check_eq "exit SYNCHRONIZED(0)" 0 "$code"
check_not_contains "no drift is reported" "DRIFT_DETECTED" "$out"
git -C "$REPO" reset -q --hard "$SHA_MERGE41"
git -C "$REPO" branch -q -D correction
sync_origin

scenario "Missing gh binary → unverified"
reset_fixtures
fixture 41 MERGED false 2026-09-03T03:11:21Z "$SHA_MERGE41" develop
write_snapshot "$SHA_A" "$MERGED_ROW_41"
NOGH_BIN="$WORK/nogh"; mkdir -p "$NOGH_BIN"
for tool in bash git; do
  tool_path="$(command -v "$tool")" && ln -sf "$tool_path" "$NOGH_BIN/$tool"
done
check_not_contains "gh really is absent from that PATH" "gh" "$(ls "$NOGH_BIN")"
out="$( cd "$REPO" && PATH="$NOGH_BIN" "$BHA_SYNC" --snapshot "$SNAP" 2>&1 )"; code=$?
check_eq "exit SYNC_UNVERIFIED(4)" 4 "$code"
check_contains "names the dependency" "required dependency not installed: gh" "$out"

scenario "Authentication failure → unverified"
export BHA_TEST_GH_MODE=auth-fail
out="$(run_sync)"; code=$?
check_eq "exit SYNC_UNVERIFIED(4)" 4 "$code"
check_contains "names the auth failure" "not authenticated" "$out"

scenario "API/network failure → unverified"
export BHA_TEST_GH_MODE=api-fail
out="$(run_sync)"; code=$?
check_eq "exit SYNC_UNVERIFIED(4)" 4 "$code"
check_contains "says the lookup failed" "GitHub lookup failed" "$out"
check_not_contains "infers nothing" "bha-sync: SYNCHRONIZED" "$out"
export BHA_TEST_GH_MODE=ok

scenario "Usage errors exit 2 with an actionable message"
out="$( cd "$REPO" && PATH="$STUB_BIN:$PATH" "$BHA_SYNC" --snapshot 2>&1 )"; code=$?
check_eq "missing option value exits USAGE_ERROR(2)" 2 "$code"
check_contains "says which option" "option --snapshot requires a value" "$out"
out="$( cd "$REPO" && PATH="$STUB_BIN:$PATH" "$BHA_SYNC" --nope 2>&1 )"; code=$?
check_eq "unknown argument exits USAGE_ERROR(2)" 2 "$code"
check_contains "names the argument" "unknown argument: --nope" "$out"
out="$( cd "$REPO" && PATH="$STUB_BIN:$PATH" "$BHA_SYNC" --base-ref 2>&1 )"; code=$?
check_eq "trailing --base-ref exits USAGE_ERROR(2)" 2 "$code"
out="$( cd "$REPO" && PATH="$STUB_BIN:$PATH" "$BHA_SYNC" --help 2>&1 )"; code=$?
check_eq "--help exits 0" 0 "$code"
check_contains "help documents the exit codes" "3 DRIFT_DETECTED" "$out"

scenario "Second run is byte-identical (idempotent)"
reset_fixtures
fixture 41 MERGED false 2026-09-03T03:11:21Z "$SHA_MERGE41" develop
write_snapshot "$SHA_A" "$MERGED_ROW_41"
first="$(run_sync)"; first_code=$?
second="$(run_sync)"; second_code=$?
check_eq "same exit code" "$first_code" "$second_code"
check_eq "byte-identical output" "$first" "$second"

scenario "No worktree side effects and no remote mutation"
before="$(worktree_state)"
: > "$GH_LOG"
out="$(run_sync)"; code=$?
after="$(worktree_state)"
check_eq "exit unchanged" 0 "$code"
check_eq "tracked and untracked worktree state is identical" "$before" "$after"
gh_calls="$(cat "$GH_LOG")"
check_not_contains "never merges" "pr merge" "$gh_calls"
check_not_contains "never marks ready" "pr ready" "$gh_calls"
check_not_contains "never uses a write method" "--method" "$gh_calls"
check_not_contains "never uses -X" " -X " "$gh_calls"
check_not_contains "never edits" "pr edit" "$gh_calls"
check_contains "only reads PR state" "pr view" "$gh_calls"

printf '\n----------------------------------------\n'
printf 'scenarios: %d   assertions: %d passed, %d failed\n' \
  "$scenario_count" "$assert_pass" "$assert_fail"
if [[ $assert_fail -gt 0 ]]; then
  printf '\nFailed assertions:\n'
  for f in "${failed_scenarios[@]}"; do printf '  - %s\n' "$f"; done
fi
[[ $assert_fail -eq 0 ]]
