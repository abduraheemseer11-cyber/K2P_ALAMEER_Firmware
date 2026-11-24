#!/usr/bin/env bash
# verify-config.sh <openwrt-src>  - check the final .config against config/required-symbols.txt
set -uo pipefail
SRC="${1:?openwrt source dir}"
LIST="$(dirname "$0")/../config/required-symbols.txt"

[[ -f "$SRC/.config" ]] || { echo "FAIL: $SRC/.config not found (did 'make defconfig' run?)"; exit 2; }
[[ -f "$LIST" ]]        || { echo "FAIL: required-symbols list not found: $LIST"; exit 2; }

fail=0
while read -r kind sym; do
  [[ -z "${kind:-}" || "$kind" == \#* ]] && continue
  [[ -z "${sym:-}" ]] && continue
  if grep -Fqx -- "$sym" "$SRC/.config"; then
    printf '  [ ok ] %s\n' "$sym"
  elif [[ "$kind" == "R" ]]; then
    printf '  [FAIL] %s  (required, not in final .config)\n' "$sym"
    fail=1
  else
    printf '  [warn] %s  (optional, not available in this tree)\n' "$sym"
  fi
done < "$LIST"
exit $fail