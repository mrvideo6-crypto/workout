'use strict';
/* ===== Интерфейс: экраны, события, таймер ===== */

var ui = {
  tab: 'workout', screen: 'home', settings: false, edit: null, rest: null, sw: null, picker: null,
  progEdit: null, progDirty: false, bump: null, pex: null, pper: 84, bsel: 'weight', bsub: 'metrics',
  pose: 'front', pfilter: 'all', histN: 8, flash: null, wake: null
};
var photoURLs = {};
var audioCtx = null;

function $(id) { return document.getElementById(id); }
function curW() { return ui.edit || state.active; }
function persist() { if (!ui.edit) save(); }
function fmtDur(sec) {
  sec = Math.max(0, Math.floor(sec));
  var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return h ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
}
function loc() { return state.settings.lang === 'ru' ? 'ru-RU' : 'en-US'; }
function fmtDate(ts) { return new Date(ts).toLocaleDateString(loc(), { day: 'numeric', month: 'short' }); }
function fmtDateLong(ts) { return new Date(ts).toLocaleDateString(loc(), { weekday: 'short', day: 'numeric', month: 'short' }); }
function wdNames() { return t('wd').split(','); }
function toast(msg) {
  var el = $('toast');
  el.textContent = msg;
  el.className = 'show';
  clearTimeout(toast.h);
  toast.h = setTimeout(function () { el.className = ''; }, 3200);
}
function showSheet(h) {
  var s = $('sheet');
  s.innerHTML = '<div class="panel"><div class="grab"></div>' + h + '</div>';
  s.hidden = false;
  loadPhotoImgs();
}
function closeSheet() {
  var s = $('sheet');
  s.hidden = true;
  s.innerHTML = '';
  ui.picker = null;
}
function opt(v, label, sel) { return '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(label) + '</option>'; }

/* ---------- звук и экран ---------- */
function unlockAudio() {
  try {
    if (!audioCtx) { var C = window.AudioContext || window.webkitAudioContext; if (C) audioCtx = new C(); }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) {}
}
function beep() {
  try {
    if (audioCtx) {
      var now = audioCtx.currentTime;
      for (var i = 0; i < 3; i++) {
        var o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.frequency.value = 880; g.gain.value = 0.2;
        o.connect(g); g.connect(audioCtx.destination);
        o.start(now + i * 0.25); o.stop(now + i * 0.25 + 0.15);
      }
    }
  } catch (e) {}
  try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) {}
}
function wakeOn() {
  try {
    if (!state.settings.wake || !navigator.wakeLock || ui.wake) return;
    navigator.wakeLock.request('screen').then(function (l) {
      ui.wake = l;
      l.addEventListener('release', function () { ui.wake = null; });
    }).catch(function () {});
  } catch (e) {}
}
function wakeOff() { try { if (ui.wake) { ui.wake.release().catch(function () {}); ui.wake = null; } } catch (e) {} }

/* ---------- таймер отдыха ---------- */
function startRest(ex) {
  var secs = (ex && ex.rest) || state.settings.rest;
  ui.rest = { end: Date.now() + secs * 1000, total: secs };
  renderTimer();
}
function renderTimer() {
  var el = $('timerbar');
  if (!ui.rest) { el.innerHTML = ''; return; }
  var rem = Math.max(0, Math.ceil((ui.rest.end - Date.now()) / 1000));
  var pct = Math.min(100, Math.max(0, (1 - rem / ui.rest.total) * 100));
  el.innerHTML = '<div class="tb"><div class="fill" id="tbf" style="width:' + pct.toFixed(0) + '%"></div>' +
    '<div class="tt" id="tbt">' + fmtDur(rem) + '</div><div class="tl">' + t('rest') + '</div>' +
    '<button data-act="restm">−15</button><button data-act="restp">+15</button><button data-act="restskip">✕</button></div>';
}
function tick() {
  var now = Date.now(), el, i;
  var els = document.querySelectorAll('[data-elapsed]');
  var src = curW();
  for (i = 0; i < els.length; i++) if (src) els[i].textContent = fmtDur((now - src.start) / 1000);
  if (ui.sw) { el = document.querySelector('[data-sw]'); if (el) el.textContent = fmtDur((now - ui.sw.start) / 1000); }
  if (ui.rest) {
    var rem = Math.ceil((ui.rest.end - now) / 1000);
    if (rem <= 0) { ui.rest = null; beep(); toast(t('rest_over')); renderTimer(); }
    else {
      var tt = $('tbt'), f = $('tbf');
      if (tt) tt.textContent = fmtDur(rem);
      if (f) f.style.width = Math.min(100, (1 - rem / ui.rest.total) * 100).toFixed(0) + '%';
    }
  }
}

/* ---------- общая отрисовка ---------- */
function render(toTop) {
  var y = (typeof window !== 'undefined' && window.scrollY) || 0;
  if (document.documentElement) document.documentElement.lang = state.settings.lang;
  $('top').innerHTML = headerHTML();
  $('view').innerHTML = viewHTML();
  $('tabs').innerHTML = tabsHTML();
  renderTimer();
  ui.flash = null;
  loadPhotoImgs();
  if (window.scrollTo) window.scrollTo(0, toTop ? 0 : y);
}
function screenTitle() {
  return { active: t('t_active'), view: t('t_view'), progedit: t('t_prog') }[ui.screen] || t('tab_workout');
}
function headerHTML() {
  var left = '', right = '<button class="ib" data-act="settings" aria-label="' + esc(t('settings')) + '">⚙︎</button>', title;
  if (ui.settings) { title = t('settings'); left = '<button class="ib" data-act="back">‹</button>'; right = ''; }
  else if (ui.tab === 'workout' && ui.screen !== 'home') {
    title = screenTitle(); left = '<button class="ib" data-act="back">‹</button>';
    right = ui.screen === 'progedit' ? '<button class="ib" style="font-weight:700" data-act="progsave" aria-label="' + esc(t('save')) + '">✓</button>' : '';
  }
  else title = t('tab_' + ui.tab);
  return '<div class="hl">' + left + '</div><h1>' + esc(title) + '</h1><div class="hr">' + right + '</div>';
}
function tabsHTML() {
  var tabs = [['workout', '🏋️'], ['progress', '📈'], ['body', '⚖️'], ['rewards', '🏆']];
  return tabs.map(function (x) {
    var on = !ui.settings && ui.tab === x[0];
    return '<button class="' + (on ? 'on' : '') + '" data-act="tab" data-tab="' + x[0] + '"><i>' + x[1] + '</i>' + esc(t('tab_' + x[0])) + '</button>';
  }).join('');
}
function viewHTML() {
  if (ui.settings) return settingsHTML();
  if (ui.tab === 'progress') return progressHTML();
  if (ui.tab === 'body') return bodyHTML();
  if (ui.tab === 'rewards') return rewardsHTML();
  if (ui.screen === 'active' && !state.active) ui.screen = 'home';
  if (ui.screen === 'view' && !ui.edit) ui.screen = 'home';
  if (ui.screen === 'progedit' && !ui.progEdit) ui.screen = 'home';
  if (ui.screen === 'active' || ui.screen === 'view') return activeHTML();
  if (ui.screen === 'progedit') return progEditHTML();
  return homeHTML();
}
function goBack() {
  if (ui.settings) { ui.settings = false; render(true); return; }
  if (ui.screen === 'view') ui.edit = null;
  if (ui.screen === 'progedit' && ui.progEdit && !progById(ui.progEdit.id) && ui.progDirty && confirm(t('save_prog_q'))) { var sb = document.querySelector('[data-act=progsave]'); if (sb) { sb.click(); return; } }
  ui.progEdit = null; ui.progDirty = false;
  ui.screen = 'home';
  render(true);
}

/* ---------- графики ---------- */
function ringSVG(p, txt) {
  var c = 2 * Math.PI * 26, o = c * (1 - Math.min(1, Math.max(0, p)));
  return '<svg class="ring" viewBox="0 0 64 64"><circle cx="32" cy="32" r="26" class="rbg"/><circle cx="32" cy="32" r="26" class="rfg" stroke-dasharray="' +
    c.toFixed(1) + '" stroke-dashoffset="' + o.toFixed(1) + '" transform="rotate(-90 32 32)"/><text x="32" y="38" text-anchor="middle">' + esc(txt) + '</text></svg>';
}
function lineChart(pts, fmt) {
  if (!pts.length) return '<div class="empty">' + t('no_data') + '</div>';
  var W = 320, H = 170, pl = 40, pr = 12, pt = 14, pb = 26;
  var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  pts.forEach(function (p) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); });
  var lo = x0, hi = x1;
  if (y0 === y1) { y0 -= 1; y1 += 1; } else { var pd = (y1 - y0) * 0.15; y0 -= pd; y1 += pd; }
  if (x0 === x1) { x0 -= 864e5; x1 += 864e5; }
  function X(v) { return pl + (v - x0) / (x1 - x0) * (W - pl - pr); }
  function Y(v) { return pt + (1 - (v - y0) / (y1 - y0)) * (H - pt - pb); }
  var s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
  for (var i = 0; i < 3; i++) {
    var v = y0 + (y1 - y0) * i / 2, yy = Y(v);
    s += '<line class="gl" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + yy.toFixed(1) + '" y2="' + yy.toFixed(1) + '"/><text x="' + (pl - 4) + '" y="' + (yy + 3).toFixed(1) + '" text-anchor="end">' + fmt(v) + '</text>';
  }
  s += '<path class="ln" d="' + pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p.x).toFixed(1) + ' ' + Y(p.y).toFixed(1); }).join(' ') + '"/>';
  pts.forEach(function (p) { s += '<circle class="dt" cx="' + X(p.x).toFixed(1) + '" cy="' + Y(p.y).toFixed(1) + '" r="' + (pts.length > 40 ? 1.8 : 3.5) + '"/>'; });
  var lp = pts[pts.length - 1];
  s += '<text x="' + Math.min(X(lp.x) + 4, W - pr) + '" y="' + (Y(lp.y) - 8).toFixed(1) + '" text-anchor="end" style="fill:var(--tx);font-weight:700;font-size:11px">' + fmt(lp.y) + '</text>';
  s += '<text x="' + pl + '" y="' + (H - 8) + '">' + fmtDate(lo) + '</text><text x="' + (W - pr) + '" y="' + (H - 8) + '" text-anchor="end">' + fmtDate(hi) + '</text></svg>';
  return s;
}
function f1(v) { return String(Math.round(v * 10) / 10); }

