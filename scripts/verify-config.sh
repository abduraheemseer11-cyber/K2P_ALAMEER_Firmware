#!/usr/bin/env bash
# verify-config.sh <openwrt-src>
# Check the final .config against config/required-symbols.txt.
#   R SYMBOL   -> must be present verbatim (required)
#   O SYMBOL   -> optional, warn only
#   # ...      -> comment
set -uo pipefail
SRC="${1:?openwrt source dir}"
LIST="$(dirname "$0")/../config/required-symbols.txt"

[[ -f "$SRC/.config" ]] || { echo "FAIL: $SRC/.config not found (did 'make defconfig' run?)"; exit 2; }
[[ -f "$LIST" ]]        || { echo "FAIL: required-symbols list not found: $LIST"; exit 2; }

fail=0
ok=0

while IFS= read -r line || [[ -n "$line" ]]; do
  # strip leading whitespace
  line="${line#"${line%%[![:space:]]*}"}"
  # skip blank lines and comments
  [[ -z "$line" || "$line" == \#* ]] && continue

  kind="${line%%[[:space:]]*}"
  rest="${line#*[[:space:]]}"
  # strip trailing comment from the symbol field
  sym="${rest%%[[:space:]]#*}"
  sym="${sym%%[[:space:]]*}"

  if [[ -z "$sym" ]]; then
    printf '  [warn] malformed line: kind=%s sym=empty\n' "$kind"
    continue
  fi

  case "$kind" in
    R|r)
      if grep -Fqx -- "$sym" "$SRC/.config"; then
        printf '  [ ok ] %s\n' "$sym"; ok=$((ok+1))
      else
        printf '  [FAIL] %s  (required, not in final .config)\n' "$sym"; fail=1
      fi
      ;;
    O|o)
      if grep -Fqx -- "$sym" "$SRC/.config"; then
        printf '  [ ok ] %s\n' "$sym"; ok=$((ok+1))
      else
        printf '  [warn] %s  (optional, not available in this tree)\n' "$sym"
      fi
      ;;
    *)
      printf '  [warn] unknown kind "%s" for %s (use R or O)\n' "$kind" "$sym"
      ;;
  esac
done < "$LIST"

printf '\n== summary: %d ok, %s\n' "$ok" \
  "$([[ $fail -eq 0 ]] && echo 'all required present' || echo 'missing required symbols')"
exit $fail