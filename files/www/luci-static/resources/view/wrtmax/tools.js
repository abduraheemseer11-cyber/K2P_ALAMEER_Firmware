'use strict';
'require view';
'require uci';
'require rpc';
'require wrtmax.common as wm';

var sysReboot = rpc.declare({ object: 'system', method: 'reboot' });

return view.extend({
 load: function () { return uci.load('wrtmax'); },
 render: function () {
  var T = wm.T.bind(wm), s = {};
  function opt(sec, o, d) { var v = uci.get('wrtmax', sec, o); return v == null ? d : v; }
  function text(sec, o, ph) { return E('input', { type: 'text', value: opt(sec, o, ''), placeholder: ph || '' }); }
  function num(sec, o, d) { return E('input', { type: 'number', min: 0, value: opt(sec, o, d) }); }

  /* ---- speed test ---- */
  var sp = E('div', { 'class': 'v' }, '–'), spBtn;
  function speed() {
    spBtn.disabled = true; sp.textContent = 'Testing download…';
    var t0 = performance.now(), mb = 8, res = {};
    fetch('/cgi-bin/wrtmax-speed?mb=' + mb + '&t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.arrayBuffer(); }).then(function (b) {
      res.dl = b.byteLength * 8 / ((performance.now() - t0) / 1000) / 1e6; sp.textContent = '↓ ' + res.dl.toFixed(1) + ' Mbps · testing upload…';
      var blob = new Blob([ new Uint8Array(4 * 1048576) ]), t1 = performance.now();
      return fetch('/cgi-bin/wrtmax-speed', { method: 'POST', body: blob }).then(function () {
        res.ul = blob.size * 8 / ((performance.now() - t1) / 1000) / 1e6; });
    }).then(function () { sp.textContent = '↓ ' + res.dl.toFixed(1) + ' Mbps   ↑ ' + res.ul.toFixed(1) + ' Mbps'; })
      .catch(function () { sp.textContent = 'Test failed'; }).then(function () { spBtn.disabled = false; });
  }
  spBtn = E('button', { 'class': 'wm-btn', click: speed }, T('Speed test'));

  /* ---- assistant ---- */
  var asBox = E('div', {});
  function assist() {
    asBox.innerHTML = 'Checking…';
    wm.rpc.assistant().then(function (r) {
      var it = (r && r.items) || []; asBox.innerHTML = '';
      if (!it.length) asBox.appendChild(E('p', {}, [ E('span', { 'class': 'wm-tag ok' }, 'OK'), ' Everything looks good.' ]));
      it.forEach(function (x) {
        asBox.appendChild(E('div', { style: 'margin:8px 0' }, [ E('span', { 'class': 'wm-tag ' + (x.level === 'bad' ? 'bad' : x.level === 'warn' ? 'warn' : 'info') }, x.level), ' ', E('b', {}, x.title),
          E('div', { 'class': 'wm-note' }, x.detail),
          x.fix ? E('button', { 'class': 'wm-btn alt', click: function () { wm.rpc.fix(x.id).then(assist); } }, T('Fix')) : '' ]));
      });
    });
  }

  /* ---- OTA ---- */
  s.ota = text('ota', 'url', 'https://your-server/wrtmax/k2p'); var otaOut = E('p', { 'class': 'wm-note' });
  function ota(act) {
    uci.set('wrtmax', 'ota', 'url', s.ota.value); uci.save().then(function () { return wm.rpc.saveset(); }).then(function () { return wm.rpc.ota(act); }).then(function (r) {
      if (!r.ok) { otaOut.textContent = 'Error: ' + r.error; return; }
      if (act === 'apply') { otaOut.textContent = 'Flashing… the router reboots in about 2 minutes. Do not unplug it.'; return; }
      otaOut.innerHTML = ''; otaOut.appendChild(document.createTextNode('Installed: ' + r.current + ' · Latest: ' + r.latest + ' '));
      if (r.update) otaOut.appendChild(E('button', { 'class': 'wm-btn', click: function () { if (confirm('Flash firmware ' + r.latest + '? Settings are kept.')) ota('apply'); } }, 'Install ' + r.latest));
    });
  }

  /* ---- protection / watchdog ---- */
    s.w = wm.chk(opt('watchdog', 'enabled', '1')); s.wt = text('watchdog', 'target', 'empty = gateway'); s.wf = num('watchdog', 'fails', 5);
  s.ww = wm.chk(opt('watchdog', 'wifi', '1')); s.wr = wm.chk(opt('watchdog', 'reboot_on_fail', '0')); s.wa = text('watchdog', 'reboot_at', 'HH:MM e.g. 04:00');
  function saveSet() {
    var m = {
      watchdog: { enabled: s.w.checked, target: s.wt.value, fails: s.wf.value, wifi: s.ww.checked, reboot_on_fail: s.wr.checked, reboot_at: s.wa.value } };
    Object.keys(m).forEach(function (sec) { Object.keys(m[sec]).forEach(function (o) { var v = m[sec][o]; uci.set('wrtmax', sec, o, v === true ? '1' : v === false ? '0' : String(v)); }); });
    return uci.save().then(function () { return wm.rpc.saveset(); }).then(function () { wm.notify('Saved.'); });
  }
  var frm = function (title, rows) { return E('div', { 'class': 'wm-card wm-form' }, [ E('h4', {}, title) ].concat(rows.map(function (r) { return wm.row(r[0], r[1]); }))); };

  return E('div', {}, [ wm.brandbar(T('Tools & Updates')),
    E('div', { 'class': 'wm-card' }, [ E('h4', {}, T('Speed test')), sp, spBtn, E('p', { 'class': 'wm-note' }, 'Measures the link between this phone/PC and the router. For router-to-server tests use iperf3 over SSH.') ]),
    E('div', { 'class': 'wm-card' }, [ E('h4', {}, T('Assistant')), E('button', { 'class': 'wm-btn', click: assist }, 'Check now'), asBox ]),
    frm(T('Watchdog'), [ [ 'Enabled', s.w ], [ 'Ping target', s.wt ], [ 'Failures before restart (minutes)', s.wf ], [ 'Restart Wi-Fi if a radio is down', s.ww ],
      [ 'Reboot after 3 failed network restarts', s.wr ], [ 'Daily reboot at', s.wa ] ]),
    E('button', { 'class': 'wm-btn', click: saveSet }, T('Save & Apply')),
    E('div', { 'class': 'wm-card wm-form', style: 'margin-top:14px' }, [ E('h4', {}, T('Updates') + ' (OTA)'), wm.row('Update server URL', s.ota),
      E('button', { 'class': 'wm-btn', click: function () { ota('check'); } }, T('Check for updates')), otaOut ]),
    E('div', { 'class': 'wm-card' }, [ E('h4', {}, T('Backup & Clone')),
      E('p', { 'class': 'wm-note' }, 'Download the full settings file here, then restore it on other WrtMax routers to clone one configuration to many devices. A factory reset always returns to the WrtMax defaults.'),
      E('a', { 'class': 'wm-btn', href: L.url('admin/system/flash') }, 'Open Backup / Flash') ]),
    E('div', { 'class': 'wm-card' }, [ E('button', { 'class': 'wm-btn bad', click: function () { if (confirm('Reboot now?')) sysReboot(); } }, T('Reboot')) ])
  ]);
 },
 handleSave: null, handleSaveApply: null, handleReset: null
});
