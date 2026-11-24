'use strict';
'require view';
'require uci';
'require wrtmax.common as wm';

return view.extend({
 load: function () { return Promise.all([ uci.load('wrtmax'), uci.load('network') ]); },
 render: function () {
  var T = wm.T.bind(wm), mode = uci.get('wrtmax', 'net', 'mode') || 'ap', f = {};
  var modes = [
   [ 'ap', 'Access Point', 'Wired + Wi-Fi bridged behind your MikroTik / main router. DHCP off.' ],
   [ 'bridge', 'Wireless Bridge', 'Wi-Fi client (WDS/4addr) bridged to LAN – real MAC passthrough.' ],
   [ 'repeater', 'Repeater', 'Relayd repeater: extend an upstream Wi-Fi in the same subnet.' ],
   [ 'wisp', 'WISP', 'Wi-Fi client is the internet (WAN), router NAT + DHCP for the LAN.' ],
   [ 'router', 'Home Router', 'WAN port: PPPoE / DHCP / static. NAT + DHCP on LAN.' ]
  ];
  var cards = E('div', { 'class': 'wm-modes' });
  var box = E('div', { 'class': 'wm-form wm-card' });
  function inp(k, type, val, ph) { f[k] = E('input', { type: type || 'text', value: val || '', placeholder: ph || '' }); return f[k]; }
  inp('ip', 'text', uci.get('network', 'lan', 'ipaddr') || '192.168.1.20'); inp('mask', 'text', uci.get('network', 'lan', 'netmask') || '255.255.255.0');
  inp('gw', 'text', uci.get('network', 'lan', 'gateway') || ''); inp('dns', 'text', (uci.get('network', 'lan', 'dns') || []).join ? (uci.get('network', 'lan', 'dns') || []).join(',') : '');
  inp('ssid', 'text', '', 'Upstream SSID'); inp('key', 'password', '', 'Upstream password (empty = open)'); inp('bssid', 'text', '', 'Optional BSSID AA:BB:CC:DD:EE:FF');
  f.band = wm.sel([ [ '2g', '2.4 GHz' ], [ '5g', '5 GHz' ] ], '2g');
  f.wan_proto = wm.sel([ [ 'dhcp', 'DHCP' ], [ 'pppoe', 'PPPoE' ], [ 'static', 'Static' ] ], 'dhcp');
  inp('user', 'text', '', 'PPPoE username'); inp('pass', 'password', '', 'PPPoE password');
  inp('wan_ip', 'text'); inp('wan_mask', 'text', '255.255.255.0'); inp('wan_gw', 'text');
  function paint() {
    cards.innerHTML = '';
    modes.forEach(function (m) {
      cards.appendChild(E('div', { 'class': 'wm-mode' + (m[0] === mode ? ' sel' : ''), click: function () { mode = m[0]; paint(); } },
        [ E('b', {}, T(m[1])), E('span', {}, m[2]) ]));
    });
    box.innerHTML = '';
    var lanTitle = (mode === 'router' || mode === 'wisp') ? 'LAN (router address)' : 'Management address';
    box.appendChild(E('h4', {}, lanTitle));
    box.appendChild(wm.row('IP address', f.ip)); box.appendChild(wm.row('Netmask', f.mask));
    if (mode !== 'router' && mode !== 'wisp') { box.appendChild(wm.row('Gateway', f.gw)); box.appendChild(wm.row('DNS', f.dns)); }
    if (mode === 'bridge' || mode === 'repeater' || mode === 'wisp') {
      box.appendChild(E('h4', { style: 'margin-top:14px' }, 'Upstream Wi-Fi'));
      box.appendChild(wm.row('Band', f.band)); box.appendChild(wm.row('Network name (SSID)', f.ssid));
      box.appendChild(wm.row('Password', f.key)); box.appendChild(wm.row('BSSID', f.bssid));
    }
    if (mode === 'router') {
      box.appendChild(E('h4', { style: 'margin-top:14px' }, 'WAN'));
      box.appendChild(wm.row('WAN type', f.wan_proto));
      box.appendChild(wm.row('PPPoE user', f.user)); box.appendChild(wm.row('PPPoE password', f.pass));
      box.appendChild(wm.row('WAN IP (static)', f.wan_ip)); box.appendChild(wm.row('WAN netmask', f.wan_mask)); box.appendChild(wm.row('WAN gateway', f.wan_gw));
    }
  }
  function apply() {
    if ((mode === 'bridge' || mode === 'repeater' || mode === 'wisp') && !f.ssid.value) { wm.notify('Enter the upstream SSID.', 'danger'); return; }
    if (!confirm('Apply "' + mode + '" mode?\nThe router restarts its network and the address may change to ' + f.ip.value + '.')) return;
    var ip = f.ip.value;
    wm.rpc.mode(mode, ip, f.mask.value, f.gw.value, f.dns.value, f.band.value, f.ssid.value, f.key.value, f.bssid.value,
      f.wan_proto.value, f.user.value, f.pass.value, f.wan_ip.value, f.wan_mask.value, f.wan_gw.value);
    var n = 25, msg = E('p', {}); document.body.appendChild(E('div', { style: 'position:fixed;inset:0;background:rgba(20,10,60,.85);color:#fff;display:flex;align-items:center;justify-content:center;z-index:9999;text-align:center;padding:20px' },
      [ E('div', {}, [ E('h2', {}, 'Applying…'), msg ]) ]));
    var t = setInterval(function () {
      msg.textContent = 'Reconnecting to http://' + ip + ' in ' + n + 's (set your device to the same subnet if needed)';
      if (--n < 0) { clearInterval(t); location.href = 'http://' + ip + '/cgi-bin/luci/admin/wrtmax/dashboard'; }
    }, 1000);
  }
  paint();
  return E('div', {}, [ wm.brandbar(T('Quick Setup')), cards, E('div', { style: 'height:12px' }), box,
    E('button', { 'class': 'wm-btn', click: apply }, T('Apply')),
    E('p', { 'class': 'wm-note' }, 'Wi-Fi networks (SSID/password/VLAN) are managed in "Wi-Fi & SSIDs". Repeater mode needs an IP in the same subnet as the upstream network.') ]);
 },
 handleSave: null, handleSaveApply: null, handleReset: null
});
