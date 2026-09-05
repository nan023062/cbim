#!/usr/bin/env bash
# CBIM bootstrap installer.
# Run from your project root:
#   curl -sSL https://raw.githubusercontent.com/nan023062/cbim/master/install.sh | bash
# Or after `git clone`:
#   bash install.sh
#
# Effect (idempotent):
#   - clones cbim master into a tempdir
#   - replaces <project>/.cbim/kernel/ with v1/kernel/ (flat layout) atomically
#   - runs `python -m engine init` to (re)populate .cbim/, .claude/, CLAUDE.md, .gitignore
# Preserved across re-runs: .cbim/memory/, .cbim/config.json, .dna/.
# Runs in any POSIX bash (Linux, macOS, WSL, Windows Git Bash / MINGW64).
# On Windows, launch from Git Bash; cmd.exe and PowerShell are not entry points.

set -euo pipefail

REPO_URL="https://github.com/nan023062/cbim"
PROJECT_ROOT="$(pwd)"

log() { printf '[CBIM] %s\n' "$*" >&2; }
die() { printf '[CBIM] error: %s\n' "$*" >&2; exit 1; }

# --- 1. dependency probe ---
command -v git >/dev/null 2>&1 || die "git not found on PATH"

# Probe Python interpreter candidates in priority order. A candidate is only
# accepted if it can actually execute a tiny version-check script — this
# rejects the Microsoft Store App Execution Alias placeholder (a 0-byte stub
# named python3.exe that pops the Store on launch), which `command -v` happily
# reports as "found" but cannot run any code.
#
# Each candidate is stored as a bash array of argv tokens. We invoke as
# `"${PYTHON_ARGV[@]}" ...` everywhere — never via `eval` — so the candidate
# can carry args (e.g. `py -3`) without quoting hazards on the script body.
PYTHON_ARGV=()
PYTHON_TRIED=""

# Candidates in priority order; each is a single string we split on whitespace.
PY_CANDIDATES=("python3" "python" "py -3")

_try_python() {
  # $@: candidate argv tokens. Returns 0 if the candidate behaves like a
  # working Python >= 3.10, non-zero otherwise. Stderr is muted so the Store
  # stub's "Python was not found" chatter doesn't leak; we still print a
  # clean aggregate error if every candidate fails.
  "$@" -c 'import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)' \
    >/dev/null 2>&1
}

for cand in "${PY_CANDIDATES[@]}"; do
  # Split candidate string into argv tokens.
  # shellcheck disable=SC2206
  argv=($cand)
  PYTHON_TRIED="$PYTHON_TRIED ${argv[*]}"
  # Resolve the head executable; skip if not on PATH at all.
  command -v "${argv[0]}" >/dev/null 2>&1 || continue
  if _try_python "${argv[@]}"; then
    PYTHON_ARGV=("${argv[@]}")
    break
  fi
done

if [ "${#PYTHON_ARGV[@]}" -eq 0 ]; then
  die "no usable Python >= 3.10 found (tried:$PYTHON_TRIED). Install from https://www.python.org/downloads/ ; on Windows the Python launcher \`py -3\` also works. The Microsoft Store \`python3\` alias is a placeholder and is not usable — disable it in Settings > Apps > App execution aliases, or install real Python."
fi

PYTHON_DISPLAY="${PYTHON_ARGV[*]}"

# --- 2. pre-flight gate: confirm Python can do what engine init needs ---
# This runs BEFORE any destructive write. If Python is somehow only
# half-working (e.g. venv module disabled in a stripped distro), we fail
# here, while .cbim/kernel/ is still intact.
"${PYTHON_ARGV[@]}" -m venv --help >/dev/null 2>&1 \
  || die "$PYTHON_DISPLAY cannot run \`-m venv\` — Python venv module missing or broken"
"${PYTHON_ARGV[@]}" -c 'import sys; assert sys.version_info >= (3,10)' >/dev/null 2>&1 \
  || die "$PYTHON_DISPLAY failed re-check for >= 3.10"

# --- 3. tempdir clone + atomic replacement state ---
TMPDIR_CBIM="$(mktemp -d 2>/dev/null || mktemp -d -t cbim)"
DST_KERNEL="$PROJECT_ROOT/.cbim/kernel"
DST_KERNEL_NEW="$PROJECT_ROOT/.cbim/kernel.new"
DST_KERNEL_OLD="$PROJECT_ROOT/.cbim/kernel.old"
SWAPPED=0  # set to 1 once kernel.new -> kernel rename has happened

cleanup() {
  # Always purge tempdir.
  rm -rf "$TMPDIR_CBIM" 2>/dev/null || true
  # Always purge an unfinished kernel.new (only meaningful if we never swapped).
  rm -rf "$DST_KERNEL_NEW" 2>/dev/null || true
  # If the swap happened, we keep .old around until engine init succeeds;
  # the success path below removes it explicitly. On failure after swap,
  # roll back: restore .old to live, drop the new (failed) kernel.
  if [ "$SWAPPED" = "1" ] && [ "${INSTALL_OK:-0}" != "1" ]; then
    if [ -d "$DST_KERNEL_OLD" ]; then
      rm -rf "$DST_KERNEL" 2>/dev/null || true
      mv "$DST_KERNEL_OLD" "$DST_KERNEL" 2>/dev/null || true
      printf '[CBIM] rolled back to previous kernel after failure\n' >&2
    fi
  fi
}
trap cleanup EXIT

log "cloning $REPO_URL ..."
git clone --depth 1 "$REPO_URL" "$TMPDIR_CBIM/cbim" >/dev/null 2>&1 \
  || die "git clone failed"

SRC_KERNEL="$TMPDIR_CBIM/cbim/v1/kernel"
[ -d "$SRC_KERNEL" ] || die "kernel source missing in clone: $SRC_KERNEL"

# --- 4. stage new kernel into a sibling, then atomic rename ---
log "staging kernel into $DST_KERNEL_NEW ..."
mkdir -p "$PROJECT_ROOT/.cbim"
rm -rf "$DST_KERNEL_NEW"
mkdir -p "$DST_KERNEL_NEW"
# trailing /. copies contents of kernel/, not the directory itself
cp -R "$SRC_KERNEL/." "$DST_KERNEL_NEW/"

log "swapping in new kernel ..."
# Park any previous kernel as .old (rollback target), then promote .new to live.
rm -rf "$DST_KERNEL_OLD"
if [ -d "$DST_KERNEL" ]; then
  mv "$DST_KERNEL" "$DST_KERNEL_OLD"
fi
mv "$DST_KERNEL_NEW" "$DST_KERNEL"
SWAPPED=1

# --- 5. run engine init ---
log "running engine init ..."
log "(first install builds a managed venv at .cbim/.venv/)"
cd "$PROJECT_ROOT"
PYTHONPATH="$DST_KERNEL" "${PYTHON_ARGV[@]}" -m engine init

# Mark success so the trap stops considering rollback, then drop .old.
INSTALL_OK=1
rm -rf "$DST_KERNEL_OLD" 2>/dev/null || true

# --- 6. done ---
log "installed. Restart Claude Code to load the updated project Skills."
