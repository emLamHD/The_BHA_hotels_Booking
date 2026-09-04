#!/usr/bin/env bash
#
# bha-sync — verify docs/project/SNAPSHOT.md against GitHub live state.
#
# Governance contract: docs/governance/BHA_SYNC.md
#
# WHY THIS EXISTS
#   SNAPSHOT.md is the recoverable-state source of truth agents load as their
#   planning baseline (RULES.md §8, WORKFLOW.md §2). It is hand-maintained, so
#   it can fall behind GitHub — which is what happened to PR #41, documented as
#   "Draft, OPEN, chưa merge" long after it had merged. An agent planning on
#   that text plans on a state that does not exist.
#
# DESIGN COMMITMENTS
#   * GitHub live state is authoritative for PR lifecycle. The Snapshot holds
#     claims; GitHub holds facts.
#   * Fail closed. Anything unverifiable is SYNC_UNVERIFIED, never "fine".
#     Nothing is ever inferred from local branch names or the Snapshot's prose.
#   * Never writes a tracked file, never mutates a remote. A correction goes
#     through a feature branch + PR, so writing to a protected branch is
#     impossible by construction and idempotency is structural — there is no
#     write path to be idempotent about, and no dynamic timestamp anywhere.
#   * The Snapshot records a *last reconciled checkpoint*, not a claim about the
#     current branch tip. Requiring equality would be unsatisfiable: merging the
#     commit that updates the Snapshot necessarily advances develop past the SHA
#     that commit recorded, so every reconciliation would immediately re-drift.
#     The checkpoint must be an ancestor of the live tip; equality is allowed
#     but never required.
#
# EXIT CODES (public contract)
#   0  SYNCHRONIZED    every canonical claim matches GitHub live state
#   2  USAGE_ERROR     bad invocation
#   3  DRIFT_DETECTED  Snapshot contradicts GitHub — baseline NOT usable
#   4  SYNC_UNVERIFIED could not verify — baseline NOT usable (fail closed)
#
# 3 and 4 both block work. They are distinct so a caller can tell "the document
# is wrong" from "I could not check".
#
# REQUIREMENTS
#   bash >= 4.0 (mapfile, ${var,,}), git, gh (authenticated, read scope).
#   No other external command is used on the production path.

set -uo pipefail
export LC_ALL=C

readonly EXIT_SYNCHRONIZED=0
readonly EXIT_USAGE=2
readonly EXIT_DRIFT=3
readonly EXIT_UNVERIFIED=4

# Emitted by the gh query in place of a JSON null, so an absent field stays
# visible as its own line instead of collapsing and shifting every field after
# it. Chosen to be impossible as a real state/ref/URL value.
readonly NULL_SENTINEL='@@NULL@@'

# The Snapshot's own null marker, for PRs that have no merge commit / mergedAt.
readonly SNAPSHOT_NULL='—'

readonly SHA_RE='^[0-9a-f]{40}$'
readonly ISO8601_RE='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'
readonly MARKER_BEGIN='<!-- BHA-SYNC:BEGIN'
readonly MARKER_END='<!-- BHA-SYNC:END -->'

snapshot_path=""
repo_override=""
base_ref_override=""
output_json=0

drift_rows=()          # "<subject>|<field>|<snapshot>|<github>"
unverified_reasons=()
checked_subjects=0

# Canonical record, populated by parse_canonical_block.
canon_repository=""
canon_base_branch=""
canon_checkpoint=""
canon_pr_numbers=()
canon_pr_base=()
canon_pr_lifecycle=()
canon_pr_merge_commit=()
canon_pr_merged_at=()

