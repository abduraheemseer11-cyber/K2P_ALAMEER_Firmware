# WrtMax Firmware Solutions – Phicomm K2P (MT7621A, 16 MB flash) – v2 **Full Source Build**

OpenWrt **v23.05.5** (kernel 5.15) is cloned from source and compiled with `make`; the WrtMax layer is added through
a seed `.config`, a kernel config fragment, tree patches, one custom C package and a rootfs overlay.
Branding unchanged: *WrtMax Firmware Solutions*, logo/favicon, support **776 538 297**, permanent LAN IP **192.168.1.20**,
open SSIDs `AbduRaheem_2G` (ch 6, 20 MHz, 20 dBm) and `AbduRaheem_5G` (ch 36, 40 MHz, 23 dBm).

## Build
1. Upload this folder to a GitHub repo (keep `.github/workflows/build.yml`).
2. **Actions → Build WrtMax K2P Firmware → Run workflow.**
   First run `prepare_only = true` (~10 min: clone, patch, defconfig, config verification), then the full build (1–3 h cold; `dl/` and ccache are cached, later runs are much faster).
3. Artifact `WrtMax-K2P-v2-firmware`: `WrtMax-K2P-v2-sysupgrade.bin`, `sha256sums.txt`, `kernel-feature-report.txt`, `final.config`, `source-patches/`.

Locally: `bash ./build.sh` (Ubuntu 22.04 + OpenWrt prerequisites) or `bash ./build.sh prepare`. The script is also marked executable for direct `./build.sh` use.
The build **fails** (instead of silently shipping a half-working image) if: a required package symbol is missing, a patch does not apply,
a mandatory kernel feature is absent, the `CT` country is not inside the packaged `regulatory.db`, cfg80211 would reject an unsigned regdb,
or the image exceeds **15.2 MiB** (K2P firmware partition is 15744 KiB; warning above 13 MiB because the settings overlay shrinks).

## What was implemented

| # | Feature | Where |
|---|---|---|
| 1 | Full source build, size-trimmed config, `dl/` + ccache cache | `build.sh`, `.github/workflows/build.yml`, `config/seed.config`, `config/packages.config` |
| 2.1 | **Super Channel** (country `CT`: 2.4 GHz ch 1–14, 5 GHz ch 36–177, no DFS/NO-IR, 27 dBm) + LuCI toggle/extended channels | `patches/901…`, `patches/902…`, `files/…/view/wrtmax/wifi.js` |
| 2.2 | **cpufreq** kernel symbols + `wrtmax-cpugov` + CPU & Power page | `config/kernel-5.15.fragment`, `files/usr/sbin/wrtmax-cpugov`, `view/wrtmax/power.js` |
| 2.3 | **Real per-client shaping**: tc HTB + fq_codel/cake + IFB, independent down/up caps (Kbps/Mbps) | `files/usr/sbin/wrtmax-qos`, `view/wrtmax/clients.js` |
| 2.4 | **Loop guard**: C daemon, tagged probes, netlink aware, port isolation, uplink/downlink roles, live alert + *Reset Isolated Port* | `package/wrtmax/wrtmax-loopguard`, `view/wrtmax/protection.js` |
| 2.5 | Arabic/English menu + tab titles + pages, **العربية / English** button in the header | `www/luci-static/wrtmax/brand.js`, `menu.d/luci-app-wrtmax.json` |
| 2.6 | Flow offloading built in and enforced on boot/reset | kernel fragment, `uci-defaults`, `etc/init.d/wrtmax`, dashboard card |

LuCI menu: Dashboard · Quick Setup · Wi-Fi & Driver Control · Spectrum Analyzer · Ports & VLAN · Clients & QoS · Protection & Loop · CPU & Power · Tools & Updates
(`لوحة التحكم · الإعداد السريع · الواي فاي والترددات · محلل الطيف · المنافذ و VLAN · المتصلين والسرعة · الحماية واللوب · الطاقة والمعالج · الأدوات والتحديثات`).

## Honest status – read before flashing

