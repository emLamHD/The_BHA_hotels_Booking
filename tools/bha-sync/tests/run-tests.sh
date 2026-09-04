#!/usr/bin/env bash
#
# Regression harness for tools/bha-sync/bha-sync.sh.
#
# Plain bash plus a stubbed `gh`: this repository's harnesses are dotnet test
# (Back_End) and vitest (Front_End), neither of which is a home for a
# governance shell script, and adding a third framework to cover one script
# would cost more than it verifies.
#
# SAFETY (C2 P0)
#   Every destructive path in this file is derived from a work root that is
#   allocated, canonicalized and validated before any child path exists. The
#   earlier version assigned `WORK="$(mktemp -d)"` unchecked; because the file
#   does not use `set -e`, a failing mktemp left WORK empty and silently
#   produced REPO=/repo, FIXTURES=/fixtures and STUB_BIN=/bin — the last of
#   which this harness then wrote a `gh` into. Allocation now aborts the
#   process on any failure, every destructive call re-checks that its target is
#   strictly beneath the validated root, and cleanup refuses to run unless the
#   marker this harness wrote is still there.
#
# Usage:  tools/bha-sync/tests/run-tests.sh
# Exit:   0 = every scenario passed, 1 = assertion failure, 3 = unsafe environment.

set -uo pipefail
export LC_ALL=C

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly SCRIPT_DIR
readonly BHA_SYNC="$SCRIPT_DIR/../bha-sync.sh"

PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/../../.." && pwd -P)" || PROJECT_ROOT=""
readonly PROJECT_ROOT

# The jq contract is restated here, independently of the production script, so
# the tests cannot be satisfied by whatever production happens to send.
readonly EXPECTED_JSON_FIELDS="state,isDraft,mergedAt,mergeCommit,baseRefName,url"
readonly EXPECTED_SENTINEL='@@NULL@@'

fatal() { printf 'bha-sync tests: FATAL: %s\n' "$1" >&2; exit 3; }

