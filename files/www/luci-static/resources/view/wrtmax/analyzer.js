'use strict';
'require view';
'require uci';
'require wrtmax.common as wm';

var CAND = { '2g': [ 1, 6, 11 ], '5g': [ 36, 40, 44, 48, 149, 153, 157, 161 ] };
var RANGE = { '2g': [ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13 ], '5g': [ 36, 40, 44, 48, 149, 153, 157, 161, 165 ] };
var RANGEX = { '2g': [ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14 ], '5g': [ 36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144, 149, 153, 157, 161, 165, 169, 173, 177 ] };
var CANDX = { '2g': [ 1, 6, 11 ], '5g': [ 36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 149, 153, 157, 161, 165, 169, 173, 177 ] };

function score(band, ch, nets) {
  var s = 0;
  nets.forEach(function (n) {
    if (n.band !== band) return;
    var w = band === '2g' ? Math.max(0, (5 - Math.abs(n.channel - ch)) / 5) : (n.channel === ch ? 1 : 0);
    s += w * Math.max(0, n.signal + 100);
  });
  return s;
}

return view.extend({
 load: function () { return Promise.all([ uci.load('wireless'), uci.load('wrtmax') ]); },
 render: function () {
  var T = wm.T.bind(wm), out = E('div', {}), best = {}, X = uci.get('wrtmax', 'wifi', 'super') === '1', RG = X ? RANGEX : RANGE, CD = X ? CANDX : CAND;
  function chart(band, nets, own) {
    var ch = RG[band], sc = ch.map(function (c) { return score(band, c, nets); }), max = Math.max.apply(null, sc.concat([ 60 ]));
    var bars = E('div', { 'class': 'wm-chart' }), lbl = E('div', { 'class': 'wm-lbls' });
    ch.forEach(function (c, i) {
      var pct = Math.min(100, Math.round(sc[i] / max * 100));
      bars.appendChild(E('div', {}, [ pct + '%', E('i', { style: 'height:' + Math.max(2, pct * 1.15) + 'px' + (own[band] === c ? ';outline:2px solid #1f9d63' : '') }) ]));
      lbl.appendChild(E('span', {}, c));
    });
    var cand = CD[band].map(function (c) { return [ c, score(band, c, nets) ]; }).sort(function (a, b) { return a[1] - b[1]; });
    best[band] = cand[0][0];
    return E('div', { 'class': 'wm-card' }, [ E('h4', {}, (band === '2g' ? '2.4 GHz' : '5 GHz') + ' · ' + T('Interference')), bars, lbl,
      E('p', { 'class': 'wm-note' }, 'Current channel: ' + (own[band] || '?') + ' · cleanest: ' + best[band]),
      E('button', { 'class': 'wm-btn', click: function () { setBest(band); } }, T('Auto best channel') + ' → ' + best[band]) ]);
  }
  function setBest(band) {
    uci.sections('wireless', 'wifi-device').forEach(function (s) {
      var b = s.band || (s.hwmode === '11a' ? '5g' : '2g');
      if (b === band) uci.set('wireless', s['.name'], 'channel', String(best[band]));
    });
    uci.save().then(function () { return wm.rpc.apply(); }).then(function () { wm.notify('Channel ' + best[band] + ' applied.'); });
  }
  function run(btn) {
    btn.disabled = true; btn.textContent = 'Scanning…'; out.innerHTML = '';
    wm.rpc.scan().then(function (r) {
      var nets = r.nets || [], own = r.own || {};
      [ '2g', '5g' ].forEach(function (b) { if (nets.some(function (n) { return n.band === b; }) || own[b]) out.appendChild(chart(b, nets, own)); });
      var rows = nets.sort(function (a, b) { return b.signal - a.signal; }).map(function (n) {
        return E('tr', {}, [ E('td', {}, n.ssid || '(hidden)'), E('td', {}, n.band === '2g' ? '2.4G' : '5G'), E('td', {}, n.channel), E('td', {}, n.signal + ' dBm'), E('td', {}, n.bssid) ]); });
      out.appendChild(E('div', { 'class': 'wm-card wm-scroll' }, E('table', { 'class': 'wm-table' }, [
        E('thead', {}, E('tr', {}, [ 'SSID', T('Band'), T('Channel'), T('Signal'), 'BSSID' ].map(function (h) { return E('th', {}, h); }))), E('tbody', {}, rows) ])));
    }).catch(function () { wm.notify('Scan failed – is Wi-Fi enabled?', 'danger'); })
      .then(function () { btn.disabled = false; btn.textContent = T('Scan'); });
  }
  var btn = E('button', { 'class': 'wm-btn', click: function () { run(btn); } }, T('Scan'));
  return E('div', {}, [ wm.brandbar(T('Spectrum Analyzer')), btn,
    E('p', { 'class': 'wm-note' }, 'A scan briefly interrupts connected Wi-Fi clients (a few seconds). Green outline = your current channel.'), out ]);
 },
 handleSave: null, handleSaveApply: null, handleReset: null
});