**Tested in the authoring sandbox (no internet, no router):** syntax of every shell/JS/JSON/YAML file; the C daemon compiled with `-Wall -Wextra`
and run in a network namespace against real veth "cables" (loop found in tens of µs, one port isolated, re-isolated when something raised it,
uplink loops only alert, reset/reload/stop work); tc command generation against a stubbed `tc`; patches apply to an empty tree; the regdb/Kconfig helper scripts on synthetic fixtures;
the verification scripts including their failure paths.

**NOT tested – needs your first CI run and a spare K2P:** the actual OpenWrt compile (no network here), the real `wireless-regdb`/`mac80211` source layout
(helpers are guarded and fail loudly if the layout differs), the u32 MAC offsets on a live mac80211 AP interface, kernel behaviour on hardware.
Do the first flash with a spare device and a way to recover (Breed).

### Deviations from the brief (and why)
* **`cpufreq` will most likely not appear.** The fragment enables all requested `CONFIG_CPU_FREQ*` governors, but on MIPS Kconfig only offers
  them for platforms that declare cpufreq support, and Linux 5.15 has no cpufreq driver for the MT7621 PLL. `kernel-feature-report.txt` shows what survived.
  The brief's fallback is therefore the default: `wrtmax-cpugov` does **core parking** (2nd core offline when idle, needs `HOTPLUG_CPU`), **IRQ affinity** tuning, thermal guard,
  six governor names with defined thresholds. If a cpufreq driver is ever present it uses the real kernel governors. It never touches Wi-Fi settings.
* **`CONFIG_NF_FLOW_TABLE_HW`** is not a mainline 5.15 symbol; it is requested anyway and reported. `flow_offloading_hw=1` is set, but mainline MT7621 has no PPE hardware NAT driver, so
  expect *software* flow offloading (the dashboard shows "ON (software)" vs "HW flag" honestly).
* **No mt76 C patch.** mt76 takes channels/power from cfg80211, so the `CT` regdb + unsigned-regdb change (902) is what unlocks them (see `package/kernel/mt76/wrtmax/NOTES.md`).
  The real radiated power is still capped by the K2P EEPROM/PA. Using Super Channel outside a shielded test setup is illegal in most countries.
* **`country CT`, not `00`:** the world domain `00` is left intact (changing it would affect every unconfigured radio). Super Channel switches the radios to `CT` and restores the previous country when turned off.
* **Menu translation is client-side** (`brand.js` dictionary + the stock `luci-i18n-*-ar` packages): LuCI's server-side menu strings cannot be switched per click without gettext catalogs. The button also sets `luci.main.lang`.
* `ucode-mod-socket` (MNDP/Winbox announcer) is added only if this ucode version has it; lldpd (LLDP/CDP) always ships.
* Per-client limits need `tc-full`; they act on Wi-Fi clients (AP interfaces), keyed by MAC, and are unaffected by IP changes.

## Port roles (loop guard)
`auto` (default) and `downlink` ports may be isolated; `uplink` ports are never shut down (a loop touching only uplinks raises a UI alert).
The rogue-DHCP block applies to wired ports only when at least one port is explicitly `uplink`.

## Layout
```
build.sh  .github/workflows/build.yml
config/      seed.config  packages.config  kernel-5.15.fragment  required-symbols.txt
patches/     901-wireless-regdb-superchannel.patch  902-mac80211-mt76-superchannel.patch
scripts/     verify-config.sh  verify-kernel.sh  check-image.sh  regdb-has-country.py
package/wrtmax/wrtmax-loopguard/   C daemon + OpenWrt Makefile
files/       rootfs overlay: scripts, rpcd backend (ubus "wrtmax"), LuCI views (JS), CSS, uci-defaults
tests/       loopguard netns test (mkveth.c, run-in-netns.sh, loopguard-netns-test.sh)
```
Logs on the router: `logread | grep -E 'wrtmax'`, `wrtmax-loopguard -c status`, `wrtmax-qos status`, `wrtmax-cpugov status`, `iw reg get`.