/* ---------- вкладка «Тренировки» ---------- */
function histSummary(w) {
  var parts = [], n = workoutSets(w), c = workoutCardioMin(w);
  if (n) parts.push(t('n_sets', { n: n }));
  if (c) parts.push(t('n_min', { n: Math.round(c) }));
  if (w.end) parts.push(t('n_min', { n: Math.max(1, Math.round((w.end - w.start) / 60000)) }));
  return parts.join(' · ');
}
function progSummary(p) {
  var names = wdNames(), out = [];
  [1, 2, 3, 4, 5, 6, 0].forEach(function (k) {
    var d = p.days && p.days[k];
    if (d && d.items.length) out.push(names[k] + ' ' + esc(d.name));
    else if (d && d.type === 'recovery') out.push(names[k] + ' ' + t('day_rec_s').toLowerCase());
  });
  return out.join(' · ');
}
function homeHTML() {
  var h = '';
  getHints().forEach(function (x) {
    h += '<div class="card hint-card"><div class="hint-t">' + esc(x.text) + '</div><div class="row">';
    if (x.kind === 'today' && x.pid) h += '<button class="btn sm" data-act="startprog" data-id="' + x.pid + '" data-dow="' + x.dow + '">▶ ' + t('start') + '</button>';
    if (x.kind === 'photo') h += '<button class="btn sm" data-act="gophotos">📷 ' + t('photos') + '</button>';
    h += '<button class="btn sm ghost" data-act="hdis" data-id="' + esc(x.id) + '">' + t('hide') + '</button></div></div>';
  });
  if (state.active) {
    h += '<div class="card act"><div><b>' + esc(state.active.name) + '</b><div class="sub">' + t('in_progress') + ' · <span data-elapsed>' + fmtDur((Date.now() - state.active.start) / 1000) + '</span></div></div><button class="btn" data-act="resume">' + t('resume') + '</button></div>';
  } else {
    h += '<button class="btn big" data-act="train">▶ ' + t('train') + '</button>';
  }
  var wc = weekDoneCount(), goal = state.settings.goal;
  h += '<div class="card row">' + ringSVG(wc / goal, wc + '/' + goal) + '<div class="grow"><b>' + t('week_goal') + '</b><div class="sub">' + t('week_of', { n: wc, g: goal }) + '</div></div></div>';

  h += '<h2>' + t('programs') + '</h2>';
  if (!state.programs.length) h += '<div class="empty">' + t('no_progs') + '</div>';
  state.programs.forEach(function (p) {
    var inf = progInfo(p), st = inf.upcoming ? t('p_soon') : (inf.finished ? t('p_done') : t(inf.endless ? 'p_week_inf' : 'p_week', { w: inf.week, n: p.weeks }));
    h += '<div class="card li"><div class="grow"><b>' + esc(p.name) + '</b><div class="sub">' + st + (p.active ? '' : ' · ' + t('p_off')) + '</div><div class="sub">' + progSummary(p) + '</div></div><button class="ib" data-act="progedit" data-id="' + p.id + '">✎</button></div>';
  });
  h += '<button class="btn ghost" data-act="progedit" data-id="">+ ' + t('new_prog') + '</button>';

  var ws = state.workouts.slice().reverse();
  h += '<h2>' + t('history') + '</h2>';
  if (!ws.length) h += '<div class="empty">' + t('no_hist') + '</div>';
  ws.slice(0, ui.histN).forEach(function (w) {
    h += '<div class="card li" data-act="openw" data-id="' + w.id + '" style="cursor:pointer"><div class="grow"><b>' + esc(w.name) + '</b><div class="sub">' + fmtDateLong(w.start) + ' · ' + histSummary(w) + '</div></div><span class="sub">›</span></div>';
  });
  if (ws.length > ui.histN) h += '<button class="btn ghost" data-act="histmore">' + t('more') + '</button>';
  return h;
}
function openTrain() {
  var h = '<h3>' + t('choose_prog') + '</h3>', dow = new Date().getDay();
  if (!state.programs.length) h += '<div class="empty">' + t('no_progs') + '</div><button class="btn" data-act="progedit" data-id="">+ ' + t('new_prog') + '</button>';
  state.programs.slice().sort(function (a, b) { return (b.active ? 1 : 0) - (a.active ? 1 : 0); }).forEach(function (p) {
    var d = p.days && p.days[dow], has = d && d.items.length;
    h += '<div class="card li" data-act="trainprog" data-id="' + p.id + '" style="cursor:pointer"><div class="grow"><b>' + esc(p.name) + '</b><div class="sub">' +
      (has ? t('today_is', { day: esc(d.name) }) : t(d && d.type === 'recovery' ? 'rec_today' : 'rest_today')) + '</div></div><span class="sub">›</span></div>';
  });
  h += '<button class="btn ghost" data-act="startempty">' + t('start_empty') + '</button><button class="btn ghost" data-act="closesheet">' + t('close') + '</button>';
  showSheet(h);
}
function openDayPick(pid) {
  var p = progById(pid), names = wdNames(), h = '<h3>' + t('rest_pick') + '</h3>', any = false;
  if (p) [1, 2, 3, 4, 5, 6, 0].forEach(function (k) {
    var d = p.days && p.days[k];
    if (!d || !d.items.length) return;
    any = true;
    h += '<div class="card li" data-act="startprog" data-id="' + p.id + '" data-dow="' + k + '" style="cursor:pointer"><div class="grow"><b>' + names[k] + ' · ' + esc(d.name) + '</b></div><span class="sub">▶</span></div>';
  });
  if (!any) h += '<div class="empty">' + t('no_days_prog') + '</div>';
  h += '<button class="btn ghost" data-act="closesheet">' + t('close') + '</button>';
  showSheet(h);
}

