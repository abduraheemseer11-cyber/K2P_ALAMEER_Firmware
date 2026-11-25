#!/usr/bin/env bash
# =====================================================================
#  WrtMax Firmware Solutions - Phicomm K2P  FULL SOURCE BUILD
#  git clone openwrt (tag v23.05.5) + feeds + patches + make
#  Usage:  ./build.sh            full build
#          ./build.sh prepare    stop after defconfig + config verification
#  Env:    OPENWRT_TAG (v23.05.5)  OPENWRT_REPO  JOBS
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$PWD"
OPENWRT_REPO="${OPENWRT_REPO:-https://github.com}"
OPENWRT_TAG="${OPENWRT_TAG:-v23.05.5}"
JOBS="${JOBS:-$(nproc)}"
WRTMAX_VERSION="2.0.0"
WORK="$ROOT/work"; SRC="$WORK/openwrt"; OUT="$ROOT/output"
MODE="${1:-all}"

say() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }
mk()  { make -C "$SRC" "$@"; }

mkdir -p "$WORK" "$ROOT/dl" "$ROOT/.ccache"
rm -rf "$OUT"; mkdir -p "$OUT/source-patches"

# ---------------------------------------------------------------- 1. source
if [[ ! -d "$SRC/.git" ]]; then
  say "Cloning $OPENWRT_REPO @ $OPENWRT_TAG"
  git clone --depth 1 --branch "$OPENWRT_TAG" "$OPENWRT_REPO" "$SRC"
fi

# Robust tag verification: works with annotated + lightweight tags, shallow clones
HEAD_SHA="$(git -C "$SRC" rev-parse -q --verify HEAD 2>/dev/null || true)"
TAG_SHA="$(git -C "$SRC" rev-parse -q --verify "refs/tags/${OPENWRT_TAG}^{commit}" 2>/dev/null || true)"
if [[ -z "$TAG_SHA" || "$HEAD_SHA" != "$TAG_SHA" ]]; then
  ACTUAL="$(git -C "$SRC" describe --tags --always 2>/dev/null || echo 'unknown')"
  die "source tree is not at $OPENWRT_TAG (HEAD=$ACTUAL)"
fi
say "source tree verified at $OPENWRT_TAG ($HEAD_SHA)"

# caches live outside the source tree so CI can persist them
rm -rf "$SRC/dl" "$SRC/.ccache"
ln -sfn "$ROOT/dl" "$SRC/dl"
ln -sfn "$ROOT/.ccache" "$SRC/.ccache"
export CCACHE_DIR="$ROOT/.ccache" CCACHE_MAXSIZE=4G

say "Feeds"
( cd "$SRC" && ./scripts/feeds update -a && ./scripts/feeds install -a )

# ---------------------------------------------------------------- 2. WrtMax package + tree patches
say "Adding package/wrtmax (wrtmax-loopguard)"
rm -rf "$SRC/package/wrtmax"; cp -a package/wrtmax "$SRC/package/wrtmax"

