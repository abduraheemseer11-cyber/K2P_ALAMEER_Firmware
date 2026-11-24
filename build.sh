#!/usr/bin/env bash
# =====================================================================
#  WrtMax Firmware Solutions - Phicomm K2P  FULL SOURCE BUILD
#  git clone openwrt (tag v23.05.5) + feeds + patches + make
#  Usage:  ./build.sh            full build
#          ./build.sh prepare    stop after defconfig + config verification (fast sanity check)
#  Env:    OPENWRT_TAG (v23.05.5)  OPENWRT_REPO  JOBS  WRTMAX_ALLOW_SIGNED_REGDB=1 (do not fail on signed regdb)
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$PWD"
OPENWRT_REPO="${OPENWRT_REPO:-https://github.com/openwrt/openwrt.git}"
OPENWRT_TAG="${OPENWRT_TAG:-v23.05.5}"
JOBS="${JOBS:-$(nproc)}"
WRTMAX_VERSION="2.0.0"
WORK="$ROOT/work"; SRC="$WORK/openwrt"; OUT="$ROOT/output"
MODE="${1:-all}"

say() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }
mk()  { make -C "$SRC" "$@"; }

mkdir -p "$WORK" "$ROOT/dl" "$ROOT/.ccache"; rm -rf "$OUT"; mkdir -p "$OUT/source-patches"

# ---------------------------------------------------------------- 1. source
if [[ ! -d "$SRC/.git" ]]; then
  say "Cloning $OPENWRT_REPO @ $OPENWRT_TAG"
  git clone --depth 1 --branch "$OPENWRT_TAG" "$OPENWRT_REPO" "$SRC"
fi
[[ "$(git -C "$SRC" describe --tags --exact-match 2>/dev/null)" == "$OPENWRT_TAG" ]] || die "source tree is not at $OPENWRT_TAG"
# caches live outside the source tree so CI can persist them
ln -sfn "$ROOT/dl" "$SRC/dl"; ln -sfn "$ROOT/.ccache" "$SRC/.ccache"
export CCACHE_DIR="$ROOT/.ccache" CCACHE_MAXSIZE=4G

say "Feeds"
( cd "$SRC" && ./scripts/feeds update -a && ./scripts/feeds install -a )

# ---------------------------------------------------------------- 2. WrtMax package + tree patches
say "Adding package/wrtmax (wrtmax-loopguard)"
rm -rf "$SRC/package/wrtmax"; cp -a package/wrtmax "$SRC/package/wrtmax"

say "Applying tree patches"
for p in patches/*.patch; do
  if git -C "$SRC" apply -R --check "$ROOT/$p" 2>/dev/null; then echo "  already applied: $p"
  elif git -C "$SRC" apply --check "$ROOT/$p"; then git -C "$SRC" apply "$ROOT/$p"; echo "  applied: $p"
  else die "patch does not apply to $OPENWRT_TAG: $p"; fi
done
chmod +x "$SRC"/package/firmware/wireless-regdb/wrtmax/*.sh "$SRC"/package/firmware/wireless-regdb/wrtmax/*.py \
         "$SRC"/package/kernel/mac80211/wrtmax/*.py

say "Kernel config fragment -> target/linux/ramips/mt7621/config-5.15"
KC="$SRC/target/linux/ramips/mt7621/config-5.15"
[[ -f "$KC" ]] || die "$KC not found - this tag does not use kernel 5.15"
if ! grep -q 'WrtMax kernel fragment' "$KC"; then
  # drop symbols that are already defined so the fragment wins, then append it
  grep -E '^CONFIG_[A-Z0-9_]+=' config/kernel-5.15.fragment | sed 's/=.*//' | while read -r s; do sed -i "/^# $s is not set\$/d; /^$s=/d" "$KC"; done
  cat config/kernel-5.15.fragment >> "$KC"
fi