function entryHTML(W, e, ei) {
  var ex = exById(e.ex);
  if (!ex) return '';
  var h = '<div class="card ex"><div class="exh"><b>' + esc(ex.name) + '</b><span><button class="ib" data-act="tech" data-id="' + ex.id + '" aria-label="' + esc(t('technique')) + '">ⓘ</button><button class="ib" data-act="exmenu" data-ei="' + ei + '">⋯</button></span></div>';
  var ls = lastSessions(ex.id, 1, W.start, W.id);
  if (ex.type === 'cardio') {
    var s0 = e.sets[0];
    if (ls.length) h += '<div class="sub">' + t('last') + ': ' + t('n_min', { n: f1(ls[0].sec / 60) }) + '</div>';
    var running = ui.sw && ui.sw.ei === ei;
    h += '<div class="srow cardio"><input data-in="min" data-ei="' + ei + '" inputmode="decimal" placeholder="0" value="' + (s0.s ? f1(s0.s / 60) : '') + '"><span class="u">' + t('min') + '</span>' +
      '<button class="btn sm ghost" data-act="sw" data-ei="' + ei + '">' + (running ? '■ <span data-sw>' + fmtDur((Date.now() - ui.sw.start) / 1000) + '</span>' : '▶ ' + t('stopwatch')) + '</button>' +
      '<button class="chk' + (s0.done ? ' on' : '') + '" data-act="done" data-ei="' + ei + '" data-si="0">✓</button></div></div>';
    return h;
  }
  if (ls.length) h += '<div class="sub">' + t('last') + ': ' + ls[0].sets.map(function (s) { return fmtW(s.w || 0) + '×' + (s.r || 0); }).join(' · ') + '</div>';
  var it = planItem(W, e), sg = it ? null : suggest(ex, W.start, W.id);
  if (it) {
    h += '<div class="sub sug">' + t('plan_line', { s: it.sets || e.sets.length, r: it.reps || '?' }) + (it.w != null ? ' · ' + fmtW(it.w) + ' ' + unitLabel() : '') +
      (it.up > 0 ? ' · ' + t('plan_up', { n: it.up }) : '') + '</div>';
  }
  if (sg) {
    h += '<div class="sub sug">' + t('sug', { w: fmtW(sg.w), u: unitLabel(), r: sg.r }) +
      (sg.kind === 'up' ? '<span class="tag up">▲ ' + t('sug_up') + '</span>' : (sg.kind === 'deload' ? '<span class="tag deload">' + t('sug_deload') + '</span>' : '')) + '</div>';
  }
  h += '<div class="srow head"><span>#</span><span>' + unitLabel() + '</span><span>' + t('reps') + '</span><span></span><span></span></div>';
  e.sets.forEach(function (s, si) {
    var ps = ls.length ? ls[0].sets[Math.min(si, ls[0].sets.length - 1)] : null;
    h += '<div class="srow' + (s.done ? ' done' : '') + (ui.flash === ei + '-' + si ? ' pop' : '') + '"><span class="n">' + (si + 1) + '</span>' +
      '<input data-in="w" data-ei="' + ei + '" data-si="' + si + '" inputmode="decimal" value="' + (s.w == null ? '' : fmtW(s.w)) + '" placeholder="' + (ps ? fmtW(ps.w || 0) : '') + '">' +
      '<input data-in="r" data-ei="' + ei + '" data-si="' + si + '" inputmode="numeric" value="' + (s.r == null ? '' : s.r) + '" placeholder="' + (ps ? (ps.r || '') : '') + '">' +
      '<button class="chk' + (s.done ? ' on' : '') + '" data-act="done" data-ei="' + ei + '" data-si="' + si + '">' + (s.pr ? '🏆' : '✓') + '</button>' +
      '<button class="ib sm" data-act="delset" data-ei="' + ei + '" data-si="' + si + '">✕</button></div>';
  });
  h += '<button class="btn sm ghost" data-act="addset" data-ei="' + ei + '">+ ' + t('add_set') + '</button></div>';
  return h;
}
function activeHTML() {
  var W = curW(), h = '';
  h += '<div class="card"><input class="title-in" data-in="wname" value="' + esc(W.name) + '" placeholder="' + esc(t('wname')) + '">' +
    '<div class="sub">' + (ui.edit ? fmtDateLong(W.start) : '⏱ <span data-elapsed>' + fmtDur((Date.now() - W.start) / 1000) + '</span>') + '</div></div>';
  W.entries.forEach(function (e, ei) { h += entryHTML(W, e, ei); });
  if (!W.entries.length) h += '<div class="empty">' + t('w_empty') + '</div>';
  h += '<button class="btn ghost" data-act="addex" data-to="workout">+ ' + t('add_ex') + '</button>';
  if (ui.edit) {
    h += '<button class="btn big" data-act="savedit">' + t('save') + '</button><button class="btn danger" data-act="deledit">' + t('delete_w') + '</button>';
  } else {
    h += '<button class="btn big" data-act="finish">' + t('finish') + '</button><button class="btn danger" data-act="cancelw">' + t('cancel_w') + '</button>';
  }
  return h;
}

// Правки существующей программы сохраняются сразу, не нужно искать кнопку «Сохранить»
function autoSaveProg() {
  ui.progDirty = true;
  var P = ui.progEdit;
  if (!P || !progById(P.id)) return;
  var c = cleanProg(P), old = progById(P.id);
  if (!c.name) c.name = old.name;
  for (var i = 0; i < state.programs.length; i++) if (state.programs[i].id === P.id) state.programs[i] = c;
  save();
}
function dayType(d) { return d.type || (d.items.length ? 'train' : 'rest'); }
function pday(P, k) {
  if (!P.days[k]) P.days[k] = { name: '', items: [] };
  return P.days[k];
}
function progEditHTML() {
  var P = ui.progEdit, h = '', names = wdNames();
  h += '<div class="card"><label class="f" style="margin-top:0">' + t('prog_name') + '</label><input data-in="pname" value="' + esc(P.name) + '" placeholder="' + esc(t('prog_name_ph')) + '">' +
    '<div class="chkrow"><input type="checkbox" data-in="pactive" id="pa"' + (P.active ? ' checked' : '') + '><label for="pa">' + t('prog_active') + '</label></div></div>';
  h += '<h2>' + t('prog_sched') + '</h2><div class="sub" style="margin:0 4px 6px">' + t('prog_help') + '</div>';
  var full = t('wdl').split(',');
  [1, 2, 3, 4, 5, 6, 0].forEach(function (k) {
    var d = P.days[k] || { name: '', items: [] }, ty = dayType(d);
    h += '<div class="dcard t-' + ty + '"><div class="dhead"><b class="grow">' + full[k] + '</b><div class="seg3">' +
      [['train', 'day_train_s'], ['rest', 'day_rest_s'], ['recovery', 'day_rec_s']].map(function (x) {
        return '<button class="' + (ty === x[0] ? 'on' : '') + '" data-act="dtype" data-dow="' + k + '" data-v="' + x[0] + '">' + t(x[1]) + '</button>';
      }).join('') + '</div></div><div class="dbody">';
    if (ty !== 'train') {
      h += '<div class="sub">' + t(ty === 'rest' ? 'rest_note' : 'rec_note') + '</div></div></div>';
      return;
    }
    h += '<input data-in="pdname" data-dow="' + k + '" value="' + esc(d.name) + '" placeholder="' + esc(t('day_name_ph')) + '">';
    if (!d.items.length) h += '<div class="sub" style="margin:8px 0 0">' + t('day_empty_hint') + '</div>';
    d.items.forEach(function (it, i) {
      var ex = exById(it.ex);
      if (!ex) return;
      h += '<div class="pit" data-dow="' + k + '" data-i="' + i + '"><div class="row"><button class="ib mv drag" data-drag="1" aria-label="' + esc(t('drag')) + '">≡</button><b class="grow"><span class="sub">' + (i + 1) + '.</span> ' + esc(ex.name) + (ex.type === 'cardio' ? ' <span class="sub">' + t('cardio') + '</span>' : '') + '</b>' +
        '<button class="ib sm" data-act="tech" data-id="' + ex.id + '">ⓘ</button><button class="ib mv" data-act="pup" data-dow="' + k + '" data-i="' + i + '"' + (i === 0 ? ' disabled' : '') + ' aria-label="' + esc(t('move_up')) + '">↑</button><button class="ib mv" data-act="pdown" data-dow="' + k + '" data-i="' + i + '"' + (i === d.items.length - 1 ? ' disabled' : '') + ' aria-label="' + esc(t('move_down')) + '">↓</button><button class="ib sm" data-act="prem" data-dow="' + k + '" data-i="' + i + '">✕</button></div>';
      function fld(f, label, val, mode) {
        return '<div><label class="f">' + label + '</label><input data-in="pi" data-f="' + f + '" data-dow="' + k + '" data-i="' + i + '" inputmode="' + mode + '" value="' + esc(val) + '"></div>';
      }
      if (ex.type === 'cardio') {
        h += '<div class="pf one">' + fld('min', t('min'), it.min > 0 ? f1(it.min) : '', 'decimal') + '</div>';
      } else {
        h += '<div class="pf">' + fld('sets', t('sets_s'), it.sets || 3, 'numeric') + fld('reps', t('reps'), it.reps || '', 'numeric') +
          fld('w', unitLabel(), it.w == null ? '' : fmtW(it.w), 'decimal') + fld('up', t('up_at'), it.up || '', 'numeric') + '</div>';
      }
      h += '</div>';
    });
    h += '<div class="two" style="margin-top:8px"><button class="btn sm ghost" data-act="addex" data-to="prog:' + k + '" data-kind="strength">+ ' + t('add_ex') + '</button>' +
      '<button class="btn sm ghost" data-act="addex" data-to="prog:' + k + '" data-kind="cardio">+ ' + t('cardio') + '</button></div></div></div>';
  });
  h += '<div class="sub" style="margin:0 4px">' + t('up_help') + '</div>';
  h += '<button class="btn" data-act="progsave">' + t('save') + '</button>';
  h += '<button class="btn ghost" data-act="progics">📅 ' + t('to_calendar') + '</button><div class="sub">' + t('ics_note') + '</div>';
  if (progById(P.id)) h += '<button class="btn danger" data-act="progdel">' + t('delete') + '</button>';
  return h;
}
// Чистая копия программы для сохранения: пустые дни (без упражнений) = отдых
function cleanProg(P) {
  var out = clone(P), names = wdNames();
  out.days = {};
  Object.keys(P.days).forEach(function (k) {
    var d = P.days[k];
    var ty = dayType(d);
    if (ty !== 'train' || !d.items.length) { if (ty === 'recovery') out.days[k] = { name: '', items: [], type: 'recovery' }; return; }
    out.days[k] = { name: String(d.name || '').trim() || names[k], items: clone(d.items), type: 'train' };
  });
  out.name = String(P.name || '').trim();
  out.weeks = 0;
  return out;
}

