/* WrtMax brand layer: logo, support footer, bilingual (Arabic/English) UI incl. menu + tab titles,
   and the one-click language switcher in the header.                                              */
(function () {
  'use strict';
  var LOGO = '/luci-static/wrtmax/logo.png', PHONE = '776 538 297';

  /* ---- dictionary: menu / tab titles first, then page strings used by the WrtMax views ---- */
  var AR = {
    /* WrtMax menu + tabs */
    'WrtMax':'WrtMax','Dashboard':'لوحة التحكم','Quick Setup':'الإعداد السريع','Wi-Fi & Driver Control':'الواي فاي والترددات',
    'Spectrum Analyzer':'محلل الطيف','Ports & VLAN':'المنافذ و VLAN','Clients & QoS':'المتصلين والسرعة','Protection & Loop':'الحماية واللوب',
    'CPU & Power':'الطاقة والمعالج','Tools & Updates':'الأدوات والتحديثات',
    /* stock LuCI menu / tabs */
    'Status':'الحالة','Overview':'نظرة عامة','Routing':'التوجيه','Firewall':'الجدار الناري','System':'النظام','Administration':'الإدارة',
    'Software':'البرمجيات','Startup':'بدء التشغيل','Scheduled Tasks':'المهام المجدولة','Backup / Flash Firmware':'النسخ الاحتياطي / تحديث النظام',
    'Reboot':'إعادة التشغيل','Network':'الشبكة','Interfaces':'الواجهات','Wireless':'اللاسلكي','DHCP and DNS':'DHCP و DNS','Hostnames':'أسماء المضيفين',
    'Static Routes':'المسارات الثابتة','Diagnostics':'التشخيص','Logout':'تسجيل الخروج','Services':'الخدمات','Realtime Graphs':'رسوم لحظية',
    'Processes':'العمليات','Kernel Log':'سجل النواة','System Log':'سجل النظام','Port Forwards':'تحويل المنافذ','Traffic Rules':'قواعد المرور',
    'NAT Rules':'قواعد NAT','Custom Rules':'قواعد مخصصة','General Settings':'الإعدادات العامة','Switch':'المحوّل','Devices':'الأجهزة','Globals':'عام',
    'Logging':'السجلات','Language and Style':'اللغة والمظهر','Mounting Points':'نقاط التركيب','LED Configuration':'إعداد المؤشرات','Channel Analysis':'تحليل القنوات',
    'Load':'الحمل','Traffic':'حركة المرور','Connections':'الاتصالات','Package Manager':'مدير الحزم','Software Packages':'حزم البرمجيات',
    /* page strings */
    'Apply':'تطبيق','Refresh':'تحديث','Scan':'فحص','Save & Apply':'حفظ وتطبيق','Saved.':'تم الحفظ.','Applied.':'تم التطبيق.',
    'CPU load':'حمل المعالج','RAM used':'الذاكرة المستخدمة','Uptime':'مدة التشغيل','Temperature':'الحرارة','Download':'التحميل','Upload':'الرفع',
    'Clients 2.4GHz':'أجهزة 2.4GHz','Clients 5GHz':'أجهزة 5GHz','Ports':'المنافذ','Mode':'الوضع','Firmware':'الإصدار','LAN address':'عنوان الشبكة',
    'Access Point':'نقطة وصول','Wireless Bridge':'جسر لاسلكي','Repeater':'مقوّي إشارة','WISP':'WISP','Home Router':'راوتر منزلي',
    'IP address':'عنوان IP','Netmask':'القناع','Gateway':'البوابة','DNS':'DNS','Band':'النطاق','Network name (SSID)':'اسم الشبكة (SSID)','Password':'كلمة المرور',
    'Name':'الاسم','Signal':'الإشارة','Channel':'القناة','Enabled':'مفعّل','Hidden':'مخفية','Isolate':'عزل','Block':'حظر','Unblock':'إلغاء الحظر',
    'Limit':'تحديد السرعة','Speed test':'اختبار السرعة','Assistant':'المساعد','Fix':'إصلاح','Backup & Clone':'نسخ احتياطي واستنساخ','Updates':'التحديثات',
    'Check for updates':'بحث عن تحديث','Watchdog':'المراقب','Protection':'الحماية','Transmit power':'قوة الإرسال','Country':'الدولة','Width':'العرض',
    'Auto best channel':'أفضل قناة تلقائياً','Interference':'التداخل','Merge WAN as LAN5':'دمج WAN كمنفذ LAN خامس','Access VLAN':'VLAN للمنفذ','Tagged VLANs':'VLAN موسومة',
    'Support':'الدعم الفني','Roaming 802.11k/v/r':'التجوال 802.11k/v/r','Mesh 802.11s':'شبكة Mesh 802.11s','Yes':'نعم','No':'لا',
    'Wi-Fi & SSIDs':'الشبكات اللاسلكية','Clients':'المتصلون','Link':'الاتصال','Speed':'السرعة','Role':'الدور',
    'Super Channel (extended frequencies)':'القناة الفائقة (ترددات موسّعة)','Extended channels':'القنوات الموسّعة','Active channels':'القنوات الفعّالة',
    'Download limit':'حد التحميل','Upload limit':'حد الرفع','Uplink':'صاعد (Uplink)','Downlink':'هابط (Downlink)','Auto':'تلقائي',
    'Reset Isolated Port':'إعادة تفعيل المنفذ المعزول','Loop detected':'تم اكتشاف لوب','Isolated':'معزول','Port roles':'أدوار المنافذ',
    'Governor':'نمط المعالج','Cores online':'الأنوية العاملة','Hardware NAT':'NAT العتادي','Language':'اللغة'
  };
  window.wmI18n = {
    lang: function () { var l = null; try { l = localStorage.getItem('wrtmax_lang'); } catch (e) {}
      return (l || document.documentElement.lang || 'en').slice(0, 2) === 'ar' ? 'ar' : 'en'; },
    t: function (s) { return (this.lang() === 'ar' && AR[s]) || s; },
    dict: AR
  };

  function ready(fn) { document.readyState !== 'loading' ? fn() : document.addEventListener('DOMContentLoaded', fn); }
  var lang = window.wmI18n.lang();
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';

  /* ---- translate navigation + tab titles (server-rendered or JS-rendered), keep English as data-wm-en ---- */
  var NAVSEL = 'header a, #mainmenu a, #topmenu a, ul.nav a, .main-left a, .tabs a, .cbi-tabmenu a, #tabmenu a, .menu a, nav a';
  function xlat(root) {
    if (lang !== 'ar') return;
    (root.querySelectorAll ? root.querySelectorAll(NAVSEL) : []).forEach(function (a) {
      if (a.children.length) return;                       // only plain-text links
      var en = a.getAttribute('data-wm-en') || a.textContent.trim();
      if (AR[en] && a.textContent.trim() !== AR[en]) { a.setAttribute('data-wm-en', en); a.textContent = AR[en]; }
    });
    if (AR[document.title.split(' - ').pop()]) { /* title is "host - Page" */
      var parts = document.title.split(' - '); parts[parts.length - 1] = AR[parts[parts.length - 1]]; document.title = parts.join(' - ');
    }
  }

  /* ---- language switch: remember, tell LuCI (server side strings), reload ---- */
  function switchLang() {
    var to = lang === 'ar' ? 'en' : 'ar';
    try { localStorage.setItem('wrtmax_lang', to); } catch (e) {}
    var sid = (window.L && L.env && L.env.sessionid) || null, done = function () { location.reload(); };
    if (!sid) return done();
    fetch('/ubus', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'call', params: [ sid, 'wrtmax', 'set_lang', { lang: to } ] }) }).then(done, done);
  }

  ready(function () {
    var body = document.body; if (!body || document.querySelector('.wm-footer')) return;
    var pw = document.querySelector('input[type=password][name=luci_password]');
    if (pw) {
      var f = pw.form, img = document.createElement('img'); img.src = LOGO; img.className = 'wm-login-logo'; img.alt = 'WrtMax';
      var t = document.createElement('div'); t.className = 'wm-login-title'; t.textContent = 'WrtMax Firmware Solutions';
      f.parentNode.insertBefore(t, f); f.parentNode.insertBefore(img, t);
    } else {
      var hdr = document.querySelector('header .brand, header a.brand, header .showSide, header');
      if (hdr && !document.querySelector('.wm-hdrlogo')) {
        var s = document.createElement('img'); s.src = LOGO; s.className = 'wm-hdrlogo'; s.alt = '';
        s.style.cssText = 'height:30px;width:30px;border-radius:50%;background:#fff;margin:0 8px;vertical-align:middle';
        hdr.insertBefore(s, hdr.firstChild);
      }
    }
    /* header language button (falls back to a floating button on the login page) */
    var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'wm-lang'; btn.title = 'Language / اللغة';
    btn.innerHTML = '<span' + (lang === 'ar' ? ' class="on"' : '') + '>العربية</span> / <span' + (lang === 'en' ? ' class="on"' : '') + '>English</span>';
    btn.addEventListener('click', switchLang);
    var host = document.querySelector('header .container, header .fill, header');
    if (host && !pw) host.appendChild(btn); else { btn.className += ' float'; body.appendChild(btn); }

    var ft = document.createElement('div'); ft.className = 'wm-footer';
    ft.innerHTML = '<b>WrtMax Firmware Solutions</b> &nbsp;|&nbsp; ' + (lang === 'ar' ? 'الدعم الفني' : 'Technical support') + ': <b dir="ltr">' + PHONE + '</b>';
    body.appendChild(ft);

    xlat(document);
    new MutationObserver(function (m) { m.forEach(function (r) { r.addedNodes.forEach(function (n) { if (n.nodeType === 1) xlat(n); }); }); })
      .observe(document.body, { childList: true, subtree: true });
  });
})();
