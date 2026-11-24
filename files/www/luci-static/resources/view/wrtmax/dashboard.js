'use strict';
'require view';
'require poll';
'require wrtmax.common as wm';

return view.extend({
 load: function () { return Promise.all([ wm.rpc.status(), wm.rpc.ports(), wm.rpc.traffic(), wm.rpc.offload().catch(function () { return {}; }) ]); },
 render: function (d) {
  var T = wm.T.bind(wm), st = d[0] || {}, self = this, last = null, el = {};
  function card(key, label, wide) {
    el[key] = E('div', { 'class': 'v' }, '–'); el[key + 's'] = E('div', { 'class': 's' }, '');
    el[key + 'b'] = E('div', { 'class': 'wm-bar' }, E('i', { style: 'width:0%' }));
    return E('div', { 'class': 'wm-card' + (wide ? ' wm-wide' : '') }, [ E('h4', {}, T(label)), el[key], el[key + 's'], el[key + 'b'] ]);
  }
  el.ports = E('div', { 'class': 'wm-ports' });
  var root = E('div', {}, [
   wm.brandbar(T('Dashboard'), (st.model || 'Phicomm K2P') + ' · ' + (st.version ? 'v' + st.version : '')),
   E('div', { 'class': 'wm-grid' }, [
     card('cpu', 'CPU load'), card('ram', 'RAM used'), card('up', 'Uptime'), card('temp', 'Temperature'),
     card('dl', 'Download'), card('ul', 'Upload'), card('c2', 'Clients 2.4GHz'), card('c5', 'Clients 5GHz'), card('hw', 'Hardware NAT'), card('pw', 'CPU & Power') ]),
   E('div', { 'class': 'wm-grid' }, [
     E('div', { 'class': 'wm-card wm-wide' }, [ E('h4', {}, T('Ports')), el.ports ]),
     E('div', { 'class': 'wm-card wm-wide' }, [ E('h4', {}, T('Firmware')),
        E('div', { 'class': 's' }, [ T('Mode') + ': ', E('b', {}, st.mode || '-'), ' · ' + T('LAN address') + ': ', E('b', {}, st.lan_ip || '-'),
          ' · OpenWrt ' + (st.openwrt || '-') + ' · build ' + (st.build || '-') ]),
        E('div', { 'class': 's' }, T('Support') + ': ' + (st.support || '776 538 297')) ])
   ])
  ]);
  function setBar(k, pct) { el[k + 'b'].firstChild.style.width = Math.max(0, Math.min(100, pct)) + '%'; }
  function paintPorts(ps) {
    el.ports.innerHTML = '';
    (ps || []).forEach(function (p) {
      el.ports.appendChild(E('div', { 'class': 'wm-port' + (p.link ? ' up' : '') }, [
        E('b', {}, p.name.toUpperCase()), E('div', {}, p.link ? (p.speed >= 1000 ? p.speed / 1000 + 'G' : p.speed + 'M') : '—') ]));
    });
  }
  function paintStatus(s) {
    el.cpu.textContent = s.load || '–'; el.cpus.textContent = s.cpu_khz ? Math.round(s.cpu_khz / 1000) + ' MHz' : 'MT7621A'; setBar('cpu', (+s.load || 0) * 50);
    el.ram.textContent = (s.mem_pct || 0) + ' %'; el.rams.textContent = Math.round((s.mem_total - s.mem_free) / 1024) + ' / ' + Math.round(s.mem_total / 1024) + ' MB'; setBar('ram', s.mem_pct);
    el.up.textContent = wm.fmtUptime(s.uptime);
    el.temp.textContent = s.temp != null ? s.temp + ' °C' : 'N/A'; el.temps.textContent = s.temp_src || '';
    el.pw.textContent = (s.cores_online || '-') + ' cores'; el.pws.textContent = s.cpu_khz ? Math.round(s.cpu_khz / 1000) + ' MHz' : 'fixed clock';
    el.c2.textContent = s.clients_2g; el.c5.textContent = s.clients_5g;
  }
  function paintTraffic(t) {
    if (last && t.up > last.up) {
      var dt = t.up - last.up, rx = (t.rx - last.rx) / dt, tx = (t.tx - last.tx) / dt;
      el.dl.textContent = wm.fmtRate(rx); el.ul.textContent = wm.fmtRate(tx);
      setBar('dl', rx * 8 / 1e6 / 10); setBar('ul', tx * 8 / 1e6 / 10);
    }
    last = t;
  }
  function paintOff(o) {
    o = o || {}; el.hw.textContent = o.flowtable ? (o.hw_flag ? 'ON (HW flag)' : 'ON (software)') : (o.uci_sw ? 'pending' : 'OFF');
    el.hws.textContent = 'flowtable ' + (o.flowtable ? 'active' : 'inactive') + ' · conntrack ' + (o.conntrack || 0);
  }
  paintOff(d[3]);
  paintStatus(st); paintPorts((d[1] || {}).ports); paintTraffic(d[2] || {});
  poll.add(function () { return Promise.all([ wm.rpc.traffic(), wm.rpc.status(), wm.rpc.ports(), wm.rpc.offload() ]).then(function (r) {
    paintTraffic(r[0]); paintStatus(r[1]); paintPorts(r[2].ports); paintOff(r[3]); }); }, 3);
  return root;
 },
 handleSave: null, handleSaveApply: null, handleReset: null
});
