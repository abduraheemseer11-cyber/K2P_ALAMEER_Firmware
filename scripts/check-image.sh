#!/usr/bin/env bash
# check-image.sh <openwrt-src> <outdir>
# Find the K2P sysupgrade image, enforce the flash budget, copy artefacts.
set -uo pipefail
SRC="${1:?}"; OUT="${2:?}"

# K2P firmware partition = 15744 KiB (see target/linux/ramips/image/mt7621.mk).
# Read it from the tree if possible, fall back to the known constant.
PART_KB="$(awk -F'[:= ]+' \
  '/Device\/phicomm_k2p/{in_dev=1} in_dev && /IMAGE_SIZE/{print $0; exit}' \
  "$SRC/target/linux/ramips/image/mt7621.mk" 2>/dev/null \
  | grep -oE '[0-9]+k' | head -1 | tr -d 'k' || true)"
PART_KB="${PART_KB:-15744}"
PART=$(( PART_KB * 1024 ))

# Safety budget: 512 KiB below the partition size.
LIMIT=$(( PART - 512 * 1024 ))

IMG="$(ls "$SRC"/bin/targets/ramips/mt7621/*phicomm_k2p*sysupgrade.bin 2>/dev/null | head -1 || true)"
if [[ -z "$IMG" || ! -f "$IMG" ]]; then
  echo "FAIL: sysupgrade image not found in bin/targets/ramips/mt7621"
  ls -la "$SRC/bin/targets/ramips/mt7621" 2>/dev/null || true
  exit 2
fi

SZ=$(stat -c %s "$IMG")
SZ_MIB="$(awk -v s="$SZ" 'BEGIN{printf "%.2f", s/1048576}')"
PART_MIB="$(awk -v s="$PART" 'BEGIN{printf "%.2f", s/1048576}')"
LIMIT_MIB="$(awk -v s="$LIMIT" 'BEGIN{printf "%.2f", s/1048576}')"

printf 'image : %s\n'                "$(basename "$IMG")"
printf 'size  : %d bytes (%s MiB)\n' "$SZ" "$SZ_MIB"
printf 'budget: %d bytes (%s MiB, partition %d KiB minus 512 KiB)\n' \
       "$LIMIT" "$LIMIT_MIB" "$PART_KB"
printf 'flash : %d bytes (%s MiB)\n' "$PART" "$PART_MIB"
printf 'head-room to budget: %d bytes\n' "$((LIMIT - SZ))"

if (( SZ > PART ));  then echo "FAIL: larger than the flash partition ($PART_MIB MiB)"; exit 1; fi
if (( SZ > LIMIT )); then echo "FAIL: exceeds the ${LIMIT_MIB} MiB budget - remove packages in config/packages.config"; exit 1; fi
if (( SZ > 13 * 1024 * 1024 )); then
  echo "WARN: > 13 MiB - the rootfs_data (overlay) will be small"
fi

mkdir -p "$OUT"
cp "$IMG" "$OUT/WrtMax-K2P-v2-sysupgrade.bin"

shopt -s nullglob
for m in "$SRC"/bin/targets/ramips/mt7621/*phicomm_k2p*.manifest; do
  [[ -f "$m" ]] && cp "$m" "$OUT/WrtMax-K2P-v2.manifest"
done

# checksum of the firmware we just copied (explicit name, not a glob)
(
  cd "$OUT" || exit 1
  if [[ -f WrtMax-K2P-v2-sysupgrade.bin ]]; then
    sha256sum -- WrtMax-K2P-v2-sysupgrade.bin > sha256sums.txt
    cat sha256sums.txt
  else
    echo "WARN: firmware copy missing - no checksum generated"
  fi
)

exit 0