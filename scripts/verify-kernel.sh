#!/usr/bin/env bash
# verify-kernel.sh <openwrt-src> <report-file>
# Reports which requested kernel symbols really ended up in the compiled kernel .config.
set -uo pipefail
SRC="${1:?}"; REP="${2:-/dev/stdout}"
FRAG="$(dirname "$0")/../config/kernel-5.15.fragment"
KCFG="$(ls "$SRC"/build_dir/target-*/linux-ramips_mt7621/linux-5.15.*/.config 2>/dev/null | head -1)"
BCFG="$(ls "$SRC"/build_dir/target-*/linux-ramips_mt7621/backports-*/.config 2>/dev/null | head -1)"
[[ -f "$KCFG" ]] || { echo "kernel .config not found under build_dir (was the kernel built?)"; exit 2; }
MUST="STP BRIDGE BRIDGE_NETFILTER BRIDGE_VLAN_FILTERING NF_FLOW_TABLE NFT_FLOW_OFFLOAD NET_CLS_U32 NET_SCH_INGRESS NET_ACT_MIRRED NET_SCH_HTB NET_SCH_FQ_CODEL NET_SCH_CAKE IFB BRIDGE_NF_EBTABLES"
rc=0
TMP="$(mktemp)"
{
  echo "WrtMax kernel feature report  ($KCFG)"; echo
  echo "== Requested by kernel-5.15.fragment"
  while IFS= read -r l; do
    [[ "$l" =~ ^CONFIG_([A-Z0-9_]+)=y$ ]] || continue; s="${BASH_REMATCH[1]}"
    v="$(sed -n "s/^CONFIG_${s}=\(.*\)$/\1/p" "$KCFG")"
    printf '  %-34s requested=y  actual=%s\n' "CONFIG_$s" "${v:-ABSENT (dropped by kconfig)}"
  done < "$FRAG"
  echo; echo "== Mandatory features (must be y or m)"
  for s in $MUST; do
    v="$(sed -n "s/^CONFIG_${s}=\(.*\)$/\1/p" "$KCFG")"
    if [[ "$v" == y || "$v" == m ]]; then printf '  [ ok ] %s=%s\n' "$s" "$v"; else printf '  [FAIL] %s=%s\n' "$s" "${v:-ABSENT}"; rc=1; fi
  done
  echo; echo "== CPU frequency scaling (informational - depends on SoC support)"
  if grep -q '^CONFIG_CPU_FREQ=y' "$KCFG"; then
    echo "  CPU_FREQ is enabled in the kernel. A cpufreq DRIVER for the MT7621 PLL is still required for /sys/devices/system/cpu/cpu*/cpufreq/ to appear:"
    grep -E '^CONFIG_(MIPS_.*CPUFREQ|CPUFREQ_DT|ARM_.*CPUFREQ)=' "$KCFG" || echo "  no cpufreq driver selected -> wrtmax-cpugov will run in 'core parking + IRQ tuning' mode"
  else
    echo "  CPU_FREQ was dropped by kconfig (not selectable for this MIPS platform) -> wrtmax-cpugov runs in 'core parking + IRQ tuning' mode"
  fi
  grep -q '^CONFIG_HOTPLUG_CPU=y' "$KCFG" && echo "  HOTPLUG_CPU=y  (core parking available)" || echo "  HOTPLUG_CPU absent (core parking unavailable; IRQ tuning only)"
  echo; echo "== Wireless regulatory"
  if [[ -f "$BCFG" ]]; then
    if grep -q '^CPTCFG_CFG80211_REQUIRE_SIGNED_REGDB=y' "$BCFG"; then
      echo "  [FAIL] CFG80211_REQUIRE_SIGNED_REGDB=y : the locally built regulatory.db (CT domain) would be rejected by the kernel"
      [[ "${WRTMAX_ALLOW_SIGNED_REGDB:-0}" == 1 ]] || rc=1
    else echo "  [ ok ] regdb signature NOT required ($(grep REQUIRE_SIGNED_REGDB "$BCFG" | head -1))"; fi
  else echo "  [warn] backports .config not found - could not check CFG80211_REQUIRE_SIGNED_REGDB"; fi
} > "$TMP"          # no pipe: rc must stay in this shell
cat "$TMP"; [[ "$REP" == /dev/stdout ]] || cp "$TMP" "$REP"; rm -f "$TMP"
exit $rc