usage() {
  cat <<'USAGE'
Usage: bha-sync.sh [options]

Verifies the canonical record in docs/project/SNAPSHOT.md §1 against GitHub
live state. Read-only: never writes a tracked file, never mutates a remote.

Options:
  --snapshot PATH   Snapshot file (default: docs/project/SNAPSHOT.md at repo root)
  --repo SLUG       owner/name (default: the canonical `repository` record)
  --base-ref REF    Git ref the checkpoint and merge commits must be contained
                    by (default: origin/<canonical base-branch>)
  --json            Emit a machine-readable result object
  -h, --help        Show this help

Exit codes:
  0 SYNCHRONIZED   2 USAGE_ERROR   3 DRIFT_DETECTED   4 SYNC_UNVERIFIED

Requires bash >= 4.0, git, and an authenticated gh.
USAGE
}

usage_error() {
  printf 'bha-sync: %s\n\n' "$1" >&2
  usage >&2
  exit "$EXIT_USAGE"
}

log() { [[ $output_json -eq 1 ]] || printf '%s\n' "$*"; }
unverified() { unverified_reasons+=("$1"); }
drift() { drift_rows+=("$1|$2|$3|$4"); }

trim() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

# Strips one layer of Markdown backticks, if present.
unquote() {
  local s="$1"
  s="${s#\`}"
  s="${s%\`}"
  printf '%s' "$s"
}

# Splits a Markdown table row into ROW_FIELDS. IFS='|' is a non-whitespace
# delimiter, so empty cells keep their position instead of collapsing — the
# exact failure that made this tool misread every non-merged PR before.
ROW_FIELDS=()
split_row() {
  local row="$1"
  row="${row#|}"
  row="${row%|}"
  local raw=() field
  local IFS='|'
  read -ra raw <<<"$row"
  ROW_FIELDS=()
  for field in ${raw[@]+"${raw[@]}"}; do
    ROW_FIELDS+=("$(trim "$field")")
  done
}

is_separator_row() {
  local field
  [[ ${#ROW_FIELDS[@]} -gt 0 ]] || return 1
  for field in "${ROW_FIELDS[@]}"; do
    [[ "$field" =~ ^:?-+:?$ ]] || return 1
  done
  return 0
}

# ---------------------------------------------------------------------------
# Result emission
# ---------------------------------------------------------------------------

json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '%s' "$s"
}

emit_and_exit() {
  local status="$1" code="$2" row reason first=1

  if [[ $output_json -eq 1 ]]; then
    printf '{\n  "status": "%s",\n  "subjectsChecked": %d,\n  "drift": [' \
      "$status" "$checked_subjects"
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
    for reason in "${unverified_reasons[@]}"; do printf '  - %s\n' "$reason"; done
  fi
  if [[ ${#drift_rows[@]} -gt 0 ]]; then
    printf '\nDrift (snapshot vs GitHub):\n'
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
      printf 'Correct the canonical record in SNAPSHOT.md §1 on a feature branch\n'
      printf 'and open a PR; bha-sync never edits the Snapshot and never pushes.\n' ;;
    "$EXIT_UNVERIFIED")
      printf '\nGitHub state could not be verified — failing closed.\n'
      printf 'Nothing was inferred from local branches, local git history, or the\n'
      printf 'Snapshot text itself.\n' ;;
  esac
  exit "$code"
}

# ---------------------------------------------------------------------------
# Argument parsing — a missing option value is detected before any shift, so
# it can never fall through to an incidental shell exit code.
# ---------------------------------------------------------------------------

require_value() {
  [[ $2 -ge 2 ]] || usage_error "option $1 requires a value"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --snapshot) require_value "$1" $#; snapshot_path="$2";      shift 2 ;;
    --repo)     require_value "$1" $#; repo_override="$2";      shift 2 ;;
    --base-ref) require_value "$1" $#; base_ref_override="$2";  shift 2 ;;
    --json)     output_json=1; shift ;;
    -h|--help)  usage; exit 0 ;;
    *)          usage_error "unknown argument: $1" ;;
  esac
done

# ---------------------------------------------------------------------------
# Environment — every failure here is fail-closed, never a fallback
# ---------------------------------------------------------------------------

if [[ -z "${BASH_VERSINFO[0]:-}" || "${BASH_VERSINFO[0]}" -lt 4 ]]; then
  unverified "bash >= 4.0 required (found ${BASH_VERSION:-unknown})"
  emit_and_exit "SYNC_UNVERIFIED" "$EXIT_UNVERIFIED"
