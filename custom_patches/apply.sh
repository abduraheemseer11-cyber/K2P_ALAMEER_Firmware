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
BOARD_H="$TRUNK/configs/boards/K2P/board.h"

[ -f "$DEFAULTS" ] || { echo "ERROR: $DEFAULTS not found"; exit 1; }
[ -f "$BOARD_H" ]  || { echo "ERROR: $BOARD_H not found"; exit 1; }

# set_default <key> <value> <required|optional>
set_default() {
  local key="$1" val="$2" req="${3:-required}"
  if grep -qE "\{[[:space:]]*\"${key}\"[[:space:]]*," "$DEFAULTS"; then
    sed -i -E "s|(\{[[:space:]]*\"${key}\"[[:space:]]*,[[:space:]]*)\"[^\"]*\"|\1\"${val}\"|" "$DEFAULTS"
    echo "  [ok]   ${key} = \"${val}\""
  elif [ "$req" = "required" ]; then
    echo "  [FAIL] key '${key}' not found in defaults.c (source layout differs?)"
    exit 1
  else
    echo "  [warn] optional key '${key}' not found, skipped"
  fi
}

echo "==> [1/6] Default language -> English"
set_default preferred_lang "EN"

echo "==> [2/6] Network: AP mode, static IP, no DHCP, all ports as LAN"
set_default sw_mode        "3"
set_default lan_proto      "static"
set_default lan_ipaddr     "$LAN_IP"
set_default lan_netmask    "$LAN_MASK"
set_default lan_gateway    "$LAN_GW"           optional
set_default lan_dns1       "$LAN_GW"           optional
set_default dhcp_enable_x  "0"
set_default ip6_service    ""                  optional
set_default ip6_lan_auto   "0"                 optional
set_default ip6_lan_dhcp   "0"                 optional
set_default ip6_lan_radv   "0"                 optional
set_default ip6_wan_dhcp   "0"                 optional

echo "==> [3/6] Wi-Fi SSIDs and TX power"
# In Padavan on K2P: rt_* = 2.4 GHz radio, wl_* = 5 GHz radio
set_default rt_ssid     "$SSID_2G"
set_default rt_TxPower  "$TXPOWER_2G"
set_default wl_ssid     "$SSID_5G"
set_default wl_TxPower  "$TXPOWER_5G"

echo "==> [4/6] Disable hardware Reset button"
if grep -qE '^[[:space:]]*#define[[:space:]]+BOARD_GPIO_BTN_RESET' "$BOARD_H"; then
  sed -i -E 's|^([[:space:]]*)#define[[:space:]]+BOARD_GPIO_BTN_RESET.*|\1/* ALAMEER: reset button disabled */|' "$BOARD_H"
  echo "  [ok] BOARD_GPIO_BTN_RESET removed from $BOARD_H"
else
  echo "  [warn] BOARD_GPIO_BTN_RESET define not found in board.h"
fi
if grep -qE 'BOARD_GPIO_BTN_RESET' "$BOARD_H"; then
  echo "  [FAIL] Reset define still present"; exit 1
fi

echo "==> [5/6] Custom logo"
LOGO_SRC="$PATCHES/assets/asus_logo.png"
if [ -f "$LOGO_SRC" ]; then
  COUNT=0
  while IFS= read -r f; do
    cp -v "$LOGO_SRC" "$f"; COUNT=$((COUNT+1))
  done < <(find "$TRUNK/user" -type f -name 'asus_logo.png')
  [ "$COUNT" -gt 0 ] && echo "  [ok] replaced $COUNT logo file(s)" \
                     || echo "  [warn] no asus_logo.png found in the source tree"
else
  echo "  [warn] $LOGO_SRC missing -> default logo kept"
fi

echo "==> [6/6] UI theme (dark background, dark-red top bar)"
CSS_FILE="$(find "$TRUNK/user" -type f -path '*bootstrap/css/main.css' | head -n1 || true)"
if [ -n "$CSS_FILE" ]; then
  cat "$PATCHES/alameer_theme.css" >> "$CSS_FILE"
  echo "  [ok] theme appended to $CSS_FILE"
else
  echo "  [FAIL] main.css not found"; exit 1
fi

echo "==> All patches applied."
