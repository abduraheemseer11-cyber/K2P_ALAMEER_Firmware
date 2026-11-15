#!/usr/bin/env bash
# Usage: apply.sh <path-to-padavan-trunk> <path-to-custom_patches>
set -euo pipefail

TRUNK="${1:?Usage: apply.sh <padavan/trunk> <custom_patches dir>}"
PATCHES="${2:-$(cd "$(dirname "$0")" && pwd)}"

# ----------------------------- TUNABLE SETTINGS ------------------------------
LAN_IP="192.168.1.20"
LAN_MASK="255.255.255.0"
LAN_GW="192.168.1.1"          # <-- your main router (change if different)
SSID_2G="AL-AMEER-NET ( )_2G"
SSID_5G="AL-AMEER-NET ( )_5G"
# Padavan stores TX power as a PERCENTAGE (1-100) of the EEPROM/regulatory max,
# not dBm. Adjust these after measuring real output on your unit.
TXPOWER_2G="100"              # target: 20 dBm
TXPOWER_5G="100"              # target: 23 dBm
# -----------------------------------------------------------------------------

DEFAULTS="$TRUNK/user/shared/defaults.c"
[ -f "$DEFAULTS" ] || { echo "ERROR: $DEFAULTS not found"; exit 1; }

BOARD_H="$(find "$TRUNK/configs/boards" -ipath '*/K2P/board.h' 2>/dev/null | head -n1 || true)"
[ -n "$BOARD_H" ] || { echo "ERROR: K2P board.h not found under $TRUNK/configs/boards"; ls "$TRUNK/configs/boards" || true; exit 1; }
echo "Using board file: $BOARD_H"

MISSING="$(mktemp)"

# set_default <key> <value>
#  - key exists  -> value replaced (works for "string" AND MACRO values)
#  - key missing -> entry is added to router_defaults[] (never fails the build)
set_default() {
  local key="$1" val="$2"
  if grep -qE "\{[[:space:]]*\"${key}\"[[:space:]]*," "$DEFAULTS"; then
    sed -i -E "s|(\{[[:space:]]*\"${key}\"[[:space:]]*,)[^}]*\}|\1 \"${val}\" }|" "$DEFAULTS"
    echo "  [set]   ${key} = \"${val}\""
  else
    printf '\t{ "%s", "%s" },\n' "$key" "$val" >> "$MISSING"
    echo "  [add]   ${key} = \"${val}\" (not in source, will be inserted)"
  fi
}

echo "==> [1/6] Default language -> English"
set_default preferred_lang "EN"

echo "==> [2/6] Network: AP mode, static IP, no DHCP, all ports as LAN"
set_default sw_mode        "3"            # AP mode: WAN port joins the LAN switch
set_default lan_proto_x    "0"            # 0 = static LAN address
set_default lan_ipaddr     "$LAN_IP"
set_default lan_netmask    "$LAN_MASK"
set_default lan_gateway    "$LAN_GW"
set_default lan_dns1       "$LAN_GW"
set_default dhcp_enable_x  "0"            # DHCP server off
set_default ip6_service    ""             # IPv6 off
set_default ip6_lan_auto   "0"
set_default ip6_lan_dhcp   "0"
set_default ip6_lan_radv   "0"
set_default ip6_wan_dhcp   "0"

echo "==> [3/6] Wi-Fi SSIDs and TX power"
# rt_* = 2.4 GHz radio, wl_* = 5 GHz radio on K2P
set_default rt_ssid     "$SSID_2G"
set_default rt_TxPower  "$TXPOWER_2G"
set_default wl_ssid     "$SSID_5G"
set_default wl_TxPower  "$TXPOWER_5G"

# Insert all missing keys right before the array terminator (once)
if [ -s "$MISSING" ]; then
  awk -v addfile="$MISSING" '
    /router_defaults\[\]/ { inarr=1 }
    inarr && !done && /^[[:space:]]*\{[[:space:]]*(0|NULL)[[:space:]]*,[[:space:]]*(0|NULL)[[:space:]]*\}/ {
      while ((getline line < addfile) > 0) print line
      done=1
    }
    { print }
    END { if (!done) exit 3 }
  ' "$DEFAULTS" > "$DEFAULTS.new" || {
    echo "  [FAIL] could not find the end of router_defaults[] in defaults.c"
    echo "  --- context ---"; grep -n "router_defaults\|{ *0 *, *0 *}\|NULL" "$DEFAULTS" | head -20
    exit 1
  }
  mv "$DEFAULTS.new" "$DEFAULTS"
  echo "  [ok] inserted $(wc -l < "$MISSING") missing key(s)"
fi

echo "--- verification (defaults.c) ---"
for k in preferred_lang sw_mode lan_proto_x lan_ipaddr lan_netmask dhcp_enable_x rt_ssid rt_TxPower wl_ssid wl_TxPower; do
  grep -n "\"$k\"" "$DEFAULTS" | head -2 || echo "  [WARN] $k not present after patch"
done

echo "==> [4/6] Disable hardware Reset button"
if grep -qE '^[[:space:]]*#[[:space:]]*define[[:space:]]+BOARD_GPIO_BTN_RESET' "$BOARD_H"; then
  sed -i -E 's|^([[:space:]]*)#[[:space:]]*define[[:space:]]+BOARD_GPIO_BTN_RESET.*|\1/* ALAMEER: reset button disabled */|' "$BOARD_H"
  echo "  [ok] BOARD_GPIO_BTN_RESET removed"
else
  echo "  [warn] BOARD_GPIO_BTN_RESET not defined in $BOARD_H (nothing to disable)"
fi
if grep -qE '^[[:space:]]*#[[:space:]]*define[[:space:]]+BOARD_GPIO_BTN_RESET' "$BOARD_H"; then
  echo "  [FAIL] Reset define still present"; exit 1
fi

echo "==> [5/6] Custom logo"
LOGO_SRC="$PATCHES/assets/asus_logo.png"
if [ -f "$LOGO_SRC" ]; then
  COUNT=0
  while IFS= read -r f; do
    cp -v "$LOGO_SRC" "$f"; COUNT=$((COUNT+1))
  done < <(find "$TRUNK/user" -type f -name 'asus_logo.png')
  echo "  [ok] replaced $COUNT logo file(s)"
else
  echo "  [warn] $LOGO_SRC missing -> default logo kept"
fi

echo "==> [6/6] UI theme (dark background, dark-red top bar)"
COUNT=0
while IFS= read -r css; do
  cat "$PATCHES/alameer_theme.css" >> "$css"
  echo "  [ok] theme appended to $css"; COUNT=$((COUNT+1))
done < <(find "$TRUNK/user" -type f -name 'main.css' -path '*bootstrap*')
if [ "$COUNT" -eq 0 ]; then
  echo "  [warn] no bootstrap main.css found; theme NOT applied"
  find "$TRUNK/user" -name '*.css' | head -20
fi

rm -f "$MISSING"
echo "==> All patches applied."