# ---------------------------------------------------------------- 3. .config
say "Writing .config (seed + packages) and running defconfig"
cat config/seed.config config/packages.config > "$SRC/.config"
# ucode socket module (MNDP announcer for Winbox) exists only in some ucode versions
grep -q 'ucode-mod-socket' "$SRC/package/utils/ucode/Makefile" && echo 'CONFIG_PACKAGE_ucode-mod-socket=y' >> "$SRC/.config" || echo "  note: ucode-mod-socket not in this tree - MNDP announcer disabled (lldpd still works)"
mk defconfig
say "Verifying final .config"
scripts/verify-config.sh "$SRC" || die "required symbols missing from the final .config (see above)"
[[ "$MODE" == prepare ]] && { say "prepare-only run finished"; exit 0; }

# ---------------------------------------------------------------- 4. rootfs overlay
say "Staging files/ overlay"
STAGE="$SRC/files"; rm -rf "$STAGE"; mkdir -p "$STAGE"; cp -a files/. "$STAGE/"
for d in etc/uci-defaults etc/init.d usr/sbin usr/libexec/rpcd www/cgi-bin lib/wrtmax; do
  [[ -d "$STAGE/$d" ]] && find "$STAGE/$d" -type f -exec chmod 0755 {} +
done
find "$STAGE" -type f ! -name '*.png' -exec sed -i 's/\r$//' {} + 2>/dev/null || true
find "$STAGE" -name '.gitkeep' -delete
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
mk package/firmware/wireless-regdb/{download,prepare}
RB="$(find "$SRC/build_dir" -maxdepth 3 -type d -name 'wireless-regdb-*' | head -1)"
[[ -n "$RB" ]] || die "wireless-regdb build dir not found after prepare"
"$SRC/package/firmware/wireless-regdb/wrtmax/build-regdb.sh" "$RB" || die "could not add the CT domain to regulatory.db"
cp "$RB/db.txt" "$OUT/source-patches/wireless-regdb-db.txt"
mk package/firmware/wireless-regdb/compile

say "Super Channel: allow the locally built (unsigned) regulatory.db in cfg80211"
mk package/kernel/mac80211/{download,prepare}
BP="$(find "$SRC/build_dir" -maxdepth 4 -type d -name 'backports-*' | head -1)"
if [[ -n "$BP" ]]; then
  python3 "$SRC/package/kernel/mac80211/wrtmax/unsigned-regdb.py" "$BP" --diff-out "$OUT/source-patches/cfg80211-unsigned-regdb.diff" \
    || echo "WARNING: unsigned-regdb.py could not edit this tree (exit $?) - the kernel check below decides whether that is fatal"
else
  echo "WARNING: backports source dir not found"
fi

# ---------------------------------------------------------------- 6. full build
say "Downloading sources"
mk -j"$JOBS" download
say "Compiling firmware ($JOBS jobs) - this takes 1-3 hours on a cold cache"
if ! mk -j"$JOBS"; then
  say "Parallel build failed - retrying single-threaded with full log"
  mk -j1 V=s 2>&1 | tail -n 120; die "build failed"
fi

# ---------------------------------------------------------------- 7. verification + output
say "Verifying what was really built"
scripts/verify-kernel.sh "$SRC" "$OUT/kernel-feature-report.txt" || die "kernel feature verification failed (see report)"
REGIPK="$(ls "$SRC"/bin/packages/*/base/wireless-regdb_*.ipk 2>/dev/null | head -1)"
if [[ -f "$REGIPK" ]]; then
  python3 scripts/regdb-has-country.py "$REGIPK" CT | tee -a "$OUT/kernel-feature-report.txt" || die "CT country missing from the packaged regulatory.db"
else echo "  (wireless-regdb ipk not found - skipped)"; fi
scripts/check-image.sh "$SRC" "$OUT" || die "image size check failed"
cp "$SRC/.config" "$OUT/final.config"
say "DONE - firmware: output/WrtMax-K2P-v2-sysupgrade.bin"
