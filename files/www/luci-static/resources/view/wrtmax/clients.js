'use strict';
'require view';
'require poll';
'require wrtmax.common as wm';

/* kbit/s <-> {value, unit} */
function split(k) { k = +k || 0; return (k >= 1000 && k % 1000 === 0) ? { v: k / 1000, u: 'M' } : { v: k, u: 'K' }; }
function toK(v, u) { v = +v || 0; return Math.round(u === 'M' ? v * 1000 : v); }

return view.extend({
 load: function () { return Promise.all([ wm.rpc.clients(), wm.rpc.qos().catch(function () { return {}; }) ]); },
 render: function (d) {
  var T = wm.T.bind(wm), box = E('div', {}), editing = false, qosBox = E('p', { 'class': 'wm-note' });
  function unitBox(k) {
    var s = split(k), i = E('input', { type: 'number', min: 0, value: s.v }), u = wm.sel([ [ 'K', 'Kbps' ], [ 'M', 'Mbps' ] ], s.u);
    [ i, u ].forEach(function (x) { x.addEventListener('focus', function () { editing = true; }); x.addEventListener('blur', function () { editing = false; }); });
    return { i: i, u: u, node: E('div', { 'class': 'wm-unit' }, [ i, u ]), get: function () { return toK(i.value, u.value); } };
  }
  function paintQos(q) {
    q = q || {};
    qosBox.textContent = 'Shaping engine: tc HTB + ' + (q.qdisc || 'fq_codel') + ' + IFB · ' + (q.enabled ? 'on' : 'off') + ' · ' + (q.clients || 0) + ' limited client(s)';
  }
  function paint(r) {
    if (editing) return;
    var cl = (r && r.clients) || [], bl = (r && r.blocked) || [], rows = cl.map(function (c) {
      var dn = unitBox(c.down), up = unitBox(c.up);
      return E('tr', {}, [ E('td', {}, [ E('b', {}, c.name || '—'), E('div', { 'class': 'wm-note' }, c.ssid) ]), E('td', {}, c.ip || '—'), E('td', {}, c.mac),
        E('td', {}, c.band === '2g' ? '2.4G' : '5G'), E('td', {}, c.signal + ' dBm'),
        E('td', {}, [ E('div', { 'class': 'wm-note' }, '↓ ' + T('Download limit')), dn.node, E('div', { 'class': 'wm-note' }, '↑ ' + T('Upload limit')), up.node, E('div', { 'class': 'wm-note' }, '0 = off') ]),
        E('td', {}, [ E('button', { 'class': 'wm-btn alt', click: function () {
              wm.rpc.limit(c.mac, dn.get(), up.get()).then(function () { wm.notify(T('Limit') + ' OK'); return wm.rpc.qos().then(paintQos); }); } }, T('Limit')),
          E('button', { 'class': 'wm-btn bad', click: function () { if (confirm('Block ' + c.mac + '?')) wm.rpc.block(c.mac).then(refresh); } }, T('Block')) ]) ]);
    });
    box.innerHTML = '';
    box.appendChild(E('div', { 'class': 'wm-card wm-scroll' }, E('table', { 'class': 'wm-table' }, [
      E('thead', {}, E('tr', {}, [ T('Name'), 'IP', 'MAC', T('Band'), T('Signal'), 'QoS', '' ].map(function (h) { return E('th', {}, h); }))),
      E('tbody', {}, rows.length ? rows : E('tr', {}, E('td', { colspan: 7 }, 'No Wi-Fi clients connected.'))) ])));
    if (bl.length) box.appendChild(E('div', { 'class': 'wm-card' }, [ E('h4', {}, 'Blocked'),
      E('div', {}, bl.map(function (m) { return E('button', { 'class': 'wm-btn alt', click: function () { wm.rpc.unblock(m).then(refresh); } }, T('Unblock') + ' ' + m); })) ]));
  }
  function refresh() { return wm.rpc.clients().then(paint); }
  paint(d[0]); paintQos(d[1]); poll.add(refresh, 8);
  return E('div', {}, [ wm.brandbar(T('Clients & QoS')), box, qosBox,
    E('p', { 'class': 'wm-note' }, 'Independent download and upload caps per device (MAC). Traffic is queued and shaped (HTB + fq_codel/cake, uploads via IFB) - no packets are dropped by a policer, so ping stays low. Limits survive roaming between the 2.4 and 5 GHz radios.') ]);
 },
 handleSave: null, handleSaveApply: null, handleReset: null
});