/* ---------- вкладка «Прогресс» ---------- */
function weeklyCard() {
  var rows = weeklySummary(8), h = '<h2>' + t('by_weeks') + '</h2><div class="card"><table class="wk"><tr><th></th><th>' + t('trainings') + '</th><th>' + t('volume') + ', ' + unitLabel() + '</th><th>' + t('cardio') + ', ' + t('min') + '</th></tr>';
  rows.forEach(function (r, i) {
    h += '<tr><td>' + (i === 0 ? t('this_week') : fmtDate(r.t)) + '</td><td>' + r.cnt + '</td><td>' + Math.round(toDisp(r.vol)) + '</td><td>' + Math.round(r.min) + '</td></tr>';
  });
  return h + '</table></div>';
}
function progressHTML() {
  var list = exercisesWithData();
  if (!list.length) return '<div class="empty">' + t('prog_empty') + '</div>' + weeklyCard();
  if (!ui.pex || !list.some(function (e) { return e.id === ui.pex; })) ui.pex = list[0].id;
  var ex = exById(ui.pex), h = '';
  h += '<select data-in="pex">' + list.map(function (e) { return opt(e.id, e.name, e.id === ui.pex); }).join('') + '</select>';
  h += '<div class="seg">' + [[28, t('per_4w')], [84, t('per_12w')], [0, t('per_all')]].map(function (p) {
    return '<button class="' + (ui.pper === p[0] ? 'on' : '') + '" data-act="period" data-v="' + p[0] + '">' + p[1] + '</button>';
  }).join('') + '</div>';
  var pts = exSeries(ex.id, ui.pper ? Date.now() - ui.pper * 864e5 : 0);
  if (ex.type === 'strength') {
    var rec = records(ex.id);
    h += '<div class="card"><b>' + t('ch_weight') + ', ' + unitLabel() + '</b>' + lineChart(pts.map(function (p) { return { x: p.t, y: toDisp(p.w) }; }), f1) + '</div>';
    h += '<div class="card"><b>' + t('ch_reps') + '</b>' + lineChart(pts.map(function (p) { return { x: p.t, y: p.r }; }), function (v) { return String(Math.round(v)); }) + '</div>';
    if (rec) h += '<div class="card"><b>' + t('record') + '</b><div class="stat" style="margin-top:8px"><div><b>' + fmtW(rec.w) + ' ' + unitLabel() + ' × ' + rec.r + '</b><span>' + fmtDate(rec.t) + '</span></div><div><b>' + pts.length + '</b><span>' + t('sessions') + '</span></div></div></div>';
  } else {
    h += '<div class="card"><b>' + t('ch_time') + ', ' + t('min') + '</b>' + lineChart(pts.map(function (p) { return { x: p.t, y: p.sec / 60 }; }), f1) + '</div>';
  }
  return h + weeklyCard();
}

/* ---------- вкладка «Тело» ---------- */
function bodyHTML() {
  var h = '<div class="seg"><button class="' + (ui.bsub === 'metrics' ? 'on' : '') + '" data-act="bsub" data-v="metrics">' + t('weight_meas') + '</button><button class="' + (ui.bsub === 'photos' ? 'on' : '') + '" data-act="bsub" data-v="photos">' + t('photos') + '</button></div>';
  return h + (ui.bsub === 'photos' ? photosHTML() : metricsHTML());
}
function metricsHTML() {
  var ms = state.body.measures;
  if (ui.bsel !== 'weight' && !ms.some(function (m) { return m.id === ui.bsel; })) ui.bsel = 'weight';
  var isW = ui.bsel === 'weight', cur = isW ? null : ms.filter(function (m) { return m.id === ui.bsel; })[0];
  var h = '<div class="chips"><button class="' + (isW ? 'on' : '') + '" data-act="bsel" data-v="weight">' + t('body_weight') + '</button>' +
    ms.map(function (m) { return '<button class="' + (ui.bsel === m.id ? 'on' : '') + '" data-act="bsel" data-v="' + m.id + '">' + esc(m.name) + '</button>'; }).join('') +
    '<button data-act="mnew">+ ' + t('measure') + '</button></div>';
  var label = isW ? t('body_weight') + ', ' + unitLabel() : cur.name + ', ' + t('cm');
  var pts, rows;
  if (isW) {
    rows = state.body.weights.map(function (x) { return { t: x.t, v: toDisp(x.kg), k: 'w' }; });
  } else {
    rows = state.body.values.filter(function (x) { return x.m === cur.id; }).map(function (x) { return { t: x.t, v: x.v, k: 'v' }; });
  }
  pts = rows.map(function (r) { return { x: r.t, y: r.v }; });
  h += '<div class="card"><label class="f" style="margin-top:0">' + esc(label) + '</label><div class="row"><input id="bw" inputmode="decimal" placeholder="' + (rows.length ? f1(rows[rows.length - 1].v) : '') + '"><button class="btn sm" data-act="bwadd" style="white-space:nowrap">' + t('save') + '</button></div></div>';
  h += '<div class="card">' + lineChart(pts.slice(-120), f1) + '</div>';
  if (!isW) h += '<button class="btn danger" data-act="mdel" data-v="' + cur.id + '">' + t('delete_measure') + '</button>';
  if (rows.length) {
    h += '<h2>' + t('history') + '</h2>';
    rows.slice().reverse().slice(0, 12).forEach(function (r) {
      h += '<div class="card li"><div class="grow"><b>' + f1(r.v) + '</b> <span class="sub">' + fmtDateLong(r.t) + '</span></div><button class="ib sm" data-act="bdel" data-k="' + r.k + '" data-t="' + r.t + '">✕</button></div>';
    });
  }
  return h;
}

/* ---------- фото прогресса ---------- */
function poseName(p) { return t('pose_' + p); }
function photosHTML() {
  var S = state.settings, h = '';
  var names = wdNames();
  h += '<div class="card"><div class="chkrow" style="margin-top:0"><input type="checkbox" id="prm" data-set="photoRemind"' + (S.photoRemind ? ' checked' : '') + '><label for="prm"><b>' + t('photo_remind') + '</b></label></div>';
  if (S.photoRemind) {
    h += '<div class="two"><div><label class="f">' + t('photo_day') + '</label><select data-set="photoDay">' +
      [1, 2, 3, 4, 5, 6, 0].map(function (k) { return opt(String(k), names[k], S.photoDay === k); }).join('') + '</select></div>' +
      '<div><label class="f">' + t('photo_time') + '</label><input type="time" data-set="photoTime" value="' + esc(S.photoTime) + '"></div></div>' +
      '<button class="btn sm ghost" style="margin-top:10px" data-act="icsphoto">📅 ' + t('to_calendar') + '</button><div class="sub" style="margin-top:6px">' + t('ics_note') + '</div>';
  }
  h += '</div>';
  h += '<h2>' + t('new_photo') + '</h2><div class="chips">' + ['front', 'side', 'back'].map(function (p) {
    return '<button class="' + (ui.pose === p ? 'on' : '') + '" data-act="pose" data-v="' + p + '">' + poseName(p) + '</button>';
  }).join('') + '</div>';
  h += '<div class="two"><button class="btn" data-act="phcam">📷 ' + t('take_photo') + '</button><button class="btn ghost" data-act="phgal">🖼 ' + t('from_gallery') + '</button></div>';
  var list = state.photos.filter(function (p) { return ui.pfilter === 'all' || p.pose === ui.pfilter; }).slice().reverse();
  h += '<div class="chips" style="margin-top:12px">' + ['all', 'front', 'side', 'back'].map(function (p) {
    return '<button class="' + (ui.pfilter === p ? 'on' : '') + '" data-act="pfilter" data-v="' + p + '">' + (p === 'all' ? t('all') : poseName(p)) + '</button>';
  }).join('') + '</div>';
  if (!list.length) h += '<div class="empty">' + t('no_photos') + '</div>';
  else {
    h += '<div class="photos">' + list.map(function (p) {
      return '<button class="ph" data-act="phopen" data-id="' + p.id + '"><img data-pid="' + p.id + '" alt=""><span>' + fmtDate(p.t) + ' · ' + poseName(p.pose) + '</span></button>';
    }).join('') + '</div>';
    if (list.length >= 2) h += '<button class="btn ghost" data-act="phcmp">' + t('compare') + '</button>';
  }
  h += '<div class="sub" style="margin-top:12px">' + t('photo_note') + '</div>';
  return h;
}
function loadPhotoImgs() {
  var imgs = document.querySelectorAll('img[data-pid]');
  for (var i = 0; i < imgs.length; i++) {
    (function (img) {
      var id = img.getAttribute('data-pid');
      if (!id) return;
      if (photoURLs[id]) { img.src = photoURLs[id]; return; }
      photoGet(id, function (b) {
        if (!b) return;
        photoURLs[id] = URL.createObjectURL(b);
        if (img.getAttribute('data-pid') === id) img.src = photoURLs[id];
      });
    })(imgs[i]);
  }
}
function pickPhoto(camera) {
  var inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  if (camera) inp.setAttribute('capture', 'environment');
  inp.onchange = function () { if (inp.files && inp.files[0]) addPhoto(inp.files[0]); };
  inp.click();
}
function addPhoto(file) {
  toast(t('photo_saving'));
  resizeImage(file, 1280, function (blob) {
    if (!blob) { toast(t('photo_err')); return; }
    var id = uid();
    photoPut(id, blob, function (ok) {
      if (!ok) { toast(t('photo_err')); return; }
      state.photos.push({ id: id, t: Date.now(), pose: ui.pose });
      sortAll(state);
      var na = checkAch();
      save();
      render();
      toast(t('photo_saved') + (na.length ? ' · ' + na.map(function (a) { return a.ic + ' ' + t('ach_' + a.id); }).join(', ') : ''));
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
    });
  });
}
function photoById(id) { for (var i = 0; i < state.photos.length; i++) if (state.photos[i].id === id) return state.photos[i]; return null; }
function openPhoto(id) {
  var p = photoById(id);
  if (!p) return;
  showSheet('<img class="bigph" data-pid="' + p.id + '" alt=""><div class="row" style="margin-top:8px"><div class="grow"><b>' + fmtDateLong(p.t) + '</b><div class="sub">' + poseName(p.pose) + '</div></div></div>' +
    '<button class="btn danger" data-act="phdel" data-id="' + p.id + '">' + t('delete') + '</button><button class="btn ghost" data-act="closesheet">' + t('close') + '</button>');
}
function openCompare() {
  var list = state.photos.filter(function (p) { return ui.pfilter === 'all' || p.pose === ui.pfilter; });
  if (list.length < 2) return;
  var a = list[0], b = list[list.length - 1];
  function opts(sel) { return list.map(function (p) { return opt(p.id, fmtDate(p.t) + ' · ' + poseName(p.pose), p.id === sel); }).join(''); }
  showSheet('<h3>' + t('compare') + '</h3><div class="two"><select id="cmpA" data-in="cmp">' + opts(a.id) + '</select><select id="cmpB" data-in="cmp">' + opts(b.id) + '</select></div>' +
    '<div class="cmp"><div><img id="cmpImgA" data-pid="' + a.id + '" alt=""><div>' + t('before') + '</div></div><div><img id="cmpImgB" data-pid="' + b.id + '" alt=""><div>' + t('after') + '</div></div></div>' +
    '<button class="btn ghost" data-act="closesheet">' + t('close') + '</button>');
}
function updateCompare() {
  var a = $('cmpA'), b = $('cmpB'), ia = $('cmpImgA'), ib = $('cmpImgB');
  if (!a || !b || !ia || !ib) return;
  ia.setAttribute('data-pid', a.value);
  ib.setAttribute('data-pid', b.value);
  ia.removeAttribute('src'); ib.removeAttribute('src');
  loadPhotoImgs();
}

