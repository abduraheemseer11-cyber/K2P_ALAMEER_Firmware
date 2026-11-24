#!/usr/bin/env bash
# verify-config.sh <openwrt-src>  - check the final .config (after `make defconfig`) against config/required-symbols.txt
set -uo pipefail
SRC="${1:?openwrt source dir}"; LIST="$(dirname "$0")/../config/required-symbols.txt"
fail=0
while read -r kind sym; do
  [[ -z "${kind:-}" || "$kind" == \#* ]] && continue
  if grep -qx -- "$sym" "$SRC/.config"; then printf '  [ ok ] %s\n' "$sym"
  elif [[ "$kind" == R ]]; then printf '  [FAIL] %s  (required, not in final .config)\n' "$sym"; fail=1
  else printf '  [warn] %s  (optional, not available in this tree)\n' "$sym"; fi
done < "$LIST"
exit $fail
