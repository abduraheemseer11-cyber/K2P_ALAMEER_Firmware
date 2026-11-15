# K2P ALAMEER Firmware (Padavan)

Custom Padavan build for the **Phicomm K2P** (MT7621, 16 MB flash).

## What is customised
| Item | Value |
|------|-------|
| Default UI language | English |
| Mode | Access Point (`sw_mode=3`), all ports incl. WAN act as LAN |
| LAN IP | 192.168.1.20 / 255.255.255.0 (gateway 192.168.1.1) |
| DHCP server / DHCPv6 | Disabled |
| 2.4 GHz SSID / power | `AL-AMEER-NET ( )_2G` / target 20 dBm |
| 5 GHz SSID / power | `AL-AMEER-NET ( )_5G` / target 23 dBm |
| Reset button | Disabled at build time (GPIO define removed from `board.h`) |
| UI theme | Dark background, dark-red top bar |
| Logo | ALAMEER logo (already included in `custom_patches/assets/asus_logo.png`) |

> **TX power note:** Padavan stores power as a percentage of the EEPROM/regulatory
> limit, not in dBm. The patch sets 100 % for both radios. Measure the real output
> and edit `TXPOWER_2G` / `TXPOWER_5G` at the top of `custom_patches/apply.sh` if needed.

> **Gateway note:** change `LAN_GW` in `custom_patches/apply.sh` if your main router
> is not 192.168.1.1.

## Step 1 - Logo
The ALAMEER logo is already at `custom_patches/assets/asus_logo.png`.
To use a different one, replace that file (transparent PNG, similar size to the original).

## Step 2 - Extract the zip
    unzip K2P_ALAMEER_Firmware.zip
    cd K2P_ALAMEER_Firmware

## Step 3 - Upload to a new GitHub repository
1. Create a new empty repository on GitHub.
2. Run:

       git init
       git add -A
       git commit -m "ALAMEER K2P firmware project"
       git branch -M main
       git remote add origin https://github.com/<YOUR_USER>/<YOUR_REPO>.git
       git push -u origin main

   (Or upload all files via the web UI, including the hidden `.github` folder.)

## Step 4 - Trigger the build
1. Repository -> **Actions** tab (enable workflows if asked).
2. Choose **Build K2P ALAMEER Firmware** -> **Run workflow**.
3. Wait 1-3 hours.

## Step 5 - Download and flash
1. Download the **K2P_ALAMEER_Firmware** artifact (`.trx` / `.bin`).
2. Flash via Administration -> Firmware Update, or via bootloader recovery (Breed/U-Boot).
3. Browse to **http://192.168.1.20** (set your PC to a static 192.168.1.x IP first).

## Troubleshooting
* `[FAIL] key ... not found` at the patch step: the source fork uses different names; edit `custom_patches/apply.sh`.
* If 2.4/5 GHz look swapped in the UI, swap the `rt_*` and `wl_*` lines in `apply.sh`.
* Reset button is disabled: use bootloader recovery (or serial/TFTP) if you ever need to recover the router.
* The source repo can be changed in the "Run workflow" dialog (default: `hanwckf/rt-n56u`).
