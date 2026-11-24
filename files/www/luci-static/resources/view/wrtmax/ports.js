'use strict';
'require view';
'require uci';
'require wrtmax.common as wm';

return view.extend({
 load: function () { return Promise.all([ uci.load('wrtmax'), wm.rpc.ports() ]); },
 render: function (d) {
  var T = wm.T.bind(wm), links = {}, rows = [];
  ((d[1] || {}).ports || []).forEach(function (p) { links[p.name] = p; });
  var merge = wm.chk(uci.get('wrtmax', 'net', 'merge_wan')), tb = E('tbody', {});
  [ 'lan1', 'lan2', 'lan3', 'lan4', 'wan' ].forEach(function (p) {
    var l = links[p] || {}, c = {};
    c.vlan = E('input', { type: 'number', min: 1, max: 4094, value: uci.get('wrtmax', p, 'vlan') || 1 });
    c.tag = E('input', { type: 'text', placeholder: 'e.g. 10 20 30', value: uci.get('wrtmax', p, 'tagged') || '' });
    c.sp = wm.sel([ [ 'auto', 'Auto (up to 1G)' ], [ '100', '100M full' ], [ '10', '10M full' ] ], uci.get('wrtmax', p, 'speed') || 'auto');
    rows.push({ p: p, c: c });
    tb.appendChild(E('tr', {}, [ E('td', {}, E('b', {}, p === 'wan' ? 'WAN (LAN5)' : p.toUpperCase())),
      E('td', {}, [ E('span', { 'class': 'wm-tag ' + (l.link ? 'ok' : 'bad') }, l.link ? (l.speed + 'M') : 'down'), ' ',
        l.isolated ? E('span', { 'class': 'wm-tag bad' }, T('Isolated')) : '', ' ', E('span', { 'class': 'wm-tag info' }, T(l.role === 'uplink' ? 'Uplink' : l.role === 'downlink' ? 'Downlink' : 'Auto')) ]), E('td', {}, c.vlan), E('td', {}, c.tag), E('td', {}, c.sp) ]));
  });
  function save() {
    uci.set('wrtmax', 'net', 'merge_wan', merge.checked ? '1' : '0');
    rows.forEach(function (r) {
      var v = parseInt(r.c.vlan.value) || 1, tg = r.c.tag.value.replace(/[^0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
      uci.set('wrtmax', r.p, 'vlan', String(v)); uci.set('wrtmax', r.p, 'tagged', tg); uci.set('wrtmax', r.p, 'speed', r.c.sp.value);
    });
    if (!confirm('Apply port settings? The network restarts and you may lose access if the port you use changes VLAN.')) return;
    return uci.save().then(function () { return wm.rpc.apply(); }).then(function () { wm.notify('Applied.'); });
  }
  return E('div', {}, [ wm.brandbar(T('Ports') + ' & VLAN'),
    E('div', { 'class': 'wm-card wm-form' }, [ E('label', {}, [ merge, ' ' + T('Merge WAN as LAN5') ]),
      E('p', { 'class': 'wm-note' }, 'ON = the WAN port joins the LAN bridge (five LAN ports). Turn OFF only in Home Router / WISP use.') ]),
    E('div', { 'class': 'wm-card wm-scroll' }, E('table', { 'class': 'wm-table' }, [
      E('thead', {}, E('tr', {}, [ 'Port', T('Link'), T('Access VLAN'), T('Tagged VLANs'), T('Speed') ].map(function (h) { return E('th', {}, h); }))), tb ])),
    E('p', { 'class': 'wm-note' }, 'Uplink/Downlink roles and loop alerts: see "Protection & Loop". Access VLAN 1 = normal untagged LAN. A port with access VLAN N carries only that VLAN untagged. "Tagged VLANs" turns the port into a trunk for the listed VLAN IDs (use it for the uplink to MikroTik).'),
    E('button', { 'class': 'wm-btn', click: save }, T('Save & Apply')) ]);
 },
 handleSave: null, handleSaveApply: null, handleReset: null
});
