#!/bin/sh
# Fails if the repo contains markers of the self-propagating worm that hit this
# maintainer's machine in 2026-10 (injected config loaders, folder-open tasks,
# disguised droppers). Patterns are written with character classes so this file
# never matches itself.
#
# Usage:
#   sh scripts/tripwire.sh                             scan tracked + untracked (non-ignored) files
#   TRIPWIRE_TARGET=/some/dir sh scripts/tripwire.sh   scan only file contents under a non-git dir
#   TRIPWIRE_EXTRA_PATTERN='<ERE>'                     add one more content pattern to either mode
#
# Exit codes: 0 clean, 1 markers found, 2 the scan itself could not run.
# Any scan error exits 2 so the tripwire never reports "clean" by accident.

set -u

Q="['\"\`]"
S="[[:space:]]*"

CONTENT_PATTERNS="
4738-[2]
3379-[6]
A11--[#]
RS26060[5]
_t_[s]
node${S} api[.]js
193[.]247[.]144
166[.]88[.]134
global(This)?${S}(\\[${S}${Q}!|[.]${S}!)
global(This)?${S}([.]${S}i|\\[${S}${Q}i${Q}${S}\\])${S}=${S}${Q}A
${TRIPWIRE_EXTRA_PATTERN:-}
"

failed=0

report() {
  if [ -n "$2" ]; then
    printf 'TRIPWIRE: %s\n%s\n\n' "$1" "$2"
    failed=1
  fi
}

# git grep and git ls-files exit 0 on match, 1 on no match, anything else on error.
require_scan_ok() {
  if [ "$2" -gt 1 ]; then
    echo "tripwire: scan failed: $1 (exit $2)" >&2
    exit 2
  fi
}

pattern_args() {
  printf '%s\n' "$CONTENT_PATTERNS" | while IFS= read -r pattern; do
    [ -n "$pattern" ] && printf '%s\n' "$pattern"
  done
}

if [ -n "${TRIPWIRE_TARGET:-}" ]; then
  cd "$TRIPWIRE_TARGET" || exit 2
  hits=$(pattern_args | git grep --no-index -nE -f -)
  require_scan_ok "content markers in $TRIPWIRE_TARGET" "$?"
  report "worm markers in $TRIPWIRE_TARGET" "$hits"
  [ "$failed" -eq 0 ] && echo "tripwire: clean ($TRIPWIRE_TARGET)"
  exit "$failed"
fi

root=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "tripwire: not a git work tree. To scan a plain directory use TRIPWIRE_TARGET=<dir>." >&2
  exit 2
}
cd "$root" || exit 2

hits=$(pattern_args | git grep --untracked -nE -f -)
require_scan_ok "content markers" "$?"
report "worm markers or loader keys in file contents" "$hits"

hits=$(git ls-files --cached --others --exclude-standard -- '*.js' '*.cjs' '*.mjs')
require_scan_ok "JavaScript file listing" "$?"
report "JavaScript files are not allowed (TypeScript only)" "$hits"

raw=$(git grep --untracked -noE "(^|[^[:alnum:]_./-])node[[:space:]]+[^-[:space:]\"&|;][^[:space:]\"&|;]*" -- '*package.json')
require_scan_ok "package.json node scripts" "$?"
hits=$(printf '%s\n' "$raw" | grep -vE "node[[:space:]]+[^[:space:]\"&|;]+[.]ts$")
report "package.json script runs node on a non-TypeScript file" "$hits"

hits=$(git grep --untracked -nE 'branch_structure[.]json|temp_auto_push[.]bat|temp_interactive_push[.]bat' -- '*.gitignore')
require_scan_ok ".gitignore entries" "$?"
report ".gitignore hides worm push artifacts" "$hits"

hits=$(git grep --untracked -nE 'folderOpe[n]' -- '*tasks.json')
require_scan_ok "editor tasks" "$?"
report "editor task runs on folder open" "$hits"

hits=$(git grep --untracked -nE "allowAutomaticTasks\"?${S}:${S}(true|\"on\")" -- '*settings.json')
require_scan_ok "editor settings" "$?"
report "editor settings allow automatic tasks" "$hits"

if [ "$failed" -ne 0 ]; then
  echo "tripwire: FAILED. Do not commit, pull or open this folder in an editor until checked." >&2
  exit 1
fi

echo "tripwire: clean"
