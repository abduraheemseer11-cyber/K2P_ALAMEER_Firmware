# WrtMax shared shell helpers  (sourced by other scripts)
G() { uci -q get "$1"; }

# print the wifi-device section name (radio0/radio1) for a band: 2g | 5g
radio_for_band() {
  local r b
  for r in $(uci -q show wireless | sed -n 's/^wireless\.\([^.=]*\)=wifi-device$/\1/p'); do
    b=$(G wireless.$r.band)
    if [ -z "$b" ]; then
      case "$(G wireless.$r.hwmode)" in 11a) b=5g ;; *) b=2g ;; esac
    fi
    [ "$b" = "$1" ] && { echo "$r"; return; }
  done
}

# names of the running AP interfaces (phy0-ap0 ...)
ap_ifaces() {
  ubus call network.wireless status 2>/dev/null | jsonfilter -e '@.*.interfaces[@.config.mode="ap"].ifname' 2>/dev/null
}
sta_ifaces() {
  ubus call network.wireless status 2>/dev/null | jsonfilter -e '@.*.interfaces[@.config.mode="sta"].ifname' 2>/dev/null
}

# 2g or 5g for a wifi netdev
iface_band() {
  local f
  f=$(iwinfo "$1" info 2>/dev/null | sed -n 's/.*Channel: [0-9]* (\([0-9.]*\) GHz).*/\1/p' | head -1)
  case "$f" in 2.*) echo 2g ;; *) echo 5g ;; esac
}

wired_ports() { ls /sys/class/net 2>/dev/null | grep -E '^lan[0-9]+$' | sort; }

# set the network list of a firewall zone: fw_zone_nets <zone> <net...>
fw_zone_nets() {
  local zone="$1" i=0 n; shift
  while uci -q get firewall.@zone[$i] >/dev/null; do
    if [ "$(G firewall.@zone[$i].name)" = "$zone" ]; then
      uci -q delete firewall.@zone[$i].network
      for n in "$@"; do uci add_list firewall.@zone[$i].network="$n"; done
      return
    fi
    i=$((i+1))
  done
}

# delete every uci section on stdin (paths like network.xxx or network.@device[0]), highest index first
del_sections() { sort -r | while read -r s; do [ -n "$s" ] && uci -q delete "$s"; done; }

# loop-guard config for the C daemon, generated from UCI (roles: uplink stays uplink, auto/downlink = isolatable)
gen_loopguard_conf() {
  local p r f=/var/etc/wrtmax-loopguard.conf
  mkdir -p /var/etc
  {
    echo "enabled $(G wrtmax.loop.enabled || echo 1)"
    echo "interval_ms $(G wrtmax.loop.probe_ms || echo 100)"
    echo "storm_pps $(G wrtmax.loop.storm_pps || echo 20000)"
    echo "recover_s $(G wrtmax.loop.recover_s || echo 0)"
    for p in $(wired_ports) wan; do
      r=$(G wrtmax.$p.role); [ "$r" = uplink ] || r=downlink
      echo "port $p $r"
    done
  } > $f
}
