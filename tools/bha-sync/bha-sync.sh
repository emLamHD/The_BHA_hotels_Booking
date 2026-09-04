#!/usr/bin/env bash
#
# bha-sync — reconcile `docs/project/SNAPSHOT.md` against GitHub live state.
#
# Governance contract: `docs/governance/BHA_SYNC.md`.
#
# Purpose
#   `SNAPSHOT.md` is the recoverable-state source of truth this project's
#   agents load as their planning baseline (`docs/governance/RULES.md` §8,
#   `docs/governance/WORKFLOW.md` §2). It is hand-maintained, so it can fall
#   behind GitHub — exactly what happened to PR #41, which stayed documented
#   as "Draft, OPEN, chưa merge" after it had already merged into `develop`.
#   An agent that plans on that stale text plans on a baseline that does not
#   exist.
#
#   This script makes GitHub live state authoritative for Pull Request
#   lifecycle and refuses to certify a baseline it could not verify.
#
# Deliberate non-goal: this script NEVER writes to SNAPSHOT.md or any other
#   tracked file, and never touches a remote. A detected drift must be
#   corrected by a human/agent through a normal feature branch + PR, which
#   keeps corrections reviewable and makes direct writes to a protected
#   branch impossible by construction. Read-only also makes idempotency
#   structural rather than something to test for: repeated runs cannot
#   produce a diff because there is no write path at all.
#
# Exit codes
#   0  SYNCHRONIZED    — every checked claim matches GitHub live state.
#   2  USAGE           — bad invocation.
#   3  DRIFT_DETECTED  — snapshot contradicts GitHub; baseline NOT usable.
#   4  SYNC_UNVERIFIED — could not verify (fail closed); baseline NOT usable.
#
# Both 3 and 4 mean the same thing to a caller: do not plan or implement on
# this baseline. They are distinct so the caller can tell "the document is
# wrong" from "I could not check".

set -euo pipefail

# Deterministic matching regardless of the operator's locale.
export LC_ALL=C

readonly EXIT_SYNCHRONIZED=0
readonly EXIT_USAGE=2
readonly EXIT_DRIFT=3
readonly EXIT_UNVERIFIED=4

readonly SHA_RE='[0-9a-f]{40}'

snapshot_path=""
repo_slug=""
base_ref="origin/develop"
output_json=0

# Collected results. Each entry: "<subject>|<field>|<claimed>|<live>".
drift_rows=()
unverified_reasons=()
checked_subjects=0

usage() {
  cat <<'USAGE'
Usage: bha-sync.sh [options]

Verifies that docs/project/SNAPSHOT.md agrees with GitHub live state.
Read-only: never writes a tracked file, never mutates a remote.

Options:
  --snapshot PATH   Snapshot file (default: docs/project/SNAPSHOT.md at repo root)
  --repo SLUG       owner/name (default: resolved from the git remote via gh)
  --base-ref REF    Ref a claimed merge commit must be contained by
                    (default: origin/develop)
  --json            Emit a machine-readable result object
  -h, --help        Show this help

Exit codes: 0 synchronized, 2 usage, 3 drift detected, 4 unverified.
USAGE
}

log() { [[ $output_json -eq 1 ]] || printf '%s\n' "$*"; }

# Records an unverifiable condition. Every caller must then stop; nothing is
# ever inferred to fill the gap.
unverified() { unverified_reasons+=("$1"); }

drift() { drift_rows+=("$1|$2|$3|$4"); }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --snapshot) snapshot_path="${2:-}"; shift 2 ;;
    --repo)     repo_slug="${2:-}";     shift 2 ;;
    --base-ref) base_ref="${2:-}";      shift 2 ;;
    --json)     output_json=1;          shift ;;
    -h|--help)  usage; exit 0 ;;
    *) printf 'bha-sync: unknown argument: %s\n\n' "$1" >&2; usage >&2; exit "$EXIT_USAGE" ;;
  esac