fi

for dep in git gh; do
  if ! command -v "$dep" >/dev/null 2>&1; then
    unverified "required dependency not installed: $dep"
    emit_and_exit "SYNC_UNVERIFIED" "$EXIT_UNVERIFIED"
  fi
done

if ! repo_root="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  unverified "not inside a git repository"
  emit_and_exit "SYNC_UNVERIFIED" "$EXIT_UNVERIFIED"
fi

[[ -n "$snapshot_path" ]] || snapshot_path="$repo_root/docs/project/SNAPSHOT.md"

if [[ ! -r "$snapshot_path" ]]; then
  unverified "snapshot not readable: $snapshot_path"
  emit_and_exit "SYNC_UNVERIFIED" "$EXIT_UNVERIFIED"
fi

if ! gh auth status >/dev/null 2>&1; then
  unverified "gh is not authenticated — live PR state cannot be read"
  emit_and_exit "SYNC_UNVERIFIED" "$EXIT_UNVERIFIED"
fi

# ---------------------------------------------------------------------------
# Canonical record
#
# Only the delimited block inside SNAPSHOT.md §1 is authoritative. Historical
# tables and prose elsewhere in the document can neither satisfy nor invalidate
# a canonical row — an earlier version of this tool grepped the whole file and
# so could be satisfied by narrative text that was never meant as state.
# ---------------------------------------------------------------------------

