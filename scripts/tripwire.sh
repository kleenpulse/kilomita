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

# Every node command in a script must run exactly one .ts file, with only the flags listed here.
# NODE_OPTIONS is refused outright: it can load code (--import=data:...) with no file to scan.
raw=$(git grep --untracked -nE "NODE_OPTIONS|(^|[^[:alnum:]_./@-])node([.]exe)?[[:space:]]" -- '*package.json')
require_scan_ok "package.json node scripts" "$?"
hits=$(printf '%s\n' "$raw" | awk '
  # The first node command in text that breaks the rule, or "".
  # Where the command in rest ends: its JSON string closing, or a ) or backtick closing a
  # subshell, whichever comes first; 0 if none.
  function stop(rest,   at, i, c) {
    at = 0
    for (i = 1; i <= 3; i++) {
      c = index(rest, substr("\")`", i, 1))
      if (c && (!at || c < at)) at = c
    }
    return at
  }
  function bad(text,   rest, end, args, words, n, i, files, file) {
    # Same boundary as the git grep above, so every selected line is judged.
    while (match(text, /(^|[^[:alnum:]_.\/@-])node([.]exe)?[[:space:]]+/)) {
      rest = substr(text, RSTART + RLENGTH)
      end = stop(rest)
      args = end ? substr(rest, 1, end - 1) : rest
      text = end ? substr(rest, end + 1) : ""
      n = split(args, words, /[[:space:]]+/)
      files = 0
      for (i = 1; i <= n; i++) {
        if (words[i] == "") continue
        if (words[i] == "--watch" || words[i] == "--disable-warning=ExperimentalWarning") continue
        if (words[i] ~ /^-/) return "node " args
        files++
        file = words[i]
      }
      if (!(files == 1 && file ~ /[.]ts$/)) return "node " args
    }
    return ""
  }
  {
    match($0, /^[^:]*:[0-9]+:/)
    where = substr($0, 1, RLENGTH)
    if ($0 ~ /NODE_OPTIONS/) { print where "NODE_OPTIONS"; next }
    line = substr($0, RLENGTH + 1)
    gsub(/\\n/, ";", line)
    n = split(line, commands, /&&|[|][|]|[&;|]/)
    for (j = 1; j <= n; j++) {
      found = bad(commands[j])
      if (found != "") { print where found; next }
    }
  }')
report "package.json script runs node on anything but one TypeScript file" "$hits"

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