say "Applying tree patches"
shopt -s nullglob
patches=(patches/*.patch)
if (( ${#patches[@]} == 0 )); then
  die "no patches found in patches/*.patch"
fi
for p in "${patches[@]}"; do
  if git -C "$SRC" apply -R --check "$ROOT/$p" 2>/dev/null; then
    echo "  already applied: $p"
  elif git -C "$SRC" apply --check "$ROOT/$p"; then
    git -C "$SRC" apply "$ROOT/$p"; echo "  applied: $p"
  else
    die "patch does not apply to $OPENWRT_TAG: $p"
  fi
done
shopt -u nullglob

# make the wrtmax helper scripts executable IF their dirs exist (patch-created)
for f in "$SRC"/package/firmware/wireless-regdb/wrtmax/*.sh \
         "$SRC"/package/firmware/wireless-regdb/wrtmax/*.py \
         "$SRC"/package/kernel/mac80211/wrtmax/*.py; do
  [[ -f "$f" ]] && chmod +x "$f"
done

say "Kernel config fragment -> target/linux/ramips/mt7621/config-5.15"
KC="$SRC/target/linux/ramips/mt7621/config-5.15"
FRAG_FILE="config/kernel-5.15.fragment"
[[ -f "$KC" ]]        || die "$KC not found - this tag does not use kernel 5.15"
[[ -f "$FRAG_FILE" ]] || die "$FRAG_FILE missing in repo"

MARKER="# WrtMax kernel fragment applied"
if ! grep -qF "$MARKER" "$KC"; then
  # drop symbols already present so the fragment wins, then append
  grep -E '^CONFIG_[A-Z0-9_]+=' "$FRAG_FILE" | sed 's/=.*//' | while read -r s; do
    sed -i "/^# $s is not set\$/d; /^$s=/d" "$KC"
  done
  { echo ""; echo "$MARKER"; cat "$FRAG_FILE"; } >> "$KC"
fi

# ---------------------------------------------------------------- 3. .config
say "Writing .config (seed + packages) and running defconfig"
cat config/seed.config config/packages.config > "$SRC/.config"
if grep -q 'ucode-mod-socket' "$SRC/package/utils/ucode/Makefile" 2>/dev/null; then
  echo 'CONFIG_PACKAGE_ucode-mod-socket=y' >> "$SRC/.config"
else
  echo "  note: ucode-mod-socket not in this tree - MNDP announcer disabled (lldpd still works)"
fi

mk defconfig

say "Verifying final .config"
chmod +x scripts/*.sh
scripts/verify-config.sh "$SRC" || die "required symbols missing from the final .config (see above)"

if [[ "$MODE" == "prepare" ]]; then
  say "prepare-only run finished"
  exit 0
fi

# ---------------------------------------------------------------- 4. rootfs overlay
say "Staging files/ overlay"
STAGE="$SRC/files"; rm -rf "$STAGE"; mkdir -p "$STAGE"; cp -a files/. "$STAGE/"
for d in etc/uci-defaults etc/init.d usr/sbin usr/libexec/rpcd www/cgi-bin lib/wrtmax; do
  if [[ -d "$STAGE/$d" ]]; then
    find "$STAGE/$d" -type f -exec chmod 0755 {} +
  fi
done
# strip CRLF from text files only, leaving binaries intact
find "$STAGE" -type f ! -name '*.png' ! -name '*.bin' ! -name '*.so*' \
  ! -name '*.db' ! -name '*.ipk' -exec sed -i 's/\r$//' {} + 2>/dev/null || true
find "$STAGE" -name '.gitkeep' -delete 2>/dev/null || true
cat > "$STAGE/etc/wrtmax_release" <<REL
WRTMAX_VERSION='$WRTMAX_VERSION'
WRTMAX_OPENWRT='${OPENWRT_TAG#v}'
WRTMAX_BUILD='$(date -u +%Y-%m-%d)'
WRTMAX_DEVICE='Phicomm K2P'
WRTMAX_SUPPORT='776 538 297'
REL

# ---------------------------------------------------------------- 5. toolchain, then source-level regulatory work
say "Building tools + toolchain"
mk -j"$JOBS" tools/install toolchain/install

say "Super Channel: rebuild regulatory.db with the CT domain"
mk package/firmware/wireless-regdb/download package/firmware/wireless-regdb/prepare
RB="$(find "$SRC/build_dir" -maxdepth 3 -type d -name 'wireless-regdb-*' 2>/dev/null | head -1 || true)"
[[ -n "$RB" ]] || die "wireless-regdb build dir not found after prepare"
[[ -x "$SRC/package/firmware/wireless-regdb/wrtmax/build-regdb.sh" ]] \
  || die "build-regdb.sh missing - tree patch did not apply cleanly"
"$SRC/package/firmware/wireless-regdb/wrtmax/build-regdb.sh" "$RB" \
  || die "could not add the CT domain to regulatory.db"
cp "$RB/db.txt" "$OUT/source-patches/wireless-regdb-db.txt"
mkdir -p "$STAGE/lib/firmware"
cp "$RB/regulatory.db" "$STAGE/lib/firmware/regulatory.db"
mk package/firmware/wireless-regdb/compile

say "Super Channel: allow the locally built (unsigned) regulatory.db in cfg80211"
mk package/kernel/mac80211/download package/kernel/mac80211/prepare
BP="$(find "$SRC/build_dir" -maxdepth 4 -type d -name 'backports-*' 2>/dev/null | head -1 || true)"
if [[ -n "$BP" ]]; then
  python3 "$SRC/package/kernel/mac80211/wrtmax/unsigned-regdb.py" "$BP" \
    --diff-out "$OUT/source-patches/cfg80211-unsigned-regdb.diff" \
    || echo "WARNING: unsigned-regdb.py could not edit this tree (exit $?) - kernel check below decides"
else
  echo "WARNING: backports source dir not found"
fi

# ---------------------------------------------------------------- 6. full build
say "Downloading sources"
mk -j"$JOBS" download

say "Compiling firmware ($JOBS jobs) - this takes 1-3 hours on a cold cache"
if ! mk -j"$JOBS"; then
  say "Parallel build failed - retrying single-threaded with full log (last 200 lines shown)"
  mk -j1 V=s 2>&1 | tee /tmp/build-fail.log | tail -n 200 || true
  die "build failed - see /tmp/build-fail.log and the log above"
fi

# ---------------------------------------------------------------- 7. verification + output
say "Verifying what was really built"
scripts/verify-kernel.sh "$SRC" "$OUT/kernel-feature-report.txt" \
  || die "kernel feature verification failed (see report)"

if [[ -f "$STAGE/lib/firmware/regulatory.db" ]]; then
  python3 scripts/regdb-has-country.py "$STAGE/lib/firmware/regulatory.db" CT \
    | tee -a "$OUT/kernel-feature-report.txt" \
    || die "CT country missing from regulatory.db"
else
  echo "  (regulatory.db not found - skipped)"
fi

scripts/check-image.sh "$SRC" "$OUT" || die "image size check failed"
cp "$SRC/.config" "$OUT/final.config"

say "DONE - firmware: output/WrtMax-K2P-v2-sysupgrade.bin"