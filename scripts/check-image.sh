#!/usr/bin/env bash
# check-image.sh <openwrt-src> <outdir>  - find the K2P sysupgrade image, enforce the flash budget
set -uo pipefail
SRC="${1:?}"; OUT="${2:?}"

LIMIT=$(( 152 * 1024 * 1024 / 10 ))   # 15.2 MiB budget
PART=$(( 15744 * 1024 ))              # firmware partition of K2P in OpenWrt (IMAGE_SIZE 15744k)

IMG="$(ls "$SRC"/bin/targets/ramips/mt7621/*phicomm_k2p*sysupgrade.bin 2>/dev/null | head -1 || true)"
if [[ -z "$IMG" || ! -f "$IMG" ]]; then
  echo "FAIL: sysupgrade image not found in bin/targets/ramips/mt7621"
  ls -la "$SRC/bin/targets/ramips/mt7621" 2>/dev/null || true
  exit 2
fi

SZ=$(stat -c %s "$IMG")
SZ_MIB="$(awk -v s="$SZ" 'BEGIN{printf "%.2f", s/1048576}')"
PART_MIB="$(awk -v s="$PART" 'BEGIN{printf "%.2f", s/1048576}')"

printf 'image : %s\n'           "$(basename "$IMG")"
printf 'size  : %d bytes (%s MiB)\n' "$SZ" "$SZ_MIB"
printf 'budget: %d bytes (15.2 MiB)\n' "$LIMIT"
printf 'flash : %d bytes (%s MiB)\n' "$PART" "$PART_MIB"
printf 'head-room to budget: %d bytes\n' "$((LIMIT - SZ))"

if (( SZ > PART ));  then echo "FAIL: larger than the flash partition"; exit 1; fi
if (( SZ > LIMIT )); then echo "FAIL: exceeds the 15.2 MiB budget - remove packages in config/packages.config"; exit 1; fi
if (( SZ > 13 * 1024 * 1024 )); then
  echo "WARN: > 13 MiB - the JFFS2 overlay (settings storage) will be small"
fi

mkdir -p "$OUT"
cp "$IMG" "$OUT/WrtMax-K2P-v2-sysupgrade.bin"

shopt -s nullglob
for m in "$SRC"/bin/targets/ramips/mt7621/*phicomm_k2p*.manifest; do
  [[ -f "$m" ]] && cp "$m" "$OUT/WrtMax-K2P-v2.manifest"
done

# checksums
( cd "$OUT" && shopt -s nullglob && bins=( *.bin ) && \
  if (( ${#bins[@]} > 0 )); then sha256sum -- "${bins[@]}" > sha256sums.txt; cat sha256sums.txt; fi )

exit 0