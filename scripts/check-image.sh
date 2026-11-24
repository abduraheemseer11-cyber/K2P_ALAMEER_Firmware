#!/usr/bin/env bash
# check-image.sh <openwrt-src> <outdir>  - find the K2P sysupgrade image, enforce the flash budget
set -uo pipefail
SRC="${1:?}"; OUT="${2:?}"
LIMIT=$(( 152 * 1024 * 1024 / 10 ))   # 15.2 MiB budget requested for kernel+squashfs
PART=$(( 15744 * 1024 ))              # firmware partition of the K2P in OpenWrt (IMAGE_SIZE 15744k)
IMG="$(ls "$SRC"/bin/targets/ramips/mt7621/*phicomm_k2p*sysupgrade.bin 2>/dev/null | head -1)"
[[ -f "$IMG" ]] || { echo "sysupgrade image not found in bin/targets/ramips/mt7621"; ls -la "$SRC/bin/targets/ramips/mt7621" 2>/dev/null; exit 2; }
SZ=$(stat -c %s "$IMG")
printf 'image: %s\nsize : %d bytes (%.2f MiB)\nbudget: %d bytes (15.2 MiB)   flash partition: %d bytes (%.2f MiB)\nhead-room to budget: %d bytes\n' \
  "$(basename "$IMG")" "$SZ" "$(echo "$SZ/1048576" | bc -l)" "$LIMIT" "$PART" "$(echo "$PART/1048576" | bc -l)" "$((LIMIT-SZ))"
if (( SZ > PART )); then echo "FAIL: larger than the flash partition"; exit 1; fi
if (( SZ > LIMIT )); then echo "FAIL: exceeds the 15.2 MiB budget - remove packages in config/packages.config"; exit 1; fi
if (( SZ > 13 * 1024 * 1024 )); then echo "WARN: > 13 MiB - the JFFS2 overlay (settings storage) will be small"; fi
mkdir -p "$OUT"; cp "$IMG" "$OUT/WrtMax-K2P-v2-sysupgrade.bin"
for m in "$SRC"/bin/targets/ramips/mt7621/*phicomm_k2p*.manifest; do [[ -f "$m" ]] && cp "$m" "$OUT/WrtMax-K2P-v2.manifest"; done
( cd "$OUT" && sha256sum *.bin > sha256sums.txt && cat sha256sums.txt )
exit 0