done

# ---------------------------------------------------------------------------
# Result emission
# ---------------------------------------------------------------------------

json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

emit_and_exit() {
  local status="$1" code="$2"

  if [[ $output_json -eq 1 ]]; then
    printf '{\n  "status": "%s",\n  "subjectsChecked": %d,\n' "$status" "$checked_subjects"
    printf '  "drift": ['
    local first=1 row
    for row in ${drift_rows[@]+"${drift_rows[@]}"}; do
      IFS='|' read -r subject field claimed live <<<"$row"
      [[ $first -eq 1 ]] || printf ','
      first=0
      printf '\n    {"subject": "%s", "field": "%s", "snapshot": "%s", "github": "%s"}' \
        "$(json_escape "$subject")" "$(json_escape "$field")" \
        "$(json_escape "$claimed")" "$(json_escape "$live")"
    done
    [[ $first -eq 1 ]] || printf '\n  '
    printf '],\n  "unverified": ['
    first=1
    local reason
    for reason in ${unverified_reasons[@]+"${unverified_reasons[@]}"}; do
      [[ $first -eq 1 ]] || printf ','
      first=0
      printf '\n    "%s"' "$(json_escape "$reason")"
    done
    [[ $first -eq 1 ]] || printf '\n  '
    printf ']\n}\n'
    exit "$code"
  fi

  printf 'bha-sync: %s\n' "$status"
  if [[ ${#unverified_reasons[@]} -gt 0 ]]; then
    printf '\nCould not verify:\n'
    local reason
    for reason in "${unverified_reasons[@]}"; do printf '  - %s\n' "$reason"; done
  fi
  if [[ ${#drift_rows[@]} -gt 0 ]]; then
    printf '\nDrift (snapshot vs GitHub):\n'
    local row
    for row in "${drift_rows[@]}"; do
      IFS='|' read -r subject field claimed live <<<"$row"
      printf '  - %s: %s\n      snapshot: %s\n      github:   %s\n' \
        "$subject" "$field" "$claimed" "$live"
    done
  fi

  case "$code" in
    "$EXIT_SYNCHRONIZED")
      printf '\n%d subject(s) checked. Baseline may be used for planning.\n' "$checked_subjects" ;;
    "$EXIT_DRIFT")
      printf '\nBaseline is NOT synchronized. Do not plan or implement on it.\n'
      printf 'Correct docs/project/SNAPSHOT.md on a feature branch and open a PR;\n'
      printf 'bha-sync never edits the snapshot and never pushes to a protected branch.\n' ;;
    "$EXIT_UNVERIFIED")
      printf '\nGitHub state could not be verified — failing closed.\n'
      printf 'Nothing was inferred from local branches, local git history, or the\n'
      printf 'snapshot text itself. Restore GitHub access and re-run.\n' ;;
  esac
  exit "$code"
}

# ---------------------------------------------------------------------------
# Preconditions — any failure is fail-closed, never a fallback
# ---------------------------------------------------------------------------

if ! repo_root="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  unverified "not inside a git repository"
  emit_and_exit "SYNC_UNVERIFIED" "$EXIT_UNVERIFIED"
fi

[[ -n "$snapshot_path" ]] || snapshot_path="$repo_root/docs/project/SNAPSHOT.md"

if [[ ! -r "$snapshot_path" ]]; then
  unverified "snapshot not readable: $snapshot_path"
  emit_and_exit "SYNC_UNVERIFIED" "$EXIT_UNVERIFIED"
fi

if ! command -v gh >/dev/null 2>&1; then
  unverified "GitHub CLI (gh) not installed — live PR state cannot be read"
  emit_and_exit "SYNC_UNVERIFIED" "$EXIT_UNVERIFIED"
fi

if ! gh auth status >/dev/null 2>&1; then
  unverified "gh is not authenticated — live PR state cannot be read"
  emit_and_exit "SYNC_UNVERIFIED" "$EXIT_UNVERIFIED"
fi

if [[ -z "$repo_slug" ]]; then
  if ! repo_slug="$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null)" \
     || [[ -z "$repo_slug" ]]; then
    unverified "could not resolve the GitHub repository slug"
    emit_and_exit "SYNC_UNVERIFIED" "$EXIT_UNVERIFIED"
  fi
fi

log "bha-sync: repository $repo_slug"
log "bha-sync: snapshot   $snapshot_path"
log "bha-sync: base ref   $base_ref"
log ""

# ---------------------------------------------------------------------------
# Snapshot claim extraction
#
# The snapshot's §1 table is the one place PR lifecycle is asserted, one row
# per PR. Claims are read only from those rows — never from prose elsewhere,
# and never from local branch names, which say nothing about a remote PR.
# ---------------------------------------------------------------------------

# Lifecycle a snapshot row asserts. Order matters: a row that names a merge
# commit is a merged claim even if it also narrates earlier draft history.
claimed_status_of_row() {
  local row="$1" lower
  lower="$(printf '%s' "$row" | tr '[:upper:]' '[:lower:]')"

  if [[ "$row" =~ merge\ commit\ \`($SHA_RE)\` ]]; then
    printf 'MERGED'
  elif [[ "$lower" == *draft* ]]; then
    printf 'DRAFT'
  elif [[ "$lower" == *open* ]]; then
    printf 'OPEN'
  elif [[ "$lower" == *"closed without merge"* || "$lower" == *"đóng không merge"* ]]; then
    printf 'CLOSED'
  else
    # Unrecognized rows are never optimistically treated as agreeing.
    printf 'UNKNOWN'
  fi
}

claimed_merge_sha_of_row() {
  local row="$1"
  [[ "$row" =~ merge\ commit\ \`($SHA_RE)\` ]] && printf '%s' "${BASH_REMATCH[1]}"
}

claimed_merged_at_of_row() {
  local row="$1"
  [[ "$row" =~ merged\ \`([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]+Z)\` ]] && printf '%s' "${BASH_REMATCH[1]}"
}

# Canonical lifecycle from GitHub, per the mapping in docs/governance/BHA_SYNC.md.
live_status_of() {
  local state="$1" is_draft="$2" merged_at="$3"
  if [[ "$state" == "MERGED" || -n "$merged_at" ]]; then
    printf 'MERGED'
  elif [[ "$state" == "OPEN" && "$is_draft" == "true" ]]; then
    printf 'DRAFT'
  elif [[ "$state" == "OPEN" ]]; then
    printf 'OPEN'
  elif [[ "$state" == "CLOSED" ]]; then
    printf 'CLOSED'
  else
    printf 'UNKNOWN'
  fi
}

mapfile -t pr_numbers < <(grep -oE '^\| PR #[0-9]+' "$snapshot_path" | grep -oE '[0-9]+' | sort -n -u)

if [[ ${#pr_numbers[@]} -eq 0 ]]; then
  unverified "no '| PR #N |' rows found in $snapshot_path — snapshot shape not recognized"
  emit_and_exit "SYNC_UNVERIFIED" "$EXIT_UNVERIFIED"
fi

for pr in "${pr_numbers[@]}"; do
  row="$(grep -m1 -E "^\| PR #${pr}[^0-9]" "$snapshot_path" || true)"
  if [[ -z "$row" ]]; then
    unverified "PR #$pr: row disappeared while reading the snapshot"
    continue
  fi

  if ! live="$(gh pr view "$pr" --repo "$repo_slug" \
      --json state,isDraft,mergedAt,mergeCommit,baseRefName,headRefName,url \
      --jq '[.state, (.isDraft|tostring), (.mergedAt // ""), (.mergeCommit.oid // ""), .baseRefName, .url] | @tsv' \
      2>/dev/null)"; then
    unverified "PR #$pr: GitHub lookup failed"
    continue
  fi

  IFS=$'\t' read -r live_state live_draft live_merged_at live_merge_sha live_base live_url <<<"$live"

  if [[ -z "$live_state" ]]; then
    unverified "PR #$pr: GitHub returned no state"
    continue
  fi

  checked_subjects=$((checked_subjects + 1))

  claimed="$(claimed_status_of_row "$row")"
  actual="$(live_status_of "$live_state" "$live_draft" "$live_merged_at")"

  log "PR #$pr: snapshot=$claimed github=$actual  ($live_url)"

  if [[ "$claimed" != "$actual" ]]; then
    drift "PR #$pr" "lifecycle" "$claimed" "$actual"
    continue
  fi

  # Merged claims carry evidence that must also agree, and the merge commit
  # must genuinely be contained by the base ref — a merge recorded against a
  # commit that is not on the branch is still an unusable baseline.
  if [[ "$actual" == "MERGED" ]]; then
    claimed_sha="$(claimed_merge_sha_of_row "$row")"
    if [[ -n "$claimed_sha" && -n "$live_merge_sha" && "$claimed_sha" != "$live_merge_sha" ]]; then
      drift "PR #$pr" "mergeCommit" "$claimed_sha" "$live_merge_sha"
    fi

    claimed_at="$(claimed_merged_at_of_row "$row")"
    if [[ -n "$claimed_at" && -n "$live_merged_at" && "$claimed_at" != "$live_merged_at" ]]; then
      drift "PR #$pr" "mergedAt" "$claimed_at" "$live_merged_at"
    fi

    if [[ -n "$live_merge_sha" ]]; then
      if ! git -C "$repo_root" cat-file -e "${live_merge_sha}^{commit}" 2>/dev/null; then
        unverified "PR #$pr: merge commit $live_merge_sha not present locally (fetch $base_ref and re-run)"
      elif ! git -C "$repo_root" merge-base --is-ancestor "$live_merge_sha" "$base_ref" 2>/dev/null; then
        drift "PR #$pr" "mergeCommit contained by $base_ref" "assumed contained" "not an ancestor"
      fi
    fi
  fi
done

# ---------------------------------------------------------------------------
# Baseline HEAD claim
# ---------------------------------------------------------------------------

head_row="$(grep -m1 -E '^\| `develop` HEAD \|' "$snapshot_path" || true)"
if [[ -n "$head_row" ]]; then
  if [[ "$head_row" =~ \`($SHA_RE)\` ]]; then
    claimed_head="${BASH_REMATCH[1]}"
    if actual_head="$(git -C "$repo_root" rev-parse --verify "$base_ref" 2>/dev/null)"; then
      checked_subjects=$((checked_subjects + 1))
      log "develop HEAD: snapshot=${claimed_head:0:12} $base_ref=${actual_head:0:12}"
      [[ "$claimed_head" == "$actual_head" ]] \
        || drift "develop HEAD" "sha" "$claimed_head" "$actual_head"
    else
      unverified "cannot resolve $base_ref — run 'git fetch --prune origin' and re-run"
    fi
  else
    unverified "'develop HEAD' row present but carries no 40-hex sha"
  fi
fi

# ---------------------------------------------------------------------------
# Verdict — unverified outranks drift, because an unverified run may be
# hiding further drift it never got to look at.
# ---------------------------------------------------------------------------

log ""
if [[ ${#unverified_reasons[@]} -gt 0 ]]; then
  emit_and_exit "SYNC_UNVERIFIED" "$EXIT_UNVERIFIED"
elif [[ ${#drift_rows[@]} -gt 0 ]]; then
  emit_and_exit "DRIFT_DETECTED" "$EXIT_DRIFT"
else
  emit_and_exit "SYNCHRONIZED" "$EXIT_SYNCHRONIZED"
fi
