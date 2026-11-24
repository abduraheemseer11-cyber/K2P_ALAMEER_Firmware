'use strict';
'require view';
'require uci';
'require poll';
'require wrtmax.common as wm';

return view.extend({
 load: function () { return Promise.all([ uci.load('wrtmax'), wm.rpc.cpu().catch(function () { return {}; }) ]); },
 render: function (d) {
  var T = wm.T.bind(wm), s = {}, live = E('div', { 'class': 'wm-grid' }), note = E('p', { 'class': 'wm-note' });
  function opt(o, dflt) { var v = uci.get('wrtmax', 'cpu', o); return v == null ? dflt : v; }
  function card(h, v, sub) { return E('div', { 'class': 'wm-card' }, [ E('h4', {}, h), E('div', { 'class': 'v' }, v), E('div', { 'class': 's' }, sub || '') ]); }
  function paint(c) {
    c = c || {}; live.innerHTML = '';
    var modeTxt = { cpufreq: 'Kernel cpufreq', parking: 'Core parking + IRQ tuning', 'irq-only': 'IRQ tuning only', off: 'Disabled', stopped: 'Not running' }[c.mode] || c.mode || '-';
    live.appendChild(card('Mode', modeTxt, c.cpufreq ? 'cpufreq: ' + (c.kernel_governor || '') + (c.cur_khz ? ' · ' + Math.round(c.cur_khz / 1000) + ' MHz' : '') : 'MT7621A clock is fixed by the SoC PLL'));
    live.appendChild(card(T('Governor'), c.governor || '-', 'CPU ' + (c.util != null ? c.util : '-') + ' %'));
    live.appendChild(card(T('Cores online'), (c.cores_online || '-') + ' / ' + (c.cores_total || '-'), c.can_park ? 'core parking available' : 'core parking not available in this kernel'));
    live.appendChild(card(T('Temperature'), c.temp != null ? c.temp + ' °C' : 'N/A', ''));
    note.textContent = c.cpufreq ? 'Real kernel governors are active.'
      : 'The kernel has no cpufreq driver for the MT7621A PLL, so governors are implemented by wrtmax-cpugov: performance = all cores, powersave = second core parked, ondemand/schedutil/conservative/adaptive = park/unpark by load with hysteresis and a thermal guard (80 °C).';
  }
  paint(d[1]); poll.add(function () { return wm.rpc.cpu().then(paint); }, 3);
  s.en = wm.chk(opt('enabled', '1'));
  s.gov = wm.sel([ [ 'adaptive', 'Adaptive (daemon)' ], [ 'performance', 'Performance' ], [ 'powersave', 'Powersave' ], [ 'ondemand', 'Ondemand' ], [ 'conservative', 'Conservative' ], [ 'schedutil', 'Schedutil' ] ], opt('governor', 'adaptive'));
  s.iv = E('input', { type: 'number', min: 1, max: 60, value: opt('interval', '5') });
  s.irq = wm.chk(opt('irq_tune', '1'));
  s.mn = E('input', { type: 'number', value: opt('min_khz', ''), placeholder: 'kHz (cpufreq only)' });
  s.mx = E('input', { type: 'number', value: opt('max_khz', ''), placeholder: 'kHz (cpufreq only)' });
  function save() {
    var m = { enabled: s.en.checked ? '1' : '0', governor: s.gov.value, interval: s.iv.value, irq_tune: s.irq.checked ? '1' : '0', min_khz: s.mn.value, max_khz: s.mx.value };
    Object.keys(m).forEach(function (o) { uci.set('wrtmax', 'cpu', o, m[o]); });
    return uci.save().then(function () { return wm.rpc.saveset(); }).then(function () { wm.notify('Saved.'); });
  }
  var frm = E('div', { 'class': 'wm-card wm-form' }, [ E('h4', {}, T('CPU & Power')),
    wm.row('Enabled', s.en), wm.row('Governor', s.gov), wm.row('Sampling interval (s)', s.iv), wm.row('Balance Ethernet / PCIe interrupts over the CPUs', s.irq),
    wm.row('Min frequency', s.mn), wm.row('Max frequency', s.mx) ]);
  return E('div', {}, [ wm.brandbar(T('CPU & Power')), live, note, frm,
    E('p', { 'class': 'wm-note' }, 'This page never changes any Wi-Fi radio, channel, power or driver parameter.'),
    E('button', { 'class': 'wm-btn', click: save }, T('Save & Apply')) ]);
 },
 handleSave: null, handleSaveApply: null, handleReset: null
});
