include $(TOPDIR)/rules.mk

PKG_NAME:=wrtmax-loopguard
PKG_VERSION:=2.0.0
PKG_RELEASE:=1
PKG_LICENSE:=GPL-2.0-or-later
PKG_MAINTAINER:=WrtMax Firmware Solutions

include $(INCLUDE_DIR)/package.mk

define Package/wrtmax-loopguard
  SECTION:=net
  CATEGORY:=Network
  TITLE:=WrtMax Layer-2 loop detector and DSA port isolator
  DEPENDS:=+kmod-br-netfilter
endef

define Package/wrtmax-loopguard/description
  Sends tagged probe frames on the DSA switch ports, detects Layer-2 loops
  (netlink aware, microsecond-level detection once the probe returns), isolates
  the offending downlink port and exposes state/reset over a unix socket.
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
	$(CP) ./src/* $(PKG_BUILD_DIR)/
endef

define Build/Compile
	$(TARGET_CC) $(TARGET_CFLAGS) -Wall -Wextra -o $(PKG_BUILD_DIR)/wrtmax-loopguard \
		$(PKG_BUILD_DIR)/loopguard.c $(TARGET_LDFLAGS)
endef

define Package/wrtmax-loopguard/install
	$(INSTALL_DIR) $(1)/usr/sbin
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/wrtmax-loopguard $(1)/usr/sbin/
endef

$(eval $(call BuildPackage,wrtmax-loopguard))