parse_canonical_block() {
  local line trimmed key value pr seen_begin=0 seen_end=0 inside=0
  local meta_repo_count=0 meta_base_count=0 meta_checkpoint_count=0
  local seen_pr_numbers=" "

  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" == *"$MARKER_BEGIN"* ]]; then
      seen_begin=$((seen_begin + 1))
      inside=1
      continue
    fi
    if [[ "$line" == *"$MARKER_END"* ]]; then
      seen_end=$((seen_end + 1))
      inside=0
      continue
    fi
    [[ $inside -eq 1 ]] || continue

    trimmed="$(trim "$line")"
    [[ -n "$trimmed" ]] || continue
    if [[ "$trimmed" != \|* ]]; then
      unverified "canonical block contains a non-table line: ${trimmed:0:60}"
      return 1
    fi

    split_row "$trimmed"
    is_separator_row && continue

    case ${#ROW_FIELDS[@]} in
      2)
        key="${ROW_FIELDS[0],,}"
        value="$(unquote "${ROW_FIELDS[1]}")"
        case "$key" in
          "canonical field") ;;                    # header
          repository)         canon_repository="$value"; meta_repo_count=$((meta_repo_count + 1)) ;;
          base-branch)        canon_base_branch="$value"; meta_base_count=$((meta_base_count + 1)) ;;
          develop-checkpoint) canon_checkpoint="$value"; meta_checkpoint_count=$((meta_checkpoint_count + 1)) ;;
          *) unverified "unknown canonical field: ${ROW_FIELDS[0]}"; return 1 ;;
        esac
        ;;
      5)
        pr="${ROW_FIELDS[0]}"
        [[ "$pr" == "PR" ]] && continue          # header
        if [[ ! "$pr" =~ ^[0-9]+$ ]]; then
          unverified "canonical PR row has a non-numeric PR number: $pr"
          return 1
        fi
        if [[ "$seen_pr_numbers" == *" $pr "* ]]; then
          unverified "canonical block lists PR #$pr more than once"
          return 1
        fi
        seen_pr_numbers+="$pr "
        canon_pr_numbers+=("$pr")
        canon_pr_base+=("$(unquote "${ROW_FIELDS[1]}")")
        canon_pr_lifecycle+=("$(unquote "${ROW_FIELDS[2]}")")
        canon_pr_merge_commit+=("$(unquote "${ROW_FIELDS[3]}")")
        canon_pr_merged_at+=("$(unquote "${ROW_FIELDS[4]}")")
        ;;
      *)
        unverified "canonical row has ${#ROW_FIELDS[@]} fields, expected 2 or 5: ${trimmed:0:60}"
        return 1
        ;;
    esac
  done < "$snapshot_path"

  if [[ $seen_begin -ne 1 || $seen_end -ne 1 ]]; then
    unverified "expected exactly one BHA-SYNC:BEGIN/END marker pair (found $seen_begin/$seen_end)"
    return 1
  fi
  if [[ $meta_repo_count -ne 1 || $meta_base_count -ne 1 || $meta_checkpoint_count -ne 1 ]]; then
    unverified "canonical block needs exactly one repository, base-branch and develop-checkpoint row (found $meta_repo_count/$meta_base_count/$meta_checkpoint_count)"
    return 1
  fi
  if [[ ${#canon_pr_numbers[@]} -eq 0 ]]; then
    unverified "canonical block lists no PR rows"
    return 1
  fi
  return 0
}

if ! parse_canonical_block; then
  emit_and_exit "SYNC_UNVERIFIED" "$EXIT_UNVERIFIED"
fi

if [[ ! "$canon_checkpoint" =~ $SHA_RE ]]; then
  unverified "canonical develop-checkpoint is not a 40-hex sha: $canon_checkpoint"
  emit_and_exit "SYNC_UNVERIFIED" "$EXIT_UNVERIFIED"
fi
if [[ -z "$canon_base_branch" || -z "$canon_repository" ]]; then
  unverified "canonical repository/base-branch record is empty"
  emit_and_exit "SYNC_UNVERIFIED" "$EXIT_UNVERIFIED"
fi

repo_slug="${repo_override:-$canon_repository}"
if [[ "$repo_slug" != "$canon_repository" ]]; then
  unverified "--repo '$repo_slug' does not match the canonical repository '$canon_repository'"
  emit_and_exit "SYNC_UNVERIFIED" "$EXIT_UNVERIFIED"
fi
base_ref="${base_ref_override:-origin/$canon_base_branch}"

log "bha-sync: repository $repo_slug"
log "bha-sync: snapshot   $snapshot_path"
log "bha-sync: base ref   $base_ref (canonical base branch: $canon_base_branch)"
log ""

# ---------------------------------------------------------------------------
# Live lifecycle
#
# One field per line with an explicit null sentinel. A tab-separated row cannot
# be used here: tab is an IFS whitespace character, so the empty merge fields of
# every OPEN/DRAFT/CLOSED PR collapse and shift the remaining columns left,
# which silently reclassified unmerged PRs as merged.
# ---------------------------------------------------------------------------

# Interpolates NULL_SENTINEL rather than repeating the literal, so the value the
# query emits and the value the validator compares against cannot drift apart.
readonly GH_JQ="[.state, .isDraft, .mergedAt, (.mergeCommit.oid // null), .baseRefName, .url]
  | map(if . == null then \"${NULL_SENTINEL}\" else tostring end)
  | .[]"

LIVE_STATE=""; LIVE_DRAFT=""; LIVE_MERGED_AT=""
LIVE_MERGE_SHA=""; LIVE_BASE=""; LIVE_URL=""; LIVE_LIFECYCLE=""

# Populates LIVE_*; returns 1 with a recorded reason if anything is missing,
# malformed or self-contradictory. Nothing is guessed.
fetch_live_pr() {
  local pr="$1" raw fields=()

  if ! raw="$(gh pr view "$pr" --repo "$repo_slug" \
        --json state,isDraft,mergedAt,mergeCommit,baseRefName,url \
        --jq "$GH_JQ" 2>/dev/null)"; then
    unverified "PR #$pr: GitHub lookup failed"
    return 1
  fi

  mapfile -t fields <<<"$raw"
  if [[ ${#fields[@]} -ne 6 ]]; then
    unverified "PR #$pr: expected 6 fields from GitHub, got ${#fields[@]}"
    return 1
  fi

  LIVE_STATE="${fields[0]}"; LIVE_DRAFT="${fields[1]}"; LIVE_MERGED_AT="${fields[2]}"
  LIVE_MERGE_SHA="${fields[3]}"; LIVE_BASE="${fields[4]}"; LIVE_URL="${fields[5]}"

  case "$LIVE_STATE" in
    OPEN|CLOSED|MERGED) ;;
    "$NULL_SENTINEL") unverified "PR #$pr: GitHub returned no state"; return 1 ;;
    *) unverified "PR #$pr: unknown state enum '$LIVE_STATE'"; return 1 ;;
  esac

  case "$LIVE_DRAFT" in
    true|false) ;;
    *) unverified "PR #$pr: isDraft is not a boolean ('$LIVE_DRAFT')"; return 1 ;;
  esac

  if [[ "$LIVE_BASE" == "$NULL_SENTINEL" || -z "$LIVE_BASE" ]]; then
    unverified "PR #$pr: baseRefName is missing"
    return 1
  fi

  if [[ "$LIVE_URL" == "$NULL_SENTINEL" || -z "$LIVE_URL" ]]; then
    unverified "PR #$pr: url is missing"
    return 1
  fi
  if [[ "$LIVE_URL" != */"$repo_slug"/pull/"$pr" ]]; then
    unverified "PR #$pr: url '$LIVE_URL' does not identify $repo_slug#$pr"
    return 1
  fi

  # Merge fields must agree with the state they belong to.
  if [[ "$LIVE_STATE" == "MERGED" ]]; then
    if [[ ! "$LIVE_MERGED_AT" =~ $ISO8601_RE ]]; then
      unverified "PR #$pr: MERGED but mergedAt is missing or malformed ('$LIVE_MERGED_AT')"
      return 1
    fi
    if [[ ! "$LIVE_MERGE_SHA" =~ $SHA_RE ]]; then
      unverified "PR #$pr: MERGED but merge commit is missing or malformed ('$LIVE_MERGE_SHA')"
      return 1
    fi
    LIVE_LIFECYCLE="MERGED"
  else
    if [[ "$LIVE_MERGED_AT" != "$NULL_SENTINEL" ]]; then
      unverified "PR #$pr: $LIVE_STATE but mergedAt is set ('$LIVE_MERGED_AT')"
      return 1
    fi
    if [[ "$LIVE_MERGE_SHA" != "$NULL_SENTINEL" ]]; then
      unverified "PR #$pr: $LIVE_STATE but a merge commit is set ('$LIVE_MERGE_SHA')"
      return 1
    fi
    if [[ "$LIVE_STATE" == "CLOSED" ]]; then
      LIVE_LIFECYCLE="CLOSED"
    elif [[ "$LIVE_DRAFT" == "true" ]]; then
      LIVE_LIFECYCLE="DRAFT"
    else
      LIVE_LIFECYCLE="OPEN"
    fi
  fi
  return 0
}

for i in "${!canon_pr_numbers[@]}"; do
  pr="${canon_pr_numbers[$i]}"
  c_base="${canon_pr_base[$i]}"
  c_life="${canon_pr_lifecycle[$i]}"
  c_sha="${canon_pr_merge_commit[$i]}"
  c_at="${canon_pr_merged_at[$i]}"

  case "$c_life" in
    MERGED|OPEN|DRAFT|CLOSED) ;;
    *) unverified "PR #$pr: canonical lifecycle '$c_life' is not a known value"; continue ;;
  esac

  # A canonical row must be internally consistent before it is worth comparing.
  if [[ "$c_life" == "MERGED" ]]; then
    if [[ ! "$c_sha" =~ $SHA_RE ]] || [[ ! "$c_at" =~ $ISO8601_RE ]]; then
      unverified "PR #$pr: canonical row claims MERGED without a valid merge commit and mergedAt"
      continue
    fi
  else
    if [[ "$c_sha" != "$SNAPSHOT_NULL" || "$c_at" != "$SNAPSHOT_NULL" ]]; then
      unverified "PR #$pr: canonical row is $c_life but carries merge evidence"
      continue
    fi
  fi

  fetch_live_pr "$pr" || continue
  checked_subjects=$((checked_subjects + 1))
  log "PR #$pr: snapshot=$c_life github=$LIVE_LIFECYCLE base=$LIVE_BASE  ($LIVE_URL)"

  # Base first: ancestry against a caller-supplied ref is meaningless if the PR
  # did not actually target the branch the canonical record says it did.
  if [[ "$c_base" != "$canon_base_branch" ]]; then
    unverified "PR #$pr: canonical base '$c_base' is not the canonical base branch '$canon_base_branch'"
    continue
  fi
  if [[ "$LIVE_BASE" != "$c_base" ]]; then
    drift "PR #$pr" "baseRefName" "$c_base" "$LIVE_BASE"
    continue
  fi

  if [[ "$c_life" != "$LIVE_LIFECYCLE" ]]; then
    drift "PR #$pr" "lifecycle" "$c_life" "$LIVE_LIFECYCLE"
    continue
  fi

  if [[ "$LIVE_LIFECYCLE" == "MERGED" ]]; then
    [[ "$c_sha" == "$LIVE_MERGE_SHA" ]] || drift "PR #$pr" "mergeCommit" "$c_sha" "$LIVE_MERGE_SHA"
    [[ "$c_at" == "$LIVE_MERGED_AT" ]] || drift "PR #$pr" "mergedAt" "$c_at" "$LIVE_MERGED_AT"

    if ! git -C "$repo_root" cat-file -e "${LIVE_MERGE_SHA}^{commit}" 2>/dev/null; then
      unverified "PR #$pr: merge commit $LIVE_MERGE_SHA not present locally (fetch $base_ref and re-run)"
    elif ! git -C "$repo_root" merge-base --is-ancestor "$LIVE_MERGE_SHA" "$base_ref" 2>/dev/null; then
      drift "PR #$pr" "mergeCommit contained by $base_ref" "assumed contained" "not an ancestor"
    fi
  fi