# ---------------------------------------------------------------------------
# P0 — work root allocation
#
# Deliberately not `WORK="$(allocate)"`: a command substitution runs in a
# subshell, so an `exit` inside it would kill only that subshell and leave the
# caller running with an empty WORK — the exact failure being fixed.
# ---------------------------------------------------------------------------
WORK=""
allocate_work_root() {
  local candidate resolved
  if ! candidate="$(mktemp -d 2>/dev/null)"; then
    fatal "mktemp -d failed; refusing to derive any path from an unset work root"
  fi
  [[ -n "$candidate" ]] || fatal "mktemp -d produced an empty path"
  [[ -d "$candidate" ]] || fatal "mktemp -d result is not a directory: $candidate"
  resolved="$(cd -- "$candidate" 2>/dev/null && pwd -P)" \
    || fatal "cannot canonicalize the work root: $candidate"
  [[ -n "$resolved" ]] || fatal "work root canonicalized to an empty path"
  [[ "$resolved" != "/" ]] || fatal "work root canonicalized to /"
  case "$resolved" in
    /bin|/boot|/dev|/etc|/home|/lib|/lib64|/opt|/proc|/root|/run|/sbin|/srv|/sys|/tmp|/usr|/var)
      fatal "work root is a system directory: $resolved" ;;
  esac
  [[ -n "$PROJECT_ROOT" ]] || fatal "cannot resolve the project root"
  [[ "$resolved" != "$PROJECT_ROOT" ]] || fatal "work root is the project repository"
  [[ "$PROJECT_ROOT" != "$resolved"/* ]] || fatal "work root contains the project repository"
  WORK="$resolved"
}
allocate_work_root
readonly WORK
: > "$WORK/.bha-sync-test-root" || fatal "cannot mark the work root"

# Cleanup is the only place the work root itself is a legal target, and it
# refuses unless the marker written above is still present.
cleanup() {
  [[ -n "${WORK:-}" ]]                 || return 0
  [[ "$WORK" != "/" ]]                 || return 0
  [[ -d "$WORK" ]]                     || return 0
  if [[ ! -f "$WORK/.bha-sync-test-root" ]]; then
    printf 'bha-sync tests: refusing to clean %s (marker absent)\n' "$WORK" >&2
    return 0
  fi
  rm -rf -- "$WORK"
}
trap cleanup EXIT

# Generic guard: a destructive target must be a strict descendant of the root.
# Equality with the root is never accepted here — only cleanup may do that.
assert_child_target() {
  local target="$1" label="${2:-target}"
  [[ -n "${WORK:-}" && -d "$WORK" && -f "$WORK/.bha-sync-test-root" ]] \
    || fatal "work root invariant broken before touching $label"
  [[ -n "$target" ]]            || fatal "$label is empty"
  [[ "$target" == "$WORK"/?* ]] || fatal "$label ($target) is not strictly beneath $WORK"
  [[ "$target" != *..* ]]       || fatal "$label ($target) contains '..'"
}
safe_rm_rf() { assert_child_target "$1" "rm -rf target"; rm -rf -- "$1"; }
safe_mkdir() { assert_child_target "$1" "mkdir target"; mkdir -p -- "$1"; }
safe_target() { assert_child_target "$1" "write target"; }

readonly REPO="$WORK/repo"
readonly POSTMERGE="$WORK/postmerge"
readonly FIXTURES="$WORK/fixtures"
readonly STUB_BIN="$WORK/bin"
readonly NOGH_BIN="$WORK/nogh"
readonly GH_LOG="$WORK/gh-calls.log"
readonly SNAP="$REPO/snapshot.md"

# ---------------------------------------------------------------------------
# Assertions
# ---------------------------------------------------------------------------
scenario_count=0; assert_pass=0; assert_fail=0
failed_list=(); current_scenario=""

scenario() { current_scenario="$1"; scenario_count=$((scenario_count + 1)); printf '\n[%02d] %s\n' "$scenario_count" "$1"; }
ok()   { printf '  ok   — %s\n' "$1"; assert_pass=$((assert_pass + 1)); }
fail() { printf '  FAIL — %s\n' "$1"; assert_fail=$((assert_fail + 1)); failed_list+=("$current_scenario: $1"); }
check_eq() { if [[ "$2" == "$3" ]]; then ok "$1 (= $2)"; else fail "$1: expected '$2', got '$3'"; fi; }
check_contains() {
  if [[ "$3" == *"$2"* ]]; then ok "$1"; else
    fail "$1: output lacked '$2'"; printf '%s\n' "$3" | sed 's/^/         | /'
  fi
}
check_not_contains() { if [[ "$3" != *"$2"* ]]; then ok "$1"; else fail "$1: output unexpectedly contained '$2'"; fi; }

# ---------------------------------------------------------------------------
# Throwaway repository with a real commit graph
# ---------------------------------------------------------------------------
safe_mkdir "$REPO"
git -C "$REPO" init --quiet
git -C "$REPO" config user.email "test@example.invalid"
git -C "$REPO" config user.name "bha-sync tests"
git -C "$REPO" checkout -q -b develop

safe_target "$REPO/file.txt"; printf 'base\n' > "$REPO/file.txt"
git -C "$REPO" add file.txt
git -C "$REPO" commit -q -m "A: recorded checkpoint"
SHA_A="$(git -C "$REPO" rev-parse HEAD)"

safe_target "$REPO/file.txt"; printf 'merged\n' > "$REPO/file.txt"
git -C "$REPO" commit -q -am "merge of PR 41"
SHA_MERGE41="$(git -C "$REPO" rev-parse HEAD)"

git -C "$REPO" checkout -q -b sidetrack "$SHA_A"
safe_target "$REPO/file.txt"; printf 'side\n' > "$REPO/file.txt"
git -C "$REPO" commit -q -am "side"
SHA_SIDE="$(git -C "$REPO" rev-parse HEAD)"
git -C "$REPO" checkout -q develop

# bha-sync resolves the base ref as origin/<canonical base-branch>, so the
# throwaway repo needs a real remote-tracking ref, as a fetched clone would.
sync_origin() { git -C "$REPO" update-ref refs/remotes/origin/develop "$(git -C "$REPO" rev-parse develop)"; }
sync_origin

# ---------------------------------------------------------------------------
# gh stub — validates the production argument shape AND the jq semantics
# ---------------------------------------------------------------------------
safe_mkdir "$STUB_BIN"
safe_target "$STUB_BIN/gh"
cat > "$STUB_BIN/gh" <<'STUB_EOF'
#!/usr/bin/env bash
# Stubbed GitHub CLI. Asserts the argument shape and the semantics of the --jq
# expression production sends, then replays a fixture. Exits 99 on any contract
# violation, so a regression in the query surfaces as a loud failure instead of
# being absorbed as a generic lookup error.
set -uo pipefail
printf '%s\n' "$*" >> "${GH_CALL_LOG:-/dev/null}"

die() { printf 'gh stub: %s\n' "$1" >&2; exit 99; }

# The contract below is written from the specification, not read from the
# production script, so production cannot define its own passing grade.
validate_jq_contract() {
  local expr="$1" rest field head commas
  local -a order=(".state" ".isDraft" ".mergedAt" ".mergeCommit" ".baseRefName" ".url")

  [[ "$expr" == *".[]"* ]] || return 1                       # one field per line
  [[ "$expr" == *"== null then \"${BHA_TEST_SENTINEL:?}\""* ]] || return 1  # nulls -> sentinel
  [[ "$expr" == *"tostring"* ]] || return 1                  # booleans survive as text

  rest="$expr"                                               # required fields, in order
  for field in "${order[@]}"; do
    [[ "$rest" == *"$field"* ]] || return 1
    rest="${rest#*"$field"}"
  done

  head="${expr%%]*}"; head="${head#*[}"                      # exactly six emitted fields
  commas="${head//[^,]/}"
  [[ ${#commas} -eq 5 ]] || return 1
  return 0
}

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
    repo=""; json_fields=""; jq_expr=""; saw_jq=0
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --repo) [[ $# -ge 2 ]] || die "--repo without value"; repo="$2"; shift 2 ;;
        --json) [[ $# -ge 2 ]] || die "--json without value"; json_fields="$2"; shift 2 ;;
        --jq)   [[ $# -ge 2 ]] || die "--jq without value"; jq_expr="$2"; saw_jq=1; shift 2 ;;
        *) die "unexpected flag: $1" ;;
      esac
    done
    [[ -n "$repo" ]] || die "missing --repo"
    [[ $saw_jq -eq 1 ]] || die "missing --jq"
    [[ "$json_fields" == "${BHA_TEST_EXPECTED_JSON:?}" ]] || die "unexpected --json list: $json_fields"
    validate_jq_contract "$jq_expr" || die "--jq expression does not satisfy the six-field null-preserving contract"
    [[ "${BHA_TEST_GH_MODE:-ok}" == "api-fail" ]] && exit 1
    fixture="${BHA_TEST_FIXTURES:?}/pr-$pr_number.txt"
    [[ -f "$fixture" ]] || exit 1      # absent PR: gh exits nonzero
    while IFS= read -r fixture_line; do printf '%s\n' "$fixture_line"; done < "$fixture"
    exit 0 ;;
esac
die "unexpected gh invocation: $*"
STUB_EOF
chmod +x "$STUB_BIN/gh"

reset_fixtures() { safe_rm_rf "$FIXTURES"; safe_mkdir "$FIXTURES"; safe_target "$GH_LOG"; : > "$GH_LOG"; }

# fixture <pr> <state> <isDraft> <mergedAt> <mergeCommit> <base> [url]
fixture() {
  local pr="$1" url="${7:-https://github.com/owner/repo/pull/$1}"
  safe_target "$FIXTURES/pr-$pr.txt"
  printf '%s\n%s\n%s\n%s\n%s\n%s\n' "$2" "$3" "$4" "$5" "$6" "$url" > "$FIXTURES/pr-$pr.txt"
}
readonly N="$EXPECTED_SENTINEL"

# ---------------------------------------------------------------------------
# Snapshot fixtures
# ---------------------------------------------------------------------------
CANON_BASE="develop"

canonical_block() {   # <checkpoint> <pr-rows...>
  local checkpoint="$1"; shift
  local row num base life sha at
  printf '<!-- BHA-SYNC:BEGIN -->\n\n'
  printf '| Canonical field | Giá trị |\n|---|---|\n'
  printf '| repository | `owner/repo` |\n'
  printf '| base-branch | `%s` |\n' "$CANON_BASE"
  [[ "$checkpoint" == "OMIT" ]] || printf '| develop-checkpoint | `%s` |\n' "$checkpoint"
  printf '\n| PR | Base | Lifecycle | Merge commit | Merged at |\n|---|---|---|---|---|\n'
  for row in "$@"; do
    IFS='|' read -r num base life sha at <<<"$row"
    printf '| %s | `%s` | `%s` | `%s` | `%s` |\n' "$num" "$base" "$life" "$sha" "$at"
  done
  printf '\n<!-- BHA-SYNC:END -->\n'
}

write_snapshot() {   # <dest-is-SNAP> <checkpoint> <pr-rows...>
  safe_target "$SNAP"
  { printf '# Fixture snapshot\n\n## 1. Repository state\n\n### 1.1 Canonical record\n\n'
    canonical_block "$@"; } > "$SNAP"
}
write_raw_snapshot() { safe_target "$SNAP"; printf '%s\n' "$1" > "$SNAP"; }
append_historical()  { safe_target "$SNAP"; printf '\n%s\n' "$1" >> "$SNAP"; }

run_sync() {
  ( cd "$REPO" \
    && BHA_TEST_FIXTURES="$FIXTURES" GH_CALL_LOG="$GH_LOG" \
       BHA_TEST_EXPECTED_JSON="$EXPECTED_JSON_FIELDS" BHA_TEST_SENTINEL="$EXPECTED_SENTINEL" \
       PATH="$STUB_BIN:$PATH" "$BHA_SYNC" --snapshot "$SNAP" "$@" 2>&1 )
}

worktree_state() {
  ( cd "$REPO" && git status --porcelain --untracked-files=all
    find "$REPO" -path "$REPO/.git" -prune -o -type f -print0 | sort -z | xargs -0 cksum 2>/dev/null )
}

MERGED_ROW_41="41|develop|MERGED|$SHA_MERGE41|2026-09-03T03:11:21Z"
PROJECT_STATE_BEFORE="$(git -C "$PROJECT_ROOT" status --porcelain --untracked-files=all 2>/dev/null)"

# ===========================================================================

scenario "Merged PR is synchronized"
reset_fixtures; export BHA_TEST_GH_MODE=ok
fixture 41 MERGED false 2026-09-03T03:11:21Z "$SHA_MERGE41" develop
write_snapshot "$SHA_A" "$MERGED_ROW_41"
out="$(run_sync)"; code=$?
check_eq "exit SYNCHRONIZED(0)" 0 "$code"
check_contains "reports merged lifecycle" "snapshot=MERGED github=MERGED" "$out"
check_contains "stub accepted the exact --json list" "--json $EXPECTED_JSON_FIELDS" "$(cat "$GH_LOG")"

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
fixture 52 CLOSED true "$N" "$N" develop    # a closed draft is still CLOSED
out="$(run_sync)"; code=$?
check_eq "closed draft keeps CLOSED lifecycle" 0 "$code"

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

scenario "MERGED with isDraft=true is contradictory → unverified"
reset_fixtures
fixture 41 MERGED true 2026-09-03T03:11:21Z "$SHA_MERGE41" develop
write_snapshot "$SHA_A" "$MERGED_ROW_41"
out="$(run_sync)"; code=$?
check_eq "exit SYNC_UNVERIFIED(4)" 4 "$code"
check_contains "names the contradiction" "MERGED but isDraft=true" "$out"
check_not_contains "never reports synchronized" "bha-sync: SYNCHRONIZED" "$out"
check_not_contains "not downgraded to drift" "DRIFT_DETECTED" "$out"
fixture 41 MERGED false 2026-09-03T03:11:21Z "$SHA_MERGE41" develop
out="$(run_sync)"; code=$?
check_eq "isDraft=false takes the normal merged path" 0 "$code"

scenario "Live base branch must be well-formed before it is compared"
reset_fixtures
write_snapshot "$SHA_A" "$MERGED_ROW_41"
for bad in "has space" "bad..name" "--upload-pack=evil" "$N"; do
  fixture 41 MERGED false 2026-09-03T03:11:21Z "$SHA_MERGE41" "$bad"
  out="$(run_sync)"; code=$?
  check_eq "live base [$bad] exits SYNC_UNVERIFIED(4)" 4 "$code"
  check_not_contains "live base [$bad] is not called drift" "DRIFT_DETECTED" "$out"
done
fixture 41 MERGED false 2026-09-03T03:11:21Z "$SHA_MERGE41" main
out="$(run_sync)"; code=$?
check_eq "a valid but different base is drift(3)" 3 "$code"
check_contains "names baseRefName" "PR #41: baseRefName" "$out"
fixture 41 MERGED false 2026-09-03T03:11:21Z "$SHA_MERGE41" develop
out="$(run_sync)"; code=$?
check_eq "a valid matching base passes" 0 "$code"

scenario "Malformed canonical base-branch → unverified"
reset_fixtures
fixture 41 MERGED false 2026-09-03T03:11:21Z "$SHA_MERGE41" develop
CANON_BASE="bad..name"; write_snapshot "$SHA_A" "$MERGED_ROW_41"; CANON_BASE="develop"
out="$(run_sync)"; code=$?
check_eq "exit SYNC_UNVERIFIED(4)" 4 "$code"
check_contains "names the canonical base" "canonical base-branch 'bad..name'" "$out"

scenario "Absent PR / gh nonzero → unverified"
reset_fixtures
write_snapshot "$SHA_A" "$MERGED_ROW_41"
out="$(run_sync)"; code=$?
check_eq "exit SYNC_UNVERIFIED(4)" 4 "$code"
check_contains "says the lookup failed" "GitHub lookup failed" "$out"

scenario "Missing field in the GitHub response → unverified"
reset_fixtures
safe_target "$FIXTURES/pr-41.txt"
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

scenario "Contradictory merge fields → unverified, never guessed"
reset_fixtures
fixture 60 OPEN false "$N" "$SHA_MERGE41" develop
fixture 61 MERGED false "$N" "$SHA_MERGE41" develop
fixture 62 MERGED false 2026-09-03T03:11:21Z "$N" develop
fixture 63 SUPERPOSED false "$N" "$N" develop
for pr in 60 61 62 63; do
  write_snapshot "$SHA_A" "$pr|develop|OPEN|—|—"
  out="$(run_sync)"; code=$?
  check_eq "PR #$pr exits SYNC_UNVERIFIED(4)" 4 "$code"
  check_not_contains "PR #$pr never reports synchronized" "bha-sync: SYNCHRONIZED" "$out"
done

scenario "Marker state machine rejects every malformed canonical block"
reset_fixtures
fixture 41 MERGED false 2026-09-03T03:11:21Z "$SHA_MERGE41" develop
GOOD_BLOCK="$(canonical_block "$SHA_A" "$MERGED_ROW_41")"
H1="## 1. Repository state"
CANON_H="### 1.1 Canonical record"
HIST_H="## 9. History"
declare -A MALFORMED=(
  [END-before-BEGIN]="$H1
$CANON_H

<!-- BHA-SYNC:END -->
$GOOD_BLOCK"
  [BEGIN-outside-1.1]="$H1
$CANON_H

$HIST_H

$GOOD_BLOCK"
  [whole-block-in-history]="$H1
$CANON_H

no canonical block here

$HIST_H

$GOOD_BLOCK"
  [nested-BEGIN]="$H1
$CANON_H

<!-- BHA-SYNC:BEGIN -->
$GOOD_BLOCK"
  [duplicate-BEGIN-after-END]="$H1
$CANON_H

$GOOD_BLOCK

$GOOD_BLOCK"
  [duplicate-END]="$H1
$CANON_H

$GOOD_BLOCK

<!-- BHA-SYNC:END -->"
  [missing-END]="$H1
$CANON_H

<!-- BHA-SYNC:BEGIN -->

| Canonical field | Giá trị |
|---|---|
| repository | \`owner/repo\` |"
  [missing-BEGIN]="$H1
$CANON_H

| repository | \`owner/repo\` |

<!-- BHA-SYNC:END -->"
  [empty-block]="$H1
$CANON_H

<!-- BHA-SYNC:BEGIN -->
<!-- BHA-SYNC:END -->"
  [duplicate-1.1-heading]="$H1
$CANON_H

$GOOD_BLOCK

$CANON_H

more prose"
  [data-after-unmatched-BEGIN]="$H1
$CANON_H

<!-- BHA-SYNC:BEGIN -->

| PR | Base | Lifecycle | Merge commit | Merged at |
|---|---|---|---|---|
| 41 | \`develop\` | \`MERGED\` | \`$SHA_MERGE41\` | \`2026-09-03T03:11:21Z\` |"
  [valid-block-plus-outside-marker]="$H1
$CANON_H

$GOOD_BLOCK

$HIST_H

<!-- BHA-SYNC:BEGIN -->"
)
for case_name in "${!MALFORMED[@]}"; do
  write_raw_snapshot "${MALFORMED[$case_name]}"
  out="$(run_sync)"; code=$?
  check_eq "[$case_name] exits SYNC_UNVERIFIED(4)" 4 "$code"
  check_not_contains "[$case_name] never prints SYNCHRONIZED" "bha-sync: SYNCHRONIZED" "$out"
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

scenario "Multiple independently tracked PRs"
reset_fixtures
fixture 41 MERGED false 2026-09-03T03:11:21Z "$SHA_MERGE41" develop
fixture 50 OPEN true "$N" "$N" develop
fixture 52 CLOSED false "$N" "$N" develop
write_snapshot "$SHA_A" "$MERGED_ROW_41" "50|develop|DRAFT|—|—" "52|develop|CLOSED|—|—"
out="$(run_sync)"; code=$?
check_eq "exit SYNCHRONIZED(0)" 0 "$code"
check_contains "counts every PR plus the checkpoint" "4 subject(s) checked" "$out"
fixture 50 OPEN false "$N" "$N" develop
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
write_snapshot "$SHA_A" "$MERGED_ROW_41"
out="$(run_sync)"; code=$?
check_eq "a descendant live head is not drift" 0 "$code"
check_contains "states the ancestor relationship" "is an ancestor of" "$out"

scenario "Post-merge simulation — Snapshot committed into the merge commit"
# Commit A is the recorded checkpoint. A correction branched from A commits the
# canonical Snapshot recording A, and is merged, producing commit B. The
# Snapshot bha-sync reads is the tracked file at B, so this proves merged
# content still carrying checkpoint A is SYNCHRONIZED — otherwise every
# reconciliation would demand another one. Runs in its own disposable repo.
reset_fixtures
safe_mkdir "$POSTMERGE"
git -C "$POSTMERGE" init --quiet
git -C "$POSTMERGE" config user.email "test@example.invalid"
git -C "$POSTMERGE" config user.name "bha-sync tests"
git -C "$POSTMERGE" checkout -q -b develop
safe_target "$POSTMERGE/seed.txt"; printf 'seed\n' > "$POSTMERGE/seed.txt"
git -C "$POSTMERGE" add seed.txt
git -C "$POSTMERGE" commit -q -m "A"
PM_A="$(git -C "$POSTMERGE" rev-parse HEAD)"

git -C "$POSTMERGE" checkout -q -b correction "$PM_A"
safe_mkdir "$POSTMERGE/docs/project"
PM_SNAP="$POSTMERGE/docs/project/SNAPSHOT.md"
safe_target "$PM_SNAP"
{ printf '# Snapshot\n\n## 1. Repository state\n\n### 1.1 Canonical record\n\n'
  canonical_block "$PM_A" "41|develop|MERGED|$PM_A|2026-09-03T03:11:21Z"; } > "$PM_SNAP"
git -C "$POSTMERGE" add docs/project/SNAPSHOT.md
git -C "$POSTMERGE" commit -q -m "correction: record checkpoint A"
git -C "$POSTMERGE" checkout -q develop
git -C "$POSTMERGE" merge -q --no-ff -m "merge correction" correction
PM_B="$(git -C "$POSTMERGE" rev-parse HEAD)"
git -C "$POSTMERGE" update-ref refs/remotes/origin/develop "$PM_B"

check_eq "Snapshot is tracked at B" "docs/project/SNAPSHOT.md" \
  "$(git -C "$POSTMERGE" ls-files --error-unmatch docs/project/SNAPSHOT.md 2>/dev/null)"
check_contains "merged content still records checkpoint A" "$PM_A" \
  "$(git -C "$POSTMERGE" show "$PM_B:docs/project/SNAPSHOT.md")"
check_eq "A is an ancestor of B" 0 "$(git -C "$POSTMERGE" merge-base --is-ancestor "$PM_A" "$PM_B"; echo $?)"
check_eq "A and B differ" "different" "$([[ "$PM_A" != "$PM_B" ]] && echo different || echo same)"
fixture 41 MERGED false 2026-09-03T03:11:21Z "$PM_A" develop
pm_out="$( cd "$POSTMERGE" \
  && BHA_TEST_FIXTURES="$FIXTURES" GH_CALL_LOG="$GH_LOG" \
     BHA_TEST_EXPECTED_JSON="$EXPECTED_JSON_FIELDS" BHA_TEST_SENTINEL="$EXPECTED_SENTINEL" \
     PATH="$STUB_BIN:$PATH" "$BHA_SYNC" --snapshot "$PM_SNAP" 2>&1 )"; pm_code=$?
check_eq "exit SYNCHRONIZED(0)" 0 "$pm_code"
check_not_contains "no drift is reported" "DRIFT_DETECTED" "$pm_out"
check_eq "the simulated repository is clean afterwards" "" \
  "$(git -C "$POSTMERGE" status --porcelain --untracked-files=all)"

scenario "gh mock enforces the jq contract independently"
reset_fixtures
fixture 41 MERGED false 2026-09-03T03:11:21Z "$SHA_MERGE41" develop
run_stub_jq() {
  ( BHA_TEST_FIXTURES="$FIXTURES" BHA_TEST_EXPECTED_JSON="$EXPECTED_JSON_FIELDS" \
    BHA_TEST_SENTINEL="$EXPECTED_SENTINEL" GH_CALL_LOG=/dev/null \
    "$STUB_BIN/gh" pr view 41 --repo owner/repo --json "$EXPECTED_JSON_FIELDS" --jq "$1" >/dev/null 2>&1 )
  printf '%s' $?
}
GOOD_JQ='[.state, .isDraft, .mergedAt, (.mergeCommit.oid // null), .baseRefName, .url]
  | map(if . == null then "@@NULL@@" else tostring end)
  | .[]'
check_eq "the contract-satisfying expression is accepted" 0 "$(run_stub_jq "$GOOD_JQ")"
check_eq "a five-field expression is rejected" 99 \
  "$(run_stub_jq '[.state, .isDraft, .mergedAt, .baseRefName, .url] | map(if . == null then "@@NULL@@" else tostring end) | .[]')"
check_eq "dropping the null sentinel is rejected" 99 \
  "$(run_stub_jq '[.state, .isDraft, .mergedAt, (.mergeCommit.oid // ""), .baseRefName, .url] | map(tostring) | .[]')"
check_eq "reordered fields are rejected" 99 \
  "$(run_stub_jq '[.isDraft, .state, .mergedAt, (.mergeCommit.oid // null), .baseRefName, .url] | map(if . == null then "@@NULL@@" else tostring end) | .[]')"
check_eq "a non-streaming expression is rejected" 99 \
  "$(run_stub_jq '[.state, .isDraft, .mergedAt, (.mergeCommit.oid // null), .baseRefName, .url] | map(if . == null then "@@NULL@@" else tostring end)')"
check_eq "dropping baseRefName is rejected" 99 \
  "$(run_stub_jq '[.state, .isDraft, .mergedAt, (.mergeCommit.oid // null), .url, .number] | map(if . == null then "@@NULL@@" else tostring end) | .[]')"

scenario "Missing gh binary → unverified"
reset_fixtures
fixture 41 MERGED false 2026-09-03T03:11:21Z "$SHA_MERGE41" develop
write_snapshot "$SHA_A" "$MERGED_ROW_41"
safe_mkdir "$NOGH_BIN"
for tool in bash git; do
  tool_path="$(command -v "$tool")" && ln -sf "$tool_path" "$NOGH_BIN/$tool"
done
check_not_contains "gh really is absent from that PATH" "gh" "$(ls "$NOGH_BIN")"
out="$( cd "$REPO" && PATH="$NOGH_BIN" "$BHA_SYNC" --snapshot "$SNAP" 2>&1 )"; code=$?
check_eq "exit SYNC_UNVERIFIED(4)" 4 "$code"
check_contains "names the dependency" "required dependency not installed: gh" "$out"

scenario "Production needs no external cat"
# usage() used a `cat` heredoc while the contract promised bash + git + gh only.
out="$( cd "$REPO" && PATH="$NOGH_BIN" "$BHA_SYNC" --help 2>&1 )"; code=$?
check_eq "--help exits 0 without cat on PATH" 0 "$code"
check_contains "help is complete" "0 SYNCHRONIZED   2 USAGE_ERROR   3 DRIFT_DETECTED   4 SYNC_UNVERIFIED" "$out"
check_contains "help still lists the options" "--base-ref REF" "$out"
out="$( cd "$REPO" && PATH="$NOGH_BIN" "$BHA_SYNC" --snapshot 2>&1 )"; code=$?
check_eq "usage error still exits 2 without cat" 2 "$code"
check_contains "usage error is actionable without cat" "option --snapshot requires a value" "$out"

scenario "Authentication failure → unverified"
reset_fixtures
fixture 41 MERGED false 2026-09-03T03:11:21Z "$SHA_MERGE41" develop
write_snapshot "$SHA_A" "$MERGED_ROW_41"
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
out="$( cd "$REPO" && PATH="$STUB_BIN:$PATH" "$BHA_SYNC" --base-ref 2>&1 )"; code=$?
check_eq "trailing --base-ref exits USAGE_ERROR(2)" 2 "$code"
out="$( cd "$REPO" && PATH="$STUB_BIN:$PATH" "$BHA_SYNC" --help 2>&1 )"; code=$?
check_eq "--help exits 0" 0 "$code"

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
safe_target "$GH_LOG"; : > "$GH_LOG"
out="$(run_sync)"; code=$?
after="$(worktree_state)"
check_eq "exit unchanged" 0 "$code"
check_eq "tracked and untracked worktree state is identical" "$before" "$after"
gh_calls="$(cat "$GH_LOG")"
check_not_contains "never merges" "pr merge" "$gh_calls"
check_not_contains "never marks ready" "pr ready" "$gh_calls"
check_not_contains "never uses a write method" "--method" "$gh_calls"
check_not_contains "never edits" "pr edit" "$gh_calls"
check_contains "only reads PR state" "pr view" "$gh_calls"
check_eq "the real project repository is untouched" "$PROJECT_STATE_BEFORE" \
  "$(git -C "$PROJECT_ROOT" status --porcelain --untracked-files=all 2>/dev/null)"

printf '\n----------------------------------------\n'
printf 'scenarios: %d   assertions: %d passed, %d failed\n' "$scenario_count" "$assert_pass" "$assert_fail"
if [[ $assert_fail -gt 0 ]]; then
  printf '\nFailed assertions:\n'
  for f in "${failed_list[@]}"; do printf '  - %s\n' "$f"; done
fi
[[ $assert_fail -eq 0 ]]