/* ---------- вкладка «Награды» ---------- */
function rewardsHTML() {
  var st = stats(), xp = totalXP(), li = levelInfo(xp), h = '';
  h += '<div class="card"><div class="row"><div class="grow"><div class="sub">' + t('level') + ' ' + li.L + '</div><div class="big-n">' + esc(levelName(li.L)) + '</div></div><div class="big-n">' + (li.L >= 3 ? '🏅' : '🎖️') + '</div></div>' +
    '<div class="bar"><i style="width:' + Math.round(li.p * 100) + '%"></i></div><div class="sub">' + t('xp_line', { xp: xp, next: li.next }) + '</div></div>';
  var wc = weekDoneCount(), goal = state.settings.goal;
  h += '<div class="two"><div class="card row">' + ringSVG(wc / goal, wc + '/' + goal) + '<div><b>' + t('week_goal') + '</b></div></div>' +
    '<div class="card"><div class="big-n">🔥 ' + st.streak + '</div><div class="sub">' + t('streak_w') + '</div></div></div>';
  h += '<div class="sub" style="margin:0 4px">' + t('streak_note', { g: goal }) + '</div>';
  h += '<h2>' + t('achievements') + '</h2><div class="ach">' + ACH.map(function (a) {
    return '<div class="' + (state.gam.ach[a.id] ? '' : 'lock') + '"><b>' + a.ic + '</b>' + esc(t('ach_' + a.id)) + '</div>';
  }).join('') + '</div>';
  h += '<h2>' + t('my_rewards') + '</h2>';
  if (!state.gam.rewards.length) h += '<div class="empty">' + t('no_rewards') + '</div>';
  state.gam.rewards.forEach(function (r) {
    var done = st.n >= r.n;
    h += '<div class="card"><div class="row"><div class="grow"><b>' + esc(r.title) + '</b><div class="sub">' + (done ? '✅ ' + t('earned') : t('rw_prog', { a: st.n, b: r.n })) + '</div></div><button class="ib sm" data-act="rdel" data-id="' + r.id + '">✕</button></div>' +
      '<div class="bar"><i style="width:' + Math.round(Math.min(1, st.n / r.n) * 100) + '%"></i></div></div>';
  });
  h += '<button class="btn ghost" data-act="radd">+ ' + t('add_reward') + '</button>';
  return h;
}

/* ---------- настройки ---------- */
function settingsHTML() {
  var S = state.settings, h = '<div class="card">';
  h += '<label class="f" style="margin-top:0">' + t('s_lang') + '</label><select data-set="lang">' + opt('ru', 'Русский', S.lang === 'ru') + opt('en', 'English', S.lang === 'en') + '</select>';
  h += '<label class="f">' + t('s_unit') + '</label><select data-set="unit">' + opt('kg', t('kg'), S.unit === 'kg') + opt('lb', t('lb'), S.unit === 'lb') + '</select>';
  h += '<div class="two"><div><label class="f">' + t('s_rest') + '</label><input data-set="rest" inputmode="numeric" value="' + S.rest + '"></div>' +
    '<div><label class="f">' + t('s_goal') + '</label><input data-set="goal" inputmode="numeric" value="' + S.goal + '"></div></div>';
  h += '<label class="f">' + t('s_bump') + '</label><input data-set="bumpDays" inputmode="numeric" value="' + S.bumpDays + '"><div class="sub" style="margin-top:4px">' + t('s_bump_help') + '</div>';
  h += '<label class="f">' + t('s_remind') + '</label><input type="time" data-set="remindTime" value="' + esc(S.remindTime) + '">';
  h += '<div class="chkrow"><input type="checkbox" id="swk" data-set="wake"' + (S.wake ? ' checked' : '') + '><label for="swk">' + t('s_wake') + '</label></div>';
  h += '<label class="f">' + t('s_levels') + '</label><input data-set="levels" value="' + esc(S.levels) + '" placeholder="' + esc(t('levels')) + '">';
  h += '</div><h2>' + t('s_data') + '</h2><button class="btn ghost" data-act="export">' + t('export') + '</button><button class="btn ghost" data-act="import">' + t('import') + '</button><div class="sub">' + t('backup_note') + '</div><div class="sub" style="margin-top:14px;text-align:center">' + t('version') + ': ' + APP_VERSION + '</div>';
  h += '<button class="btn danger" data-act="reset" style="margin-top:20px">' + t('reset') + '</button>';
  return h;
}
function applySetting(el, fromChange) {
  var k = el.dataset.set, S = state.settings, v = el.type === 'checkbox' ? el.checked : el.value;
  switch (k) {
    case 'lang': S.lang = v === 'en' ? 'en' : 'ru'; break;
    case 'unit': S.unit = v === 'lb' ? 'lb' : 'kg'; break;
    case 'rest': S.rest = Math.max(10, Math.min(600, parseInt(v, 10) || 90)); break;
    case 'goal': S.goal = Math.max(1, Math.min(14, parseInt(v, 10) || 3)); break;
    case 'bumpDays': S.bumpDays = Math.max(0, Math.min(90, parseInt(v, 10) || 0)); break;
    case 'remindTime': S.remindTime = v || '18:00'; break;
    case 'wake': S.wake = !!v; if (!v) wakeOff(); break;
    case 'levels': S.levels = v; break;
    case 'photoRemind': S.photoRemind = !!v; break;
    case 'photoDay': S.photoDay = parseInt(v, 10) || 0; break;
    case 'photoTime': S.photoTime = v || '09:00'; break;
  }
  save();
  if (fromChange && (k === 'lang' || k === 'unit' || k === 'photoRemind' || k === 'photoDay')) render();
}

