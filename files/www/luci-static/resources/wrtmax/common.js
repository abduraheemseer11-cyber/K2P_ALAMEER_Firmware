'use strict';
'require baseclass';
'require rpc';
'require ui';

return baseclass.extend({
 lang: (window.wmI18n ? window.wmI18n.lang() : (document.documentElement.lang || 'en').slice(0, 2)),
 T: function (s) { return window.wmI18n ? window.wmI18n.t(s) : s; },

 css: function () {
   if (document.querySelector('link[href*="wrtmax.css"]')) return;
   document.head.appendChild(E('link', { rel: 'stylesheet', href: '/luci-static/wrtmax/wrtmax.css' }));
 },
 brandbar: function (title, sub) {
   this.css();
   return E('div', { 'class': 'wm-brandbar' }, [
     E('img', { src: '/luci-static/wrtmax/logo.png', alt: 'WrtMax' }),
     E('div', {}, [ E('b', {}, title), E('small', {}, sub || 'WrtMax Firmware Solutions · 776 538 297') ])
   ]);
 },
 fmtBytes: function (b) {
   var u = ['B', 'KB', 'MB', 'GB', 'TB'], i = 0; b = +b || 0;
   while (b >= 1024 && i < 4) { b /= 1024; i++; }
   return b.toFixed(i ? 1 : 0) + ' ' + u[i];
 },
 fmtRate: function (bps) {
   var bits = (+bps || 0) * 8;
   if (bits >= 1e6) return (bits / 1e6).toFixed(1) + ' Mbps';
   if (bits >= 1e3) return (bits / 1e3).toFixed(0) + ' Kbps';
   return bits.toFixed(0) + ' bps';
 },
 fmtUptime: function (s) {
   s = +s || 0; var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
   return (d ? d + 'd ' : '') + h + 'h ' + m + 'm';
 },
 row: function (label, node) { return E('div', {}, [ E('label', {}, this.T(label)), node ]); },
 sel: function (opts, val) {
   var s = E('select', {}); opts.forEach(function (o) { var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o;
     s.appendChild(E('option', { value: v, selected: String(v) === String(val) ? '' : null }, l)); }); return s; },
 chk: function (val) { return E('input', { type: 'checkbox', checked: (val === '1' || val === 1 || val === true) ? '' : null }); },
 notify: function (msg, kind) { ui.addNotification(null, E('p', msg), kind || 'info'); },

 rpc: {
  status:    rpc.declare({ object: 'wrtmax', method: 'status' }),
  traffic:   rpc.declare({ object: 'wrtmax', method: 'traffic' }),
  ports:     rpc.declare({ object: 'wrtmax', method: 'ports' }),
  clients:   rpc.declare({ object: 'wrtmax', method: 'clients' }),
  scan:      rpc.declare({ object: 'wrtmax', method: 'scan', timeout: 60000 }),
  assistant: rpc.declare({ object: 'wrtmax', method: 'assistant', timeout: 30000 }),
  fix:       rpc.declare({ object: 'wrtmax', method: 'assistant_fix', params: [ 'id' ] }),
  block:     rpc.declare({ object: 'wrtmax', method: 'client_block', params: [ 'mac' ] }),
  unblock:   rpc.declare({ object: 'wrtmax', method: 'client_unblock', params: [ 'mac' ] }),
  limit:     rpc.declare({ object: 'wrtmax', method: 'client_limit', params: [ 'mac', 'down', 'up' ] }),
  apply:     rpc.declare({ object: 'wrtmax', method: 'apply_config' }),
  saveset:   rpc.declare({ object: 'wrtmax', method: 'save_settings' }),
  mode:      rpc.declare({ object: 'wrtmax', method: 'apply_mode',
               params: [ 'mode', 'ip', 'mask', 'gw', 'dns', 'band', 'ssid', 'key', 'bssid', 'wan_proto', 'user', 'pass', 'wan_ip', 'wan_mask', 'wan_gw' ] }),
  ota:       rpc.declare({ object: 'wrtmax', method: 'ota', params: [ 'action' ], timeout: 120000 }),
  loopstate: rpc.declare({ object: 'wrtmax', method: 'loop_state' }),
  loopreset: rpc.declare({ object: 'wrtmax', method: 'loop_reset', params: [ 'port' ] }),
  cpu:       rpc.declare({ object: 'wrtmax', method: 'cpu_status' }),
  reg:       rpc.declare({ object: 'wrtmax', method: 'reg_status', timeout: 20000 }),
  qos:       rpc.declare({ object: 'wrtmax', method: 'qos_status' }),
  offload:   rpc.declare({ object: 'wrtmax', method: 'offload_status' })
 }
});
