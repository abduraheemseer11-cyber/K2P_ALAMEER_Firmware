#!/usr/bin/env bash
# verify-kernel.sh <openwrt-src> <report-file>
# Report which requested kernel symbols really ended up in the compiled kernel .config.
set -uo pipefail
SRC="${1:?}"; REP="${2:-/dev/stdout}"
HERE="$(cd "$(dirname "$0")" && pwd)"
FRAG="$HERE/../config/kernel-5.15.fragment"

# newest linux-5.15.* build dir
KLIN="$(ls -1d "$SRC"/build_dir/target-*/linux-ramips_mt7621/linux-5.15.* 2>/dev/null | sort -V | tail -1 || true)"
KCFG=""
[[ -n "$KLIN" && -f "$KLIN/.config" ]] && KCFG="$KLIN/.config"

# newest backports build dir
BLIN="$(ls -1d "$SRC"/build_dir/target-*/linux-ramips_mt7621/backports-* 2>/dev/null | sort -V | tail -1 || true)"
BCFG=""
[[ -n "$BLIN" && -f "$BLIN/.config" ]] && BCFG="$BLIN/.config"

if [[ -z "$KCFG" ]]; then
  echo "FAIL: kernel .config not found under build_dir (was the kernel built?)"
  exit 2
fi

MUST=( STP BRIDGE BRIDGE_NETFILTER BRIDGE_VLAN_FILTERING
       NF_FLOW_TABLE NFT_FLOW_OFFLOAD NET_CLS_U32 NET_SCH_INGRESS
       NET_ACT_MIRRED NET_SCH_HTB NET_SCH_FQ_CODEL NET_SCH_CAKE
       IFB BRIDGE_NF_EBTABLES )

rc=0
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

{
  echo "WrtMax kernel feature report  ($KCFG)"; echo

  echo "== Requested by kernel-5.15.fragment"
  if [[ -f "$FRAG" ]]; then
    while IFS= read -r l; do
      [[ "$l" =~ ^CONFIG_([A-Z0-9_]+)=y$ ]] || continue
      s="${BASH_REMATCH[1]}"
      v="$(sed -n "s/^CONFIG_${s}=\(.*\)$/\1/p" "$KCFG" | head -1)"
      printf '  %-34s requested=y  actual=%s\n' "CONFIG_$s" "${v:-ABSENT (dropped by kconfig)}"
    done < "$FRAG"
  else
    echo "  [warn] fragment file not found: $FRAG"
  fi

  echo; echo "== Mandatory features (must be y or m)"
  for s in "${MUST[@]}"; do
    v="$(sed -n "s/^CONFIG_${s}=\(.*\)$/\1/p" "$KCFG" | head -1)"
    if [[ "$v" == "y" || "$v" == "m" ]]; then
      printf '  [ ok ] %s=%s\n' "$s" "$v"
    else
      printf '  [FAIL] %s=%s\n' "$s" "${v:-ABSENT}"; rc=1
    fi
  done

  echo; echo "== CPU frequency scaling (informational)"
  if grep -q '^CONFIG_CPU_FREQ=y' "$KCFG"; then
    echo "  CPU_FREQ enabled. Needs a cpufreq DRIVER for MT7621 PLL for /sys/.../cpufreq:"
    grep -E '^CONFIG_(MIPS_.*CPUFREQ|CPUFREQ_DT|ARM_.*CPUFREQ)=' "$KCFG" \
      || echo "  no cpufreq driver selected -> wrtmax-cpugov runs 'core parking + IRQ tuning' mode"
  else
    echo "  CPU_FREQ dropped by kconfig (not selectable for this MIPS platform)"
  fi
  if grep -q '^CONFIG_HOTPLUG_CPU=y' "$KCFG"; then
    echo "  HOTPLUG_CPU=y  (core parking available)"
  else
    echo "  HOTPLUG_CPU absent (core parking unavailable; IRQ tuning only)"
  fi

  echo; echo "== Wireless regulatory"
  if [[ -n "$BCFG" ]]; then
    if grep -q '^CPTCFG_CFG80211_REQUIRE_SIGNED_REGDB=y' "$BCFG"; then
      echo "  [FAIL] CFG80211_REQUIRE_SIGNED_REGDB=y : CT domain would be rejected by the kernel"
      [[ "${WRTMAX_ALLOW_SIGNED_REGDB:-0}" == "1" ]] || rc=1
    else
      echo "  [ ok ] regdb signature NOT required ($(grep REQUIRE_SIGNED_REGDB "$BCFG" | head -1 || echo 'n/a'))"
    fi
  else
    echo "  [warn] backports .config not found - could not check CFG80211_REQUIRE_SIGNED_REGDB"
  fi
} > "$TMP"

cat "$TMP"
if [[ "$REP" != "/dev/stdout" ]]; then
  cp "$TMP" "$REP"
fi
exit $rc