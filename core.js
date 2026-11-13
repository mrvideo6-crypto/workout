'use strict';
/* ===== Данные и логика приложения (без привязки к интерфейсу) ===== */

var STORE_KEY = 'wt_data_v1';
var KG_LB = 2.20462;
var state = null;

/* ---------- утилиты ---------- */
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  });
}
function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : NaN; }
function rnd2(x) { return Math.round(x * 100) / 100; }
function roundStep(x, step) { step = step > 0 ? step : 1; return Math.round(x / step) * step; }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function dayKey(ts) { var d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function weekStart(ts) { var d = new Date(ts); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d; }
function parseDay(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
function todayStr() { return dayKey(Date.now()); }

/* ---------- состояние ---------- */
function defaults() {
  return {
    v: 1,
    settings: { lang: 'ru', unit: 'kg', rest: 90, goal: 3, remindTime: '18:00', wake: true, levels: '',
      photoRemind: true, photoDay: 0, photoTime: '09:00' },
    exercises: [], days: [], programs: [], workouts: [], active: null,
    body: { weights: [], measures: [], values: [] },
    photos: [],
    gam: { ach: {}, rewards: [] },
    dismissed: {}
  };
}
function migrate(d) {
  var f = defaults();
  d = (d && typeof d === 'object') ? d : {};
  Object.keys(f).forEach(function (k) { if (d[k] === undefined) d[k] = f[k]; });
  ['settings', 'body', 'gam'].forEach(function (k) {
    if (!d[k] || typeof d[k] !== 'object') d[k] = f[k];
    Object.keys(f[k]).forEach(function (j) { if (d[k][j] === undefined) d[k][j] = f[k][j]; });
  });
  sortAll(d);
  return d;
}
function sortAll(d) {
  d.workouts.sort(function (a, b) { return a.start - b.start; });
  d.body.weights.sort(function (a, b) { return a.t - b.t; });
  d.body.values.sort(function (a, b) { return a.t - b.t; });
  d.photos.sort(function (a, b) { return a.t - b.t; });
}
function load() {
  var raw = null;
  try { raw = localStorage.getItem(STORE_KEY); } catch (e) {}
  try { state = migrate(raw ? JSON.parse(raw) : null); } catch (e) { state = migrate(null); }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { if (typeof toast === 'function') toast(t('save_err')); }
}

/* ---------- переводы ---------- */
function t(k, a) {
  var lang = (state && state.settings.lang) || 'ru';
  var s = (I18N[lang] && I18N[lang][k] !== undefined) ? I18N[lang][k] : (I18N.ru[k] !== undefined ? I18N.ru[k] : k);
  if (a) Object.keys(a).forEach(function (i) { s = s.split('{' + i + '}').join(a[i]); });
  return s;
}

/* ---------- единицы веса (внутри всё хранится в кг) ---------- */
function unitLabel() { return state.settings.unit === 'lb' ? t('lb') : t('kg'); }
function toDisp(kg) { return state.settings.unit === 'lb' ? kg * KG_LB : kg; }
function toKg(v) { return state.settings.unit === 'lb' ? v / KG_LB : v; }
function fmtW(kg) {
  if (kg == null || isNaN(kg)) return '';
  return String(Math.round(toDisp(kg) * 10) / 10);
}

/* ---------- справочники ---------- */
function exById(id) { for (var i = 0; i < state.exercises.length; i++) if (state.exercises[i].id === id) return state.exercises[i]; return null; }
function dayById(id) { for (var i = 0; i < state.days.length; i++) if (state.days[i].id === id) return state.days[i]; return null; }
function progById(id) { for (var i = 0; i < state.programs.length; i++) if (state.programs[i].id === id) return state.programs[i]; return null; }
function newExercise(name, type) {
  var e = { id: uid(), name: name, type: type, rest: null,
    prog: { mode: type === 'strength' ? 'double' : 'none', step: 2.5, min: 8, max: 12 } };
  state.exercises.push(e);
  return e;
}

/* ---------- история и прогрессия ---------- */
function lastSessions(exId, limit, before, skipId) {
  var out = [];
  before = before || Infinity;
  for (var i = state.workouts.length - 1; i >= 0 && out.length < limit; i--) {
    var w = state.workouts[i];
    if (w.start >= before || w.id === skipId) continue;
    for (var j = 0; j < w.entries.length; j++) {
      var e = w.entries[j];
      if (e.ex !== exId) continue;
      var ds = e.sets.filter(function (s) { return s.done; });
      if (ds.length) {
        var sec = 0;
        ds.forEach(function (s) { sec += s.s || 0; });
        out.push({ ts: w.start, sets: ds, sec: sec });
      }
      break;
    }
  }
  return out;
}
function e1rm(w, r) { return w * (1 + r / 30); }

// Рекомендация на следующую тренировку по упражнению
function suggest(ex, before, skipId) {
  if (!ex || ex.type !== 'strength') return null;
  var ls = lastSessions(ex.id, 3, before, skipId);
  if (!ls.length) return null;
  var p = ex.prog || { mode: 'none', step: 2.5, min: 8, max: 12 };
  var last = ls[0].sets, maxW = 0, i;
  for (i = 0; i < last.length; i++) if ((last[i].w || 0) > maxW) maxW = last[i].w;
  var top = last.filter(function (s) { return Math.abs((s.w || 0) - maxW) < 1e-6; });
  var minR = Math.min.apply(null, top.map(function (s) { return s.r || 0; }));
  var res = { w: maxW, r: minR, kind: 'same' };
  if (p.mode === 'double') {
    if (minR >= p.max) { res.w = rnd2(maxW + p.step); res.r = p.min; res.kind = 'up'; }
    else res.r = Math.min(p.max, minR + 1);
  } else if (p.mode === 'weekly') {
    if (weekStart(ls[0].ts).getTime() < weekStart(Date.now()).getTime()) { res.w = rnd2(maxW + p.step); res.kind = 'up'; }
  }
  if (p.mode !== 'none' && maxW > 0 && ls.length >= 3) {
    var e = ls.map(function (s) {
      var m = 0;
      s.sets.forEach(function (x) { m = Math.max(m, e1rm(x.w || 0, x.r || 0)); });
      return m;
    });
    if (Math.max(e[0], e[1]) <= e[2] + 1e-6) {
      res.w = rnd2(roundStep(maxW * 0.9, p.step)); res.r = p.min; res.kind = 'deload';
    }
  }
  return res;
}

// Заготовка упражнения внутри тренировки (подставляем рекомендацию или прошлый результат)
function makeEntry(exId, nSets, before, skipId) {
  var ex = exById(exId), e = { ex: exId, sets: [] };
  if (ex.type === 'cardio') { e.sets.push({ s: 0, done: false }); return e; }
  var sg = suggest(ex, before, skipId), ls = lastSessions(exId, 1, before, skipId);
  for (var i = 0; i < nSets; i++) {
    var w = null, r = null;
    if (sg) { w = sg.w; r = sg.r; }
    else if (ls.length) { var ps = ls[0].sets[Math.min(i, ls[0].sets.length - 1)]; w = ps.w; r = ps.r; }
    e.sets.push({ w: w, r: r, done: false });
  }
  return e;
}
function startWorkout(dayId) {
  var d = dayId ? dayById(dayId) : null;
  var w = { id: uid(), start: Date.now(), dayId: dayId || null, name: d ? d.name : t('workout'), entries: [] };
  if (d) d.items.forEach(function (it) { if (exById(it.ex)) w.entries.push(makeEntry(it.ex, it.sets || 3)); });
  state.active = w;
  save();
  return w;
}

// Новый рекорд? (вес больше прежнего максимума или тот же вес с большим числом повторов)
function checkPR(w, ei, si) {
  var s = w.entries[ei].sets[si], exId = w.entries[ei].ex;
  if (!(s.r > 0)) return false;
  var prior = [];
  state.workouts.forEach(function (x) {
    if (x.id === w.id || x.start >= w.start) return;
    x.entries.forEach(function (e) { if (e.ex === exId) e.sets.forEach(function (q) { if (q.done && !('s' in q)) prior.push(q); }); });
  });
  w.entries.forEach(function (e, i) {
    if (e.ex === exId) e.sets.forEach(function (q, j) { if (q.done && !('s' in q) && !(i === ei && j === si)) prior.push(q); });
  });
  if (!prior.length) return false;
  var maxW = 0, sw = s.w || 0;
  prior.forEach(function (q) { if ((q.w || 0) > maxW) maxW = q.w || 0; });
  if (sw > maxW + 1e-6) return true;
  if (Math.abs(sw - maxW) < 1e-6) {
    var mr = 0;
    prior.forEach(function (q) { if (Math.abs((q.w || 0) - maxW) < 1e-6) mr = Math.max(mr, q.r || 0); });
    return s.r > mr;
  }
  return false;
}

// Завершение: оставляем только выполненные подходы; возвращает false, если нечего сохранять
function finalizeWorkout(w) {
  w.entries = w.entries.map(function (e) {
    e.sets = e.sets.filter(function (s) { return s.done; });
    return e;
  }).filter(function (e) { return e.sets.length && exById(e.ex); });
  if (!w.entries.length) return false;
  w.end = Date.now();
  w.prs = w.entries.reduce(function (a, e) { return a + e.sets.filter(function (s) { return s.pr; }).length; }, 0);
  return true;
}
function workoutSets(w) {
  var n = 0;
  w.entries.forEach(function (e) { e.sets.forEach(function (s) { if (s.done && !('s' in s)) n++; }); });
  return n;
}
function workoutCardioMin(w) {
  var sec = 0;
  w.entries.forEach(function (e) { e.sets.forEach(function (s) { if (s.done && ('s' in s)) sec += s.s || 0; }); });
  return sec / 60;
}

/* ---------- рекорды, серии для графиков ---------- */
function records(exId) {
  var best = null;
  state.workouts.forEach(function (w) {
    w.entries.forEach(function (e) {
      if (e.ex !== exId) return;
      e.sets.forEach(function (s) {
        if (!s.done || ('s' in s)) return;
        var sw = s.w || 0, sr = s.r || 0;
        if (!best || sw > best.w + 1e-6 || (Math.abs(sw - best.w) < 1e-6 && sr > best.r)) best = { w: sw, r: sr, t: w.start };
      });
    });
  });
  return best;
}
function exSeries(exId, since) {
  var pts = [];
  state.workouts.forEach(function (w) {
    if (w.start < since) return;
    w.entries.forEach(function (e) {
      if (e.ex !== exId) return;
      var maxW = 0, reps = 0, sec = 0, any = false;
      e.sets.forEach(function (s) {
        if (!s.done) return;
        any = true;
        if ('s' in s) { sec += s.s || 0; return; }
        var sw = s.w || 0, sr = s.r || 0;
        if (sw > maxW + 1e-6) { maxW = sw; reps = sr; }
        else if (Math.abs(sw - maxW) < 1e-6) reps = Math.max(reps, sr);
      });
      if (any) pts.push({ t: w.start, w: maxW, r: reps, sec: sec });
    });
  });
  return pts;
}
function exercisesWithData() {
  var seen = {}, list = [];
  for (var i = state.workouts.length - 1; i >= 0; i--) {
    state.workouts[i].entries.forEach(function (e) {
      if (!seen[e.ex] && exById(e.ex)) { seen[e.ex] = 1; list.push(exById(e.ex)); }
    });
  }
  return list;
}
function weeklySummary(n) {
  var out = [], mon = weekStart(Date.now());
  for (var i = 0; i < n; i++) {
    var s = new Date(mon); s.setDate(s.getDate() - 7 * i);
    var e = new Date(s); e.setDate(e.getDate() + 7);
    var cnt = 0, vol = 0, sec = 0, a = s.getTime(), b = e.getTime();
    state.workouts.forEach(function (w) {
      if (w.start < a || w.start >= b) return;
      cnt++;
      w.entries.forEach(function (en) {
        en.sets.forEach(function (x) {
          if (!x.done) return;
          if ('s' in x) sec += x.s || 0; else vol += (x.w || 0) * (x.r || 0);
        });
      });
    });
    out.push({ t: a, cnt: cnt, vol: vol, min: sec / 60 });
  }
  return out;
}

/* ---------- награды: опыт, уровни, серии, достижения ---------- */
function workoutXP(w) {
  var sets = 0, sec = 0;
  w.entries.forEach(function (e) {
    e.sets.forEach(function (s) {
      if (!s.done) return;
      if ('s' in s) sec += s.s || 0; else sets++;
    });
  });
  return Math.round(50 + sets * 3 + Math.min(60, sec / 60) + (w.prs || 0) * 25);
}
function totalXP() { return state.workouts.reduce(function (a, w) { return a + workoutXP(w); }, 0); }
function levelInfo(xp) {
  var L = Math.max(1, Math.floor((1 + Math.sqrt(1 + xp / 12.5)) / 2));
  var cur = 50 * L * (L - 1), next = 50 * (L + 1) * L;
  return { L: L, cur: cur, next: next, p: (xp - cur) / (next - cur) };
}
function levelName(L) {
  var names = String(state.settings.levels || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  if (!names.length) names = t('levels').split(',');
  return names[Math.min(L - 1, names.length - 1)];
}
function weekCounts() {
  var m = {};
  state.workouts.forEach(function (w) { var k = dayKey(weekStart(w.start).getTime()); m[k] = (m[k] || 0) + 1; });
  return m;
}
function weekDoneCount() { return weekCounts()[dayKey(weekStart(Date.now()).getTime())] || 0; }
// Серия: недели подряд с выполненной целью. Один пропуск в месяц прощается («щит»).
function streak() {
  if (!state.workouts.length) return 0;
  var goal = Math.max(1, state.settings.goal | 0), c = weekCounts();
  var first = Infinity;
  state.workouts.forEach(function (w) { first = Math.min(first, weekStart(w.start).getTime()); });
  var wk = weekStart(Date.now()), s = 0, used = {};
  if ((c[dayKey(wk.getTime())] || 0) >= goal) s++;
  for (var i = 0; i < 600; i++) {
    wk.setDate(wk.getDate() - 7);
    if (wk.getTime() < first) break;
    var key = dayKey(wk.getTime());
    if ((c[key] || 0) >= goal) s++;
    else { var m = key.slice(0, 7); if (used[m]) break; used[m] = true; }
  }
  return s;
}
var ACH = [
  { id: 'w1', ic: '🎯', f: function (s) { return s.n >= 1; } },
  { id: 'w10', ic: '💪', f: function (s) { return s.n >= 10; } },
  { id: 'w25', ic: '🔥', f: function (s) { return s.n >= 25; } },
  { id: 'w50', ic: '⭐', f: function (s) { return s.n >= 50; } },
  { id: 'w100', ic: '👑', f: function (s) { return s.n >= 100; } },
  { id: 'pr1', ic: '🏆', f: function (s) { return s.prs >= 1; } },
  { id: 'pr10', ic: '🥇', f: function (s) { return s.prs >= 10; } },
  { id: 'st4', ic: '⚡', f: function (s) { return s.streak >= 4; } },
  { id: 'st8', ic: '🚀', f: function (s) { return s.streak >= 8; } },
  { id: 'st12', ic: '🌋', f: function (s) { return s.streak >= 12; } },
  { id: 'v10', ic: '🏗️', f: function (s) { return s.vol >= 10000; } },
  { id: 'v100', ic: '🛳️', f: function (s) { return s.vol >= 100000; } },
  { id: 'c10', ic: '🏃', f: function (s) { return s.cardioMin >= 600; } },
  { id: 'b10', ic: '⚖️', f: function (s) { return s.bodyLogs >= 10; } },
  { id: 'ph4', ic: '📷', f: function (s) { return s.photos >= 4; } }
];
function stats() {
  var prs = 0, vol = 0, cardioSec = 0;
  state.workouts.forEach(function (w) {
    prs += w.prs || 0;
    w.entries.forEach(function (e) {
      e.sets.forEach(function (s) {
        if (!s.done) return;
        if ('s' in s) cardioSec += s.s || 0; else vol += (s.w || 0) * (s.r || 0);
      });
    });
  });
  return { n: state.workouts.length, prs: prs, vol: vol, cardioMin: cardioSec / 60, streak: streak(),
    bodyLogs: state.body.weights.length + state.body.values.length, photos: state.photos.length };
}
function checkAch() {
  var st = stats(), out = [];
  ACH.forEach(function (a) {
    if (!state.gam.ach[a.id] && a.f(st)) { state.gam.ach[a.id] = Date.now(); out.push(a); }
  });
  return out;
}

/* ---------- программы ---------- */
function progInfo(p) {
  var sm = weekStart(parseDay(p.start).getTime()).getTime(), cm = weekStart(Date.now()).getTime();
  var wk = Math.round((cm - sm) / (7 * 864e5)) + 1;
  return { week: wk, total: p.weeks, current: wk >= 1 && wk <= p.weeks, finished: wk > p.weeks, upcoming: wk < 1 };
}

/* ---------- умные подсказки ---------- */
function getHints() {
  var out = [], now = Date.now(), today = todayStr(), dow = new Date(now).getDay();
  var td = new Date(now); td.setHours(0, 0, 0, 0);
  var todayWs = state.workouts.filter(function (w) { return dayKey(w.start) === today; });

  state.programs.forEach(function (p) {
    if (!p.active) return;
    var inf = progInfo(p);
    if (!inf.current) return;
    var did = p.sched[dow], d = did ? dayById(did) : null;
    if (d && !todayWs.length && !state.active) {
      out.push({ id: 'today-' + p.id, kind: 'today', day: d.id, text: t('h_today', { day: d.name, prog: p.name, w: inf.week, n: p.weeks }) });
    }
    var missed = 0, mon = weekStart(now), sd = parseDay(p.start);
    for (var k = 0; k < 7; k++) {
      var dt = new Date(mon); dt.setDate(dt.getDate() + k);
      if (dt.getTime() >= td.getTime() || dt.getTime() < sd.getTime()) continue;
      if (!p.sched[dt.getDay()]) continue;
      var key = dayKey(dt.getTime());
      if (!state.workouts.some(function (w) { return dayKey(w.start) === key; })) missed++;
    }
    if (missed) out.push({ id: 'missed-' + p.id, kind: 'missed', text: t('h_missed', { n: missed }) });
  });

  if (state.settings.photoRemind) {
    var haveThisWeek = state.photos.some(function (p) { return p.t >= weekStart(now).getTime(); });
    var pdow = (state.settings.photoDay + 6) % 7, tdow = (dow + 6) % 7;
    if (!haveThisWeek && tdow >= pdow) out.push({ id: 'photo', kind: 'photo', text: state.photos.length ? t('h_photo') : t('h_photo0') });
  }

  if (state.workouts.length) {
    var wc = weekDoneCount(), goal = state.settings.goal, sk = streak();
    if (wc < goal) {
      if (sk > 0) out.push({ id: 'streak', text: t('h_streak', { n: sk, left: goal - wc }) });
      else out.push({ id: 'goal', text: t('h_goal', { done: wc, goal: goal }) });
    }
    var lw = state.workouts[state.workouts.length - 1];
    if (now - lw.start < 14 * 864e5) {
      var ups = [], des = [];
      lw.entries.forEach(function (e) {
        var ex = exById(e.ex), sg = suggest(ex);
        if (!sg) return;
        var lab = ex.name + ' → ' + fmtW(sg.w) + ' ' + unitLabel();
        if (sg.kind === 'up') ups.push(lab);
        if (sg.kind === 'deload') des.push(lab);
      });
      if (ups.length) out.push({ id: 'up', text: t('h_up', { list: ups.slice(0, 3).join(', ') }) });
      if (des.length) out.push({ id: 'deload', text: t('h_deload', { list: des.slice(0, 3).join(', ') }) });
    }
    var lb = state.body.weights.length ? state.body.weights[state.body.weights.length - 1].t : 0;
    if (!lb || now - lb >= 7 * 864e5) out.push({ id: 'body', text: lb ? t('h_body', { n: Math.floor((now - lb) / 864e5) }) : t('h_body0') });
  }
  return out.filter(function (h) { return !state.dismissed[h.id + '@' + today]; }).slice(0, 3);
}

/* ---------- календарь (.ics) ---------- */
var ICS_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
function icsText(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
function icsDate(d) { return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()); }
function icsFold(line) {
  var out = [], s = line;
  while (s.length > 36) { out.push(s.slice(0, 36)); s = ' ' + s.slice(36); }
  out.push(s);
  return out;
}
function icsEvent(uid_, firstDate, hh, mm, durMin, count, dowCode, summary, desc, alarms) {
  var now = new Date();
  var stamp = now.getUTCFullYear() + pad(now.getUTCMonth() + 1) + pad(now.getUTCDate()) + 'T' + pad(now.getUTCHours()) + pad(now.getUTCMinutes()) + pad(now.getUTCSeconds()) + 'Z';
  var st = new Date(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate(), hh, mm);
  var en = new Date(st.getTime() + durMin * 60000);
  var L = ['BEGIN:VEVENT', 'UID:' + uid_ + '@wt.local', 'DTSTAMP:' + stamp,
    'DTSTART:' + icsDate(st) + 'T' + pad(st.getHours()) + pad(st.getMinutes()) + '00',
    'DTEND:' + icsDate(en) + 'T' + pad(en.getHours()) + pad(en.getMinutes()) + '00',
    'RRULE:FREQ=WEEKLY;COUNT=' + count + ';BYDAY=' + dowCode,
    'SUMMARY:' + icsText(summary)];
  if (desc) L.push('DESCRIPTION:' + icsText(desc));
  alarms.forEach(function (m) {
    L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsText(summary), 'TRIGGER:' + (m ? '-PT' + m + 'M' : 'PT0M'), 'END:VALARM');
  });
  L.push('END:VEVENT');
  return L;
}
function icsWrap(events) {
  var L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WorkoutTracker//RU', 'CALSCALE:GREGORIAN'];
  events.forEach(function (ev) { L = L.concat(ev); });
  L.push('END:VCALENDAR');
  var folded = [];
  L.forEach(function (l) { folded = folded.concat(icsFold(l)); });
  return folded.join('\r\n') + '\r\n';
}
function parseHM(s, dh, dm) {
  var p = String(s || '').split(':'), h = parseInt(p[0], 10), m = parseInt(p[1], 10);
  return [isNaN(h) ? dh : h, isNaN(m) ? dm : m];
}
function buildProgramICS(p) {
  var hm = parseHM(state.settings.remindTime, 18, 0);
  var startDay = parseDay(p.start), mon = weekStart(startDay.getTime()), evs = [];
  Object.keys(p.sched).forEach(function (k) {
    var d = dayById(p.sched[k]);
    if (!d) return;
    k = +k;
    var first = new Date(mon);
    first.setDate(first.getDate() + (k + 6) % 7);
    var weeks = p.weeks;
    if (first.getTime() < startDay.getTime()) { first.setDate(first.getDate() + 7); weeks = Math.max(1, weeks - 1); }
    var names = d.items.map(function (it) { var e = exById(it.ex); return e ? e.name : ''; }).filter(Boolean).join(', ');
    evs.push(icsEvent(p.id + '-' + k, first, hm[0], hm[1], 60, weeks, ICS_CODES[k], p.name + ': ' + d.name, names, [30, 0]));
  });
  return icsWrap(evs);
}
function buildPhotoICS() {
  var hm = parseHM(state.settings.photoTime, 9, 0), dow = state.settings.photoDay;
  var first = new Date();
  first.setHours(0, 0, 0, 0);
  while (first.getDay() !== dow) first.setDate(first.getDate() + 1);
  return icsWrap([icsEvent('photo-weekly', first, hm[0], hm[1], 15, 104, ICS_CODES[dow], t('ics_photo'), t('ics_photo_d'), [0])]);
}

/* ---------- файлы: экспорт/импорт ---------- */
function saveFile(name, mime, text) {
  var blob = new Blob([text], { type: mime });
  try {
    var f = new File([blob], name, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [f] })) {
      navigator.share({ files: [f], title: name }).catch(function () {});
      return;
    }
  } catch (e) {}
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { try { URL.revokeObjectURL(a.href); } catch (e) {} a.remove(); }, 2000);
}
function validBackup(o) {
  return !!(o && typeof o === 'object' && Array.isArray(o.workouts) && Array.isArray(o.exercises) && o.settings);
}