/* ---------- листы (всплывающие панели) ---------- */
function openPicker(to, kind) {
  ui.picker = to; ui.libGrp = '';
  var h = '<h3>' + t(kind === 'cardio' ? 'add_cardio' : 'add_ex') + '</h3><div class="two"><input id="nxn" placeholder="' + esc(t('ex_name')) + '"><select id="nxt">' + opt('strength', t('strength'), kind !== 'cardio') + opt('cardio', t('cardio'), kind === 'cardio') + '</select></div>' +
    '<button class="btn" data-act="newex">' + t('create_add') + '</button>';
  var list = state.exercises.filter(function (e) { return !kind || e.type === kind; });
  h += '<input id="exq" data-in="q" placeholder="' + esc(t('search')) + '" style="margin-top:12px">';
  if (list.length) {
    h += '<h2>' + t('my_exercises') + '</h2><div class="exlist">';
    list.sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (e) {
      h += '<div class="li exitem" data-name="' + esc(libNorm(e.name)) + '"><button class="grow lbtn" data-act="pick" data-id="' + e.id + '"><b>' + esc(e.name) + '</b> <span class="sub">' + (e.type === 'cardio' ? t('cardio') : t('strength')) + '</span></button><button class="ib" data-act="exedit" data-id="' + e.id + '">✎</button></div>';
    });
    h += '</div>';
  }
  h += '<h2>' + t('library') + '</h2><div class="chips" id="libchips"><button class="on" data-act="libgrp" data-v="">' + t('all') + '</button>' +
    LIB_GROUPS.map(function (g) { return '<button data-act="libgrp" data-v="' + g + '">' + g + '</button>'; }).join('') + '</div><div class="exlist libl">';
  EXLIB.forEach(function (x) {
    if (kind && x.type !== kind) return;
    h += '<div class="li exitem libitem" data-name="' + esc(libNorm(x.name + ' ' + x.kw + ' ' + x.eq + ' ' + x.grp)) + '" data-g="' + x.grp + '"><button class="grow lbtn" data-act="picklib" data-id="' + x.id + '"><b>' + esc(x.name) + '</b> <span class="sub">' + x.grp + ' · ' + x.eq + '</span></button><button class="ib" data-act="tech" data-lib="' + x.id + '" aria-label="' + esc(t('technique')) + '">ⓘ</button></div>';
  });
  h += '</div>';
  h += '<button class="btn ghost" data-act="closesheet">' + t('close') + '</button>';
  showSheet(h);
}
function applyLibFilter() {
  var q = libNorm(($('exq') || {}).value), g = ui.libGrp || '', items = document.querySelectorAll('.exitem'), i, it, ok;
  for (i = 0; i < items.length; i++) {
    it = items[i];
    ok = !q || it.dataset.name.indexOf(q) >= 0;
    if (ok && it.classList.contains('libitem') && g) ok = it.dataset.g === g;
    it.style.display = ok ? '' : 'none';
  }
}
function openTech(exId, libId) {
  var ex = exId ? exById(exId) : null, lb = libId ? libById(libId) : (ex ? (ex.lib ? libById(ex.lib) : libByName(ex.name)) : null);
  var name = lb ? lb.name : (ex ? ex.name : ''), h = '<h3>' + esc(name) + '</h3>';
  if (lb) {
    h += '<div class="sub">' + lb.grp + ' · ' + lb.eq + '</div><h2>' + t('how_to') + '</h2><ol class="tech">' + lb.how.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol>';
    if (lb.err.length) h += '<h2>' + t('mistakes') + '</h2><ul class="tech">' + lb.err.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
    h += '<div class="sub" style="margin-top:10px">' + t('tech_note') + '</div>';
  } else h += '<div class="empty">' + t('no_tech') + '</div>';
  h += '<a class="btn" style="text-align:center;text-decoration:none" target="_blank" rel="noopener" href="' + esc(videoURL(name)) + '">▶ ' + t('video') + '</a>' +
    '<button class="btn ghost" data-act="closesheet">' + t('close') + '</button>';
  showSheet(h);
}
function newPlanItem(exId) {
  var ex = exById(exId);
  if (ex.type === 'cardio') return { id: uid(), ex: exId, min: 20 };
  var ls = lastSessions(exId, 1), pr = ex.prog || {}, reps = pr.min > 0 ? pr.min : 10, up = pr.max > reps ? pr.max : reps + 3;
  return { id: uid(), ex: exId, sets: 3, reps: reps, w: ls.length ? (topWeight(ls[0].sets) || null) : null, up: up };
}
function addExerciseTo(exId) {
  if (ui.picker && ui.picker.indexOf('prog:') === 0 && ui.progEdit) { pday(ui.progEdit, ui.picker.slice(5)).items.push(newPlanItem(exId)); autoSaveProg(); }
  else if (curW()) { var W = curW(); W.entries.push(makeEntry(exId, 3, W.start, W.id)); persist(); }
  closeSheet();
  render();
}
function openBump(b) {
  ui.bump = b;
  showSheet('<h3>🏋️ ' + t('bump_title') + '</h3><div class="sub" style="font-size:15px"><b>' + esc(b.name) + '</b>: ' + t('bump_text', { r: b.reps, up: b.up }) + '</div>' +
    '<label class="f">' + t('bump_new') + ', ' + unitLabel() + '</label><input id="bnw" inputmode="decimal" value="' + fmtW(b.to) + '">' +
    '<button class="btn big" data-act="bumpyes">' + t('bump_yes') + '</button><button class="btn ghost" data-act="closesheet">' + t('bump_no') + '</button>');
}
function openExMenu(ei) {
  var W = curW(), ex = exById(W.entries[ei].ex), n = W.entries.length;
  showSheet('<h3>' + esc(ex.name) + '</h3><div class="menu"><button data-act="exedit" data-id="' + ex.id + '">' + t('ex_settings') + '</button>' +
    (ei > 0 ? '<button data-act="exup" data-ei="' + ei + '">↑ ' + t('move_up') + '</button>' : '') +
    (ei < n - 1 ? '<button data-act="exdown" data-ei="' + ei + '">↓ ' + t('move_down') + '</button>' : '') +
    '<button class="bad" data-act="exrem" data-ei="' + ei + '">' + t('remove_from_w') + '</button></div><button class="btn ghost" data-act="closesheet">' + t('close') + '</button>');
}
function openExEdit(id) {
  var ex = exById(id);
  if (!ex) return;
  var p = ex.prog, h = '<h3>' + t('ex_settings') + '</h3><label class="f">' + t('ex_name') + '</label><input id="en" value="' + esc(ex.name) + '">' +
    '<label class="f">' + t('ex_rest') + '</label><input id="er" inputmode="numeric" value="' + (ex.rest || '') + '" placeholder="' + state.settings.rest + '">';
  if (ex.type === 'strength') {
    h += '<label class="f">' + t('ex_prog') + '</label><select id="epm">' + opt('none', t('pm_none'), p.mode === 'none') + opt('double', t('pm_double'), p.mode === 'double') + opt('weekly', t('pm_weekly'), p.mode === 'weekly') + '</select>' +
      '<div class="two"><div><label class="f">' + t('ex_step') + ', ' + unitLabel() + '</label><input id="eps" inputmode="decimal" value="' + fmtW(p.step) + '"></div>' +
      '<div><label class="f">' + t('ex_reps_range') + '</label><div class="row"><input id="epn" inputmode="numeric" value="' + p.min + '"><input id="epx" inputmode="numeric" value="' + p.max + '"></div></div></div>' +
      '<div class="sub" style="margin-top:6px">' + t('pm_help') + '</div>';
  }
  h += '<button class="btn ghost" data-act="tech" data-id="' + id + '">ⓘ ' + t('technique') + '</button><button class="btn" data-act="exsave" data-id="' + id + '">' + t('save') + '</button><button class="btn danger" data-act="exdel" data-id="' + id + '">' + t('ex_delete') + '</button><button class="btn ghost" data-act="closesheet">' + t('close') + '</button>';
  showSheet(h);
}
function openFinish() {
  var W = state.active, any = W.entries.some(function (e) { return e.sets.some(function (s) { return s.done; }); });
  if (!any) { toast(t('no_sets')); return; }
  var h = '<h3>' + t('finish') + '</h3><div class="sub">' + t('sum', { s: workoutSets(W), m: Math.max(1, Math.round((Date.now() - W.start) / 60000)) }) + '</div>';
  h += '<button class="btn big" data-act="finishgo">' + t('save') + '</button><button class="btn ghost" data-act="closesheet">' + t('cancel') + '</button>';
  showSheet(h);
}

