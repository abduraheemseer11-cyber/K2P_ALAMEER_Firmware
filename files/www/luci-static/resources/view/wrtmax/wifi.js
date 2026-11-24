'use strict';
'require view';
'require uci';
'require wrtmax.common as wm';

var CH2 = [ 'auto', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13 ];
var CH5 = [ 'auto', 36, 40, 44, 48, 149, 153, 157, 161, 165 ];
/* Super Channel (country CT): 2.4 GHz 1-14 (14 = CCK only), 5 GHz 36-177 */
var CH2X = CH2.concat([ 14 ]);
var CH5X = [ 'auto', 36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144, 149, 153, 157, 161, 165, 169, 173, 177 ];

return view.extend({
 load: function () { return Promise.all([ uci.load('wrtmax'), uci.load('wireless'), wm.rpc.reg().catch(function () { return {}; }) ]); },
 render: function (d) {
  var T = wm.T.bind(wm), radios = [], slots = [], g = {}, reg = d[2] || {};
  var superOn = uci.get('wrtmax', 'wifi', 'super') === '1';
  uci.sections('wireless', 'wifi-device').forEach(function (s) {
    var b = s.band || (s.hwmode === '11a' ? '5g' : '2g'); radios.push({ id: s['.name'], band: b, s: s });
  });

  /* ---- Super Channel toggle + live regulatory status ---- */
  g.sup = wm.chk(superOn ? '1' : '0');
  var regBox = E('div', { 'class': 'wm-note' });
  function paintReg(r) {
    regBox.innerHTML = '';
    var rows = (r.phys || []).map(function (p) {
      return T('Active channels') + ' ' + p.phy + ': 2.4G ' + p.ch2_enabled + '/' + p.ch2_total + ' · 5G ' + p.ch5_enabled + '/' + p.ch5_total + ' · max ' + p.max_dbm + ' dBm';
    });
    regBox.appendChild(E('div', {}, 'Regulatory domain: ' + (r.regdom || '?')));
    rows.forEach(function (x) { regBox.appendChild(E('div', {}, x)); });
    if (superOn && r.regdom && r.regdom !== 'CT')
      regBox.appendChild(E('div', { 'class': 'wm-alert warn' }, 'Super Channel is ON but the kernel domain is "' + r.regdom + '" - the CT domain is not active (wireless-regdb build or signature check). See README.'));
  }
  paintReg(reg);
  var supCard = E('div', { 'class': 'wm-card wm-form wm-wide' }, [ E('h4', {}, T('Super Channel (extended frequencies)')),
    E('label', {}, [ g.sup, ' ' + T('Super Channel (extended frequencies)') + ' - country CT: 2.4 GHz ch 1-14, 5 GHz ch 36-177, up to 27 dBm' ]),
    E('p', { 'class': 'wm-note' }, 'Compliance-test domain: no DFS / NO-IR limits. Illegal outside shielded test setups in most countries; the real output is still capped by the radio EEPROM/PA. Channel 14 is CCK (802.11b) only.'),
    E('button', { 'class': 'wm-btn alt', click: function () { wm.rpc.reg().then(paintReg); } }, T('Refresh')), regBox ]);

  var rbox = E('div', { 'class': 'wm-grid' });
  function buildRadios() {
    rbox.innerHTML = '';
    var on = g.sup.checked;
    radios.forEach(function (r) {
      var is5 = r.band === '5g', c = r.c || {}, cur = c.ch ? c.ch.value : (r.s.channel || 'auto');
      c.ch = wm.sel(is5 ? (on ? CH5X : CH5) : (on ? CH2X : CH2), cur);
      c.ht = c.ht || wm.sel(is5 ? [ 'VHT20', 'VHT40', 'VHT80' ] : [ 'HT20', 'HT40' ], r.s.htmode || (is5 ? 'VHT40' : 'HT20'));
      c.tx = c.tx || E('input', { type: 'number', min: 1, max: 30, value: r.s.txpower || (is5 ? 23 : 20) });
      c.tx.max = on ? 27 : 30;
      c.co = c.co || E('input', { type: 'text', maxlength: 2, value: r.s.country || 'US' });
      c.co.disabled = on;
      r.c = c;
      rbox.appendChild(E('div', { 'class': 'wm-card wm-form' }, [ E('h4', {}, (is5 ? '5 GHz' : '2.4 GHz') + ' · ' + r.id),
        wm.row(on ? 'Extended channels' : 'Channel', c.ch), wm.row('Width', c.ht), wm.row('Transmit power', E('div', {}, [ c.tx, ' dBm' ])), wm.row('Country', c.co) ]));
    });
  }
  g.sup.addEventListener('change', function () {
    if (g.sup.checked && !confirm('Enable Super Channel?\n\nThis unlocks frequencies and power that are illegal in most countries outside a test lab. You are responsible for its use.')) { g.sup.checked = false; return; }
    buildRadios();
  });
  buildRadios();

  var ex = E('div', { 'class': 'wm-card wm-form wm-wide' });
  g.roam = wm.chk(uci.get('wrtmax', 'wifi', 'roaming')); g.wds = wm.chk(uci.get('wrtmax', 'wifi', 'wds'));
  g.mesh = wm.chk(uci.get('wrtmax', 'mesh', 'enabled')); g.mband = wm.sel([ [ '2g', '2.4 GHz' ], [ '5g', '5 GHz' ] ], uci.get('wrtmax', 'mesh', 'band'));
  g.mid = E('input', { type: 'text', value: uci.get('wrtmax', 'mesh', 'id') || 'WrtMax-Mesh' });
  g.mkey = E('input', { type: 'password', value: uci.get('wrtmax', 'mesh', 'key') || '', placeholder: '8+ chars (empty = open mesh)' });
  [ [ 'Roaming 802.11k/v/r', g.roam ], [ 'WDS (4addr) on all SSIDs', g.wds ], [ 'Mesh 802.11s', g.mesh ], [ 'Mesh band', g.mband ], [ 'Mesh ID', g.mid ], [ 'Mesh password', g.mkey ] ]
    .forEach(function (x) { ex.appendChild(wm.row(x[0], x[1])); });
  ex.appendChild(E('p', { 'class': 'wm-note' }, '802.11r is applied only to SSIDs that have a password (WPA2). 11k/11v are always on.'));

  var tb = E('tbody', {});
  for (var n = 1; n <= 8; n++) {
    var k = 'ssid' + n, c = {};
    c.en = wm.chk(uci.get('wrtmax', k, 'enabled')); c.band = wm.sel([ [ '2g', '2.4G' ], [ '5g', '5G' ] ], uci.get('wrtmax', k, 'band'));
    c.ssid = E('input', { type: 'text', value: uci.get('wrtmax', k, 'ssid') || '' });
    c.key = E('input', { type: 'password', value: uci.get('wrtmax', k, 'key') || '', placeholder: 'open' });
    c.vlan = E('input', { type: 'number', min: 0, max: 4094, value: uci.get('wrtmax', k, 'vlan') || 0 });
    c.iso = wm.chk(uci.get('wrtmax', k, 'isolate')); c.hid = wm.chk(uci.get('wrtmax', k, 'hidden'));
    slots.push({ k: k, c: c });
    tb.appendChild(E('tr', {}, [ E('td', {}, n), E('td', {}, c.en), E('td', {}, c.band), E('td', {}, c.ssid), E('td', {}, c.key), E('td', {}, c.vlan), E('td', {}, c.iso), E('td', {}, c.hid) ]));
  }
  var tbl = E('div', { 'class': 'wm-card wm-scroll' }, E('table', { 'class': 'wm-table' }, [
    E('thead', {}, E('tr', {}, [ '#', T('Enabled'), T('Band'), 'SSID', T('Password'), 'VLAN', T('Isolate'), T('Hidden') ].map(function (h) { return E('th', {}, h); }))), tb ]));

  function save() {
    var bad = null, on = g.sup.checked;
    slots.forEach(function (s) { var kk = s.c.key.value; if (kk && kk.length < 8) bad = s.c.ssid.value; });
    if (bad) { wm.notify('Password for "' + bad + '" must be 8+ characters or empty.', 'danger'); return; }
    if (on && !superOn) uci.set('wrtmax', 'wifi', 'prev_country', (radios[0] && radios[0].c.co.value) || 'US');
    uci.set('wrtmax', 'wifi', 'super', on ? '1' : '0');
    var prev = uci.get('wrtmax', 'wifi', 'prev_country') || 'US';
    radios.forEach(function (r) {
      var cc = on ? 'CT' : (superOn ? prev : (r.c.co.value || 'US').toUpperCase());
      uci.set('wireless', r.id, 'channel', r.c.ch.value); uci.set('wireless', r.id, 'htmode', r.c.ht.value);
      uci.set('wireless', r.id, 'txpower', r.c.tx.value); uci.set('wireless', r.id, 'country', cc);
    });
    uci.set('wrtmax', 'wifi', 'roaming', g.roam.checked ? '1' : '0'); uci.set('wrtmax', 'wifi', 'wds', g.wds.checked ? '1' : '0');
    uci.set('wrtmax', 'mesh', 'enabled', g.mesh.checked ? '1' : '0'); uci.set('wrtmax', 'mesh', 'band', g.mband.value);
    uci.set('wrtmax', 'mesh', 'id', g.mid.value); uci.set('wrtmax', 'mesh', 'key', g.mkey.value);
    slots.forEach(function (s) { var c = s.c;
      uci.set('wrtmax', s.k, 'enabled', c.en.checked ? '1' : '0'); uci.set('wrtmax', s.k, 'band', c.band.value);
      uci.set('wrtmax', s.k, 'ssid', c.ssid.value); uci.set('wrtmax', s.k, 'key', c.key.value);
      uci.set('wrtmax', s.k, 'vlan', c.vlan.value || '0'); uci.set('wrtmax', s.k, 'isolate', c.iso.checked ? '1' : '0'); uci.set('wrtmax', s.k, 'hidden', c.hid.checked ? '1' : '0'); });
    return uci.save().then(function () { return wm.rpc.apply(); }).then(function () { wm.notify('Applied. Wi-Fi restarts in a few seconds.'); });
  }
  return E('div', {}, [ wm.brandbar(T('Wi-Fi & Driver Control')), supCard, rbox, ex, E('h4', {}, 'SSID slots (up to 8)'), tbl,
    E('p', { 'class': 'wm-note' }, 'VLAN 0/1 = untagged LAN. Any other number puts the SSID in that VLAN (ports are set in "Ports & VLAN"). Transmit power is limited by the regulatory domain, the chip and its EEPROM.'),
    E('button', { 'class': 'wm-btn', click: save }, T('Save & Apply')) ]);
 },
 handleSave: null, handleSaveApply: null, handleReset: null
});