/* ---------- фото прогресса: файлы хранятся в IndexedDB ---------- */
var photoDB = null;
function idbOpen(cb) {
  if (photoDB) return cb(photoDB);
  try {
    var r = indexedDB.open('wt_photos', 1);
    r.onupgradeneeded = function () { r.result.createObjectStore('p'); };
    r.onsuccess = function () { photoDB = r.result; cb(photoDB); };
    r.onerror = function () { cb(null); };
  } catch (e) { cb(null); }
}
function photoPut(id, blob, cb) {
  idbOpen(function (db) {
    if (!db) return cb(false);
    var tx = db.transaction('p', 'readwrite');
    tx.objectStore('p').put(blob, id);
    tx.oncomplete = function () { cb(true); };
    tx.onerror = function () { cb(false); };
  });
}
function photoGet(id, cb) {
  idbOpen(function (db) {
    if (!db) return cb(null);
    var rq = db.transaction('p', 'readonly').objectStore('p').get(id);
    rq.onsuccess = function () { cb(rq.result || null); };
    rq.onerror = function () { cb(null); };
  });
}
function photoDel(id, cb) {
  idbOpen(function (db) {
    if (!db) return cb && cb(false);
    var tx = db.transaction('p', 'readwrite');
    tx.objectStore('p').delete(id);
    tx.oncomplete = function () { cb && cb(true); };
    tx.onerror = function () { cb && cb(false); };
  });
}
function resizeImage(file, max, cb) {
  var url = URL.createObjectURL(file), img = new Image();
  img.onload = function () {
    var s = Math.min(1, max / Math.max(img.width, img.height));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * s));
    c.height = Math.max(1, Math.round(img.height * s));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    c.toBlob(function (b) { cb(b); }, 'image/jpeg', 0.82);
  };
  img.onerror = function () { URL.revokeObjectURL(url); cb(null); };
  img.src = url;
}