/* ---------- события ---------- */
/* Перетаскивание упражнений внутри одного дня за значок ≡ */
var drag = null;
function onDragStart(e) {
  var h = e.target.closest && e.target.closest('[data-drag]');
  if (!h || ui.screen !== 'progedit' || (e.button !== undefined && e.button !== 0)) return;
  var pit = h.closest('.pit'), card = pit.closest('.dcard'), all = Array.prototype.slice.call(card.querySelectorAll('.pit'));
  e.preventDefault();
  drag = { pit: pit, dow: pit.dataset.dow, from: all.indexOf(pit), to: all.indexOf(pit), all: all, y0: e.clientY, h: pit.getBoundingClientRect().height + 10,
           mids: all.map(function (x) { var r = x.getBoundingClientRect(); return r.top + r.height / 2; }), sc0: window.scrollY };
  pit.classList.add('dragging');
  all.forEach(function (x) { if (x !== pit) x.style.transition = 'transform .15s'; });
  document.addEventListener('pointermove', onDragMove);
  document.addEventListener('pointerup', onDragEnd);
  document.addEventListener('pointercancel', onDragEnd);
}
function onDragMove(e) {
  if (!drag) return;
  var dy = e.clientY - drag.y0 + (window.scrollY - drag.sc0), mid = drag.mids[drag.from] + dy, to = 0, j;
  if (e.clientY < 90) window.scrollBy(0, -12); else if (e.clientY > window.innerHeight - 130) window.scrollBy(0, 12);
  drag.pit.style.transform = 'translateY(' + dy + 'px)';
  for (j = 0; j < drag.all.length; j++) if (j !== drag.from && drag.mids[j] < mid) to++;
  drag.to = to;
  drag.all.forEach(function (x, j) {
    if (x === drag.pit) return;
    var sh = 0;
    if (drag.from < to && j > drag.from && j <= to) sh = -drag.h;
    if (drag.from > to && j >= to && j < drag.from) sh = drag.h;
    x.style.transform = sh ? 'translateY(' + sh + 'px)' : '';
  });
}
function onDragEnd() {
  document.removeEventListener('pointermove', onDragMove);
  document.removeEventListener('pointerup', onDragEnd);
  document.removeEventListener('pointercancel', onDragEnd);
  if (!drag) return;
  var d = drag; drag = null;
  d.all.forEach(function (x) { x.style.transform = ''; x.style.transition = ''; x.classList.remove('dragging'); });
  if (d.to !== d.from && ui.progEdit) {
    var items = pday(ui.progEdit, d.dow).items, m = items.splice(d.from, 1)[0];
    items.splice(d.to, 0, m);
    autoSaveProg();
    render();
  }
}
function onClick(e) {
  var el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
  if (!el) return;
  var d = el.dataset, a = d.act;
  unlockAudio();
  if (a === 'bd') { if (e.target === el) closeSheet(); return; }
  var ei = +d.ei, si = +d.si, W, s, ex, i, v, P;
  switch (a) {
    case 'tab': ui.tab = d.tab; ui.settings = false; render(true); break;
    case 'settings': ui.settings = true; render(true); break;
    case 'back': goBack(); break;
    case 'closesheet': closeSheet(); break;
    case 'hdis': state.dismissed[d.id + '@' + todayStr()] = 1; save(); render(); break;
    case 'gophotos': ui.tab = 'body'; ui.bsub = 'photos'; render(true); break;

    /* тренировка */
    case 'train': if (state.active) { toast(t('already')); break; } openTrain(); break;
    case 'trainprog':
      i = new Date().getDay(); P = progById(d.id);
      if (P && P.days && P.days[i] && P.days[i].items.length) { startWorkout(P.id, i); closeSheet(); ui.tab = 'workout'; ui.screen = 'active'; wakeOn(); render(true); }
      else openDayPick(d.id);
      break;
    case 'startempty': closeSheet(); startWorkout(null); ui.screen = 'active'; wakeOn(); render(true); break;
    case 'startprog':
      if (state.active) { toast(t('already')); break; }
      startWorkout(d.id, +d.dow); closeSheet(); ui.tab = 'workout'; ui.screen = 'active'; wakeOn(); render(true); break;
    case 'resume': ui.screen = 'active'; render(true); break;
    case 'openw':
      for (i = 0; i < state.workouts.length; i++) if (state.workouts[i].id === d.id) { ui.edit = clone(state.workouts[i]); ui.screen = 'view'; }
      render(true); break;
    case 'histmore': ui.histN += 15; render(); break;
    case 'addex': openPicker(d.to, d.kind); break;
    case 'pick': addExerciseTo(d.id); break;
    case 'newex':
      v = $('nxn').value.trim();
      if (!v) { toast(t('need_name')); break; }
      addExerciseTo(newExercise(v, $('nxt').value).id); break;
    case 'libgrp':
      ui.libGrp = d.v;
      Array.prototype.forEach.call(document.querySelectorAll('#libchips button'), function (b) { b.classList.toggle('on', b.dataset.v === d.v); });
      applyLibFilter(); break;
    case 'picklib':
      v = libById(d.id);
      for (i = 0; i < state.exercises.length; i++) if (state.exercises[i].lib === d.id || libNorm(state.exercises[i].name) === libNorm(v.name)) { ex = state.exercises[i]; if (!ex.lib) ex.lib = d.id; break; }
      if (!ex) ex = newExercise(v.name, v.type, v.id);
      addExerciseTo(ex.id); break;
    case 'tech': openTech(d.id, d.lib); break;
    case 'exmenu': openExMenu(ei); break;
    case 'exedit': openExEdit(d.id); break;
    case 'exsave':
      ex = exById(d.id);
      v = $('en').value.trim();
      if (!ex || !v) { toast(t('need_name')); break; }
      ex.name = v;
      i = parseInt($('er').value, 10);
      ex.rest = i > 0 ? i : null;
      if (ex.type === 'strength') {
        ex.prog.mode = $('epm').value;
        var st = num($('eps').value);
        ex.prog.step = st > 0 ? toKg(st) : 2.5;
        var mn = parseInt($('epn').value, 10) || 8, mx = parseInt($('epx').value, 10) || 12;
        if (mx < mn) mx = mn;
        ex.prog.min = mn; ex.prog.max = mx;
      }
      save(); closeSheet(); render(); break;
    case 'exdel':
      if (!confirm(t('ex_delete_q'))) break;
      state.exercises = state.exercises.filter(function (x) { return x.id !== d.id; });
      state.programs.forEach(function (pp) { Object.keys(pp.days || {}).forEach(function (k) { pp.days[k].items = pp.days[k].items.filter(function (it) { return it.ex !== d.id; }); }); });
      if (ui.progEdit) Object.keys(ui.progEdit.days).forEach(function (k) { ui.progEdit.days[k].items = ui.progEdit.days[k].items.filter(function (it) { return it.ex !== d.id; }); });
      if (state.active) state.active.entries = state.active.entries.filter(function (x) { return x.ex !== d.id; });
      if (ui.edit) ui.edit.entries = ui.edit.entries.filter(function (x) { return x.ex !== d.id; });
      save(); closeSheet(); render(); break;
    case 'exrem': curW().entries.splice(ei, 1); persist(); closeSheet(); render(); break;
    case 'exup': case 'exdown':
      W = curW(); i = a === 'exup' ? ei - 1 : ei + 1;
      if (i >= 0 && i < W.entries.length) { s = W.entries[ei]; W.entries[ei] = W.entries[i]; W.entries[i] = s; }
      persist(); closeSheet(); render(); break;
    case 'addset':
      W = curW(); s = W.entries[ei].sets;
      s.push({ w: s.length ? s[s.length - 1].w : null, r: s.length ? s[s.length - 1].r : null, done: false });
      persist(); render(); break;
    case 'delset':
      W = curW();
      W.entries[ei].sets.splice(si, 1);
      if (!W.entries[ei].sets.length) W.entries.splice(ei, 1);
      persist(); render(); break;
    case 'done':
      W = curW(); s = W.entries[ei].sets[si]; ex = exById(W.entries[ei].ex);
      if ('s' in s) {
        if (!s.done && !(s.s > 0)) { toast(t('need_time')); break; }
        s.done = !s.done;
      } else if (!s.done) {
        if (!(s.r > 0)) { toast(t('need_reps')); break; }
        if (s.w == null) s.w = 0;
        s.done = true;
        if (checkPR(W, ei, si)) { s.pr = true; ui.flash = ei + '-' + si; toast('🏆 ' + t('new_pr')); }
        startRest(ex);
      } else { s.done = false; delete s.pr; }
      persist(); render();
      if (s.done && !('s' in s) && !ui.edit) { v = bumpCheck(W, W.entries[ei]); if (v) openBump(v); }
      break;
    case 'sw':
      if (ui.sw && ui.sw.ei === ei) {
        s = curW().entries[ei].sets[0];
        s.s = (s.s || 0) + Math.round((Date.now() - ui.sw.start) / 1000);
        s.done = true; ui.sw = null; persist();
      } else ui.sw = { ei: ei, start: Date.now() };
      render(); break;
    case 'bumpyes':
      v = num($('bnw').value);
      if (!(v > 0)) { toast(t('need_num')); break; }
      if (ui.bump && applyBump(ui.bump, toKg(v))) toast(t('bumped', { w: fmtW(toKg(v)), u: unitLabel() }));
      ui.bump = null; closeSheet(); break;
    case 'restm': if (ui.rest) { ui.rest.end -= 15000; ui.rest.total = Math.max(1, ui.rest.total - 15); renderTimer(); } break;
    case 'restp': if (ui.rest) { ui.rest.end += 15000; ui.rest.total += 15; renderTimer(); } break;
    case 'restskip': ui.rest = null; renderTimer(); break;
    case 'finish': openFinish(); break;
    case 'finishgo': finishGo(); break;
    case 'cancelw':
      if (!confirm(t('cancel_q'))) break;
      state.active = null; ui.rest = null; ui.sw = null; wakeOff(); save(); ui.screen = 'home'; render(true); break;
    case 'savedit':
      W = ui.edit; var oldEnd = W.end;
      if (!finalizeWorkout(W)) { toast(t('no_sets')); break; }
      W.end = oldEnd || W.end;
      for (i = 0; i < state.workouts.length; i++) if (state.workouts[i].id === W.id) state.workouts[i] = W;
      sortAll(state); save(); ui.edit = null; ui.screen = 'home'; render(true); toast(t('saved')); break;
    case 'deledit':
      if (!confirm(t('delete_w_q'))) break;
      state.workouts = state.workouts.filter(function (x) { return x.id !== ui.edit.id; });
      save(); ui.edit = null; ui.screen = 'home'; render(true); break;

    /* программы */
    case 'progedit':
      closeSheet();
      ui.progEdit = d.id ? clone(progById(d.id)) : { id: uid(), name: '', weeks: 0, start: todayStr(), active: true, days: {} };
      if (!ui.progEdit.days) ui.progEdit.days = {};
      ui.progDirty = false; ui.tab = 'workout'; ui.screen = 'progedit'; render(true); break;
    case 'pup': case 'pdown':
      s = pday(ui.progEdit, d.dow).items; i = +d.i; v = a === 'pup' ? i - 1 : i + 1;
      if (v >= 0 && v < s.length) { ex = s[i]; s[i] = s[v]; s[v] = ex; }
      autoSaveProg(); render(); break;
    case 'dtype':
      P = pday(ui.progEdit, d.dow);
      if (dayType(P) === d.v) break;
      if (d.v !== 'train' && P.items.length && !confirm(t('dtype_q'))) break;
      if (d.v !== 'train') { P.items = []; P.name = ''; }
      P.type = d.v; autoSaveProg(); render(); break;
    case 'prem': pday(ui.progEdit, d.dow).items.splice(+d.i, 1); autoSaveProg(); render(); break;
    case 'progsave':
      P = cleanProg(ui.progEdit);
      if (!P.name) { toast(t('need_name')); break; }
      if (!Object.keys(P.days).length) { toast(t('need_sched')); break; }
      if (progById(P.id)) { for (i = 0; i < state.programs.length; i++) if (state.programs[i].id === P.id) state.programs[i] = P; }
      else state.programs.push(P);
      save(); ui.progEdit = null; ui.progDirty = false; ui.screen = 'home'; render(true); toast(t('saved')); break;
    case 'progdel':
      if (!confirm(t('delete_q'))) break;
      state.programs = state.programs.filter(function (x) { return x.id !== ui.progEdit.id; });
      save(); ui.progEdit = null; ui.screen = 'home'; render(true); break;
    case 'progics':
      P = cleanProg(ui.progEdit);
      if (!P.name) P.name = t('tab_workout');
      if (!Object.keys(P.days).length) { toast(t('need_sched')); break; }
      saveFile('program.ics', 'text/calendar', buildProgramICS(P)); break;

    /* прогресс */
    case 'period': ui.pper = +d.v; render(); break;

    /* тело */
    case 'bsub': ui.bsub = d.v; render(); break;
    case 'bsel': ui.bsel = d.v; render(); break;
    case 'bwadd':
      v = num($('bw').value);
      if (!(v > 0)) { toast(t('need_num')); break; }
      if (ui.bsel === 'weight') {
        state.body.weights = state.body.weights.filter(function (x) { return dayKey(x.t) !== todayStr(); });
        state.body.weights.push({ t: Date.now(), kg: toKg(v) });
      } else {
        var mid = ui.bsel;
        state.body.values = state.body.values.filter(function (x) { return !(x.m === mid && dayKey(x.t) === todayStr()); });
        state.body.values.push({ m: mid, t: Date.now(), v: v });
      }
      sortAll(state); save(); render(); toast(t('saved')); break;
    case 'bdel':
      if (d.k === 'w') state.body.weights = state.body.weights.filter(function (x) { return String(x.t) !== d.t; });
      else state.body.values = state.body.values.filter(function (x) { return !(String(x.t) === d.t && x.m === ui.bsel); });
      save(); render(); break;
    case 'mnew':
      showSheet('<h3>' + t('measure') + '</h3><input id="mnn" placeholder="' + esc(t('measure_ph')) + '"><button class="btn" data-act="mcreate">' + t('save') + '</button><button class="btn ghost" data-act="closesheet">' + t('close') + '</button>'); break;
    case 'mcreate':
      v = $('mnn').value.trim();
      if (!v) { toast(t('need_name')); break; }
      i = { id: uid(), name: v };
      state.body.measures.push(i); ui.bsel = i.id; save(); closeSheet(); render(); break;
    case 'mdel':
      if (!confirm(t('delete_q'))) break;
      state.body.measures = state.body.measures.filter(function (x) { return x.id !== d.v; });
      state.body.values = state.body.values.filter(function (x) { return x.m !== d.v; });
      ui.bsel = 'weight'; save(); render(); break;

    /* фото */
    case 'pose': ui.pose = d.v; render(); break;
    case 'pfilter': ui.pfilter = d.v; render(); break;
    case 'phcam': pickPhoto(true); break;
    case 'phgal': pickPhoto(false); break;
    case 'phopen': openPhoto(d.id); break;
    case 'phcmp': openCompare(); break;
    case 'phdel':
      if (!confirm(t('delete_q'))) break;
      state.photos = state.photos.filter(function (x) { return x.id !== d.id; });
      photoDel(d.id);
      if (photoURLs[d.id]) { try { URL.revokeObjectURL(photoURLs[d.id]); } catch (er) {} delete photoURLs[d.id]; }
      save(); closeSheet(); render(); break;
    case 'icsphoto': saveFile('photo-reminder.ics', 'text/calendar', buildPhotoICS()); break;

    /* награды */
    case 'radd':
      showSheet('<h3>' + t('add_reward') + '</h3><label class="f">' + t('rw_title') + '</label><input id="rt" placeholder="' + esc(t('rw_title_ph')) + '"><label class="f">' + t('rw_after') + '</label><input id="rn" inputmode="numeric" value="' + (stats().n + 10) + '">' +
        '<button class="btn" data-act="rcreate">' + t('save') + '</button><button class="btn ghost" data-act="closesheet">' + t('close') + '</button>'); break;
    case 'rcreate':
      v = $('rt').value.trim(); i = parseInt($('rn').value, 10);
      if (!v || !(i > 0)) { toast(t('need_name')); break; }
      state.gam.rewards.push({ id: uid(), title: v, n: i }); save(); closeSheet(); render(); break;
    case 'rdel': state.gam.rewards = state.gam.rewards.filter(function (x) { return x.id !== d.id; }); save(); render(); break;

    /* данные */
    case 'export': saveFile('workouts-backup-' + todayStr() + '.json', 'application/json', JSON.stringify(state)); break;
    case 'import': $('importfile').click(); break;
    case 'reset':
      if (!confirm(t('reset_q')) || !confirm(t('reset_q2'))) break;
      try { localStorage.removeItem(STORE_KEY); } catch (er) {}
      try { if (photoDB) { photoDB.close(); photoDB = null; } indexedDB.deleteDatabase('wt_photos'); } catch (er) {}
      photoURLs = {};
      state = migrate(null); ui.settings = false; ui.screen = 'home'; ui.tab = 'workout'; save(); render(true); break;
  }
}