done

# ---------------------------------------------------------------------------
# Checkpoint — ancestor, not equality. See the header note on why equality is
# unsatisfiable for a document that records its own branch's history.
# ---------------------------------------------------------------------------

if ! live_head="$(git -C "$repo_root" rev-parse --verify "$base_ref^{commit}" 2>/dev/null)"; then
  unverified "cannot resolve $base_ref — run 'git fetch --prune origin' and re-run"
elif ! git -C "$repo_root" cat-file -e "${canon_checkpoint}^{commit}" 2>/dev/null; then
  unverified "canonical checkpoint $canon_checkpoint is not a commit in this repository"
else
  checked_subjects=$((checked_subjects + 1))
  if git -C "$repo_root" merge-base --is-ancestor "$canon_checkpoint" "$live_head" 2>/dev/null; then
    if [[ "$canon_checkpoint" == "$live_head" ]]; then
      log "checkpoint: ${canon_checkpoint:0:12} == $base_ref (${live_head:0:12})"
    else
      log "checkpoint: ${canon_checkpoint:0:12} is an ancestor of $base_ref (${live_head:0:12})"
    fi
  else
    drift "develop checkpoint" "ancestor of $base_ref" \
      "$canon_checkpoint" "not an ancestor of $live_head"
  fi
fi

# ---------------------------------------------------------------------------
# Verdict — unverified outranks drift: a run that could not verify everything
# may be hiding drift it never reached.
# ---------------------------------------------------------------------------

log ""
if [[ ${#unverified_reasons[@]} -gt 0 ]]; then
  emit_and_exit "SYNC_UNVERIFIED" "$EXIT_UNVERIFIED"
elif [[ ${#drift_rows[@]} -gt 0 ]]; then
  emit_and_exit "DRIFT_DETECTED" "$EXIT_DRIFT"
else
  emit_and_exit "SYNCHRONIZED" "$EXIT_SYNCHRONIZED"
fi
