'use strict';
'require view';
'require uci';
'require poll';
'require wrtmax.common as wm';

var PORTS = [ 'lan1', 'lan2', 'lan3', 'lan4', 'wan' ];

return view.extend({
 load: function () { return Promise.all([ uci.load('wrtmax'), wm.rpc.loopstate().catch(function () { return { running: false }; }) ]); },
 render: function (d) {
  var T = wm.T.bind(wm), s = {}, roles = {}, live = E('div', {}), editing = false;
  function opt(sec, o, dflt) { var v = uci.get('wrtmax', sec, o); return v == null ? dflt : v; }
  function num(sec, o, dflt) { return E('input', { type: 'number', min: 0, value: opt(sec, o, dflt) }); }

  /* ---- live loop state ---- */
  function paint(st) {
    st = st || {}; live.innerHTML = '';
    if (!st.running) { live.appendChild(E('div', { 'class': 'wm-alert warn' }, 'wrtmax-loopguard is not running.')); return; }
    var iso = (st.ports || []).filter(function (p) { return p.isolated; });
    iso.forEach(function (p) {
      live.appendChild(E('div', { 'class': 'wm-alert bad' }, [ '⚠ ' + T('Loop detected') + ' · ' + p.name.toUpperCase() + ' → ' + T('Isolated') + ': ' + p.reason + ' (' + new Date(p.since * 1000).toLocaleTimeString() + ') ',
        E('button', { 'class': 'wm-btn alt', click: function () { wm.rpc.loopreset(p.name).then(function () { wm.rpc.loopstate().then(paint); }); } }, T('Reset Isolated Port')) ]));
    });
    if (st.alert) live.appendChild(E('div', { 'class': 'wm-alert warn' }, '⚠ ' + st.alert.msg));
    if (!iso.length && !st.alert) live.appendChild(E('p', {}, [ E('span', { 'class': 'wm-tag ok' }, 'OK'), ' No loop detected · probe every ' + st.probe_ms + ' ms · ' + st.loops + ' event(s) since start' ]));
    var ev = (st.events || []).slice(-8).reverse();
    if (ev.length) live.appendChild(E('div', { 'class': 'wm-note' }, ev.map(function (e) { return E('div', {}, new Date(e.t * 1000).toLocaleTimeString() + '  ' + e.port + '  ' + e.msg); })));
  }
  paint(d[1]); poll.add(function () { return wm.rpc.loopstate().then(paint); }, 2);

  /* ---- roles ---- */
  var tb = E('tbody', {});
  PORTS.forEach(function (p) {
    roles[p] = wm.sel([ [ 'auto', T('Auto') ], [ 'uplink', T('Uplink') ], [ 'downlink', T('Downlink') ] ], opt(p, 'role', 'auto'));
    tb.appendChild(E('tr', {}, [ E('td', {}, E('b', {}, p === 'wan' ? 'WAN (LAN5)' : p.toUpperCase())), E('td', {}, roles[p]) ]));
  });

  s.g = wm.chk(opt('guard', 'enabled', '1')); s.pr = E('input', { type: 'text', value: opt('guard', 'protect', ''), placeholder: 'extra IPs to protect' });
  s.l = wm.chk(opt('loop', 'enabled', '1')); s.pm = num('loop', 'probe_ms', 100); s.sp = num('loop', 'storm_pps', 20000);
  s.rc = num('loop', 'recover_s', 0); s.stp = wm.chk(opt('loop', 'stp', '0'));
  function save() {
    var m = { guard: { enabled: s.g.checked, protect: s.pr.value }, loop: { enabled: s.l.checked, probe_ms: s.pm.value, storm_pps: s.sp.value, recover_s: s.rc.value, stp: s.stp.checked } };
    Object.keys(m).forEach(function (sec) { Object.keys(m[sec]).forEach(function (o) { var v = m[sec][o]; uci.set('wrtmax', sec, o, v === true ? '1' : v === false ? '0' : String(v)); }); });
    PORTS.forEach(function (p) { uci.set('wrtmax', p, 'role', roles[p].value); });
    return uci.save().then(function () { return wm.rpc.saveset(); }).then(function () { wm.notify('Saved.'); });
  }
  var frm = function (title, rows) { return E('div', { 'class': 'wm-card wm-form' }, [ E('h4', {}, title) ].concat(rows.map(function (r) { return wm.row(r[0], r[1]); }))); };
  return E('div', {}, [ wm.brandbar(T('Protection & Loop')),
    E('div', { 'class': 'wm-card' }, [ E('h4', {}, 'Layer-2 loop guard (live)'), live ]),
    E('div', { 'class': 'wm-card wm-scroll' }, [ E('h4', {}, T('Port roles')), E('table', { 'class': 'wm-table' }, [ E('thead', {}, E('tr', {}, [ 'Port', T('Role') ].map(function (h) { return E('th', {}, h); }))), tb ]),
      E('p', { 'class': 'wm-note' }, 'Uplink ports are never shut down (a loop touching only uplinks raises an alert instead) and are the only wired ports allowed to offer DHCP when at least one uplink is set. Auto/Downlink ports can be isolated.') ]),
    frm(T('Protection'), [ [ 'Anti ARP-spoof / rogue DHCP / NetCut guard', s.g ], [ 'Extra protected IPs', s.pr ], [ 'Loop detection + storm protection', s.l ],
      [ 'Probe interval (ms, 20-5000)', s.pm ], [ 'Storm threshold (multicast pkts/s)', s.sp ], [ 'Auto-release isolated port after (s, 0 = manual reset only)', s.rc ], [ 'STP on bridge (kernel STP)', s.stp ] ]),
    E('p', { 'class': 'wm-note' }, 'STP: enable only if your upstream switch also runs (R)STP; kernel STP adds a forwarding delay when a port comes up.'),
    E('button', { 'class': 'wm-btn', click: save }, T('Save & Apply')) ]);
 },
 handleSave: null, handleSaveApply: null, handleReset: null
});