function finishGo() {
  var W = state.active;
  var lvBefore = levelInfo(totalXP()).L;
  if (!finalizeWorkout(W)) { toast(t('no_sets')); return; }
  state.workouts.push(W);
  sortAll(state);
  state.active = null; ui.rest = null; ui.sw = null; wakeOff();
  var gain = workoutXP(W), lvAfter = levelInfo(totalXP()).L, na = checkAch();
  save();
  closeSheet(); ui.screen = 'home'; render(true); renderTimer();
  toast(t('done_msg', { xp: gain }) + (lvAfter > lvBefore ? ' · ' + t('lvl_up', { l: lvAfter }) : '') +
    (na.length ? ' · ' + na.map(function (a) { return a.ic + ' ' + t('ach_' + a.id); }).join(', ') : ''));
}

function onInput(e) {
  var el = e.target;
  if (!el || !el.dataset) return;
  if (el.dataset.set !== undefined) {
    if (el.tagName !== 'SELECT' && el.type !== 'checkbox') applySetting(el, false);
    return;
  }
  var k = el.dataset['in'];
  if (!k || el.tagName === 'SELECT') return;
  var W, s, v;
  if (k === 'w' || k === 'r') {
    W = curW(); s = W.entries[+el.dataset.ei].sets[+el.dataset.si]; v = num(el.value);
    if (k === 'w') s.w = isNaN(v) ? null : toKg(v); else s.r = isNaN(v) ? null : Math.round(v);
    persist();
  } else if (k === 'min') {
    W = curW(); s = W.entries[+el.dataset.ei].sets[0]; v = num(el.value);
    s.s = isNaN(v) ? 0 : Math.round(v * 60);
    persist();
  } else if (k === 'wname') { curW().name = el.value; persist(); }
  else if (k === 'pname') { ui.progEdit.name = el.value; autoSaveProg(); }
  else if (k === 'pactive') { ui.progEdit.active = el.checked; autoSaveProg(); }
  else if (k === 'pdname') { pday(ui.progEdit, el.dataset.dow).name = el.value; autoSaveProg(); }
  else if (k === 'pi') {
    var it = pday(ui.progEdit, el.dataset.dow).items[+el.dataset.i], f = el.dataset.f;
    v = num(el.value);
    if (f === 'w') it.w = isNaN(v) ? null : toKg(v);
    else if (f === 'min') it.min = isNaN(v) ? 0 : v;
    else it[f] = isNaN(v) ? 0 : Math.max(0, Math.round(v));
    autoSaveProg();
  }
  else if (k === 'q') {
    applyLibFilter();
  }
}
function onChange(e) {
  var el = e.target;
  if (!el || !el.dataset) return;
  if (el.dataset.set !== undefined) { applySetting(el, true); return; }
  var k = el.dataset['in'];
  if (k === 'pex') { ui.pex = el.value; render(); }
  else if (k === 'cmp') updateCompare();
}

/* ---------- запуск ---------- */
function boot() {
  load();
  if (state.active) { ui.screen = 'active'; wakeOn(); }
  $('sheet').setAttribute('data-act', 'bd');
  document.addEventListener('pointerdown', onDragStart);
  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') { if (state.active) wakeOn(); tick(); render(); }
  });
  var imp = $('importfile');
  imp.addEventListener('change', function () {
    var f = imp.files && imp.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      try {
        var o = JSON.parse(r.result);
        if (!validBackup(o)) throw new Error('bad');
        if (!confirm(t('import_q'))) return;
        state = migrate(o);
        save(); ui.settings = false; ui.screen = state.active ? 'active' : 'home'; render(true); toast(t('imported'));
      } catch (er) { toast(t('import_err')); }
    };
    r.readAsText(f);
    imp.value = '';
  });
  render(true);
  setInterval(tick, 250);
  try {
    if ('serviceWorker' in navigator && typeof location !== 'undefined' && location.protocol.indexOf('http') === 0) navigator.serviceWorker.register('sw.js').catch(function () {});
  } catch (e) {}
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
}
boot();
