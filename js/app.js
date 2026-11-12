import { score, recoveryColor, recoveryWords, strainTarget } from './scoring.js';
import { demoDays, DEMO_VERSION } from './demo.js';
import { mountHrChart } from './hr-chart.js';

// ---- storage (everything stays on this device) -----------------------------
const store = {
  get(k, fallback) {
    try { const v = localStorage.getItem('pulse.' + k); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  set(k, v) {
    try { localStorage.setItem('pulse.' + k, JSON.stringify(v)); return true; } catch { return false; }
  },
  del(k) { try { localStorage.removeItem('pulse.' + k); } catch {} },
};

const DEFAULTS = { age: 35, maxHr: 0, sleepNeedHours: 8, importDays: 180 };
let settings = { ...DEFAULTS, ...store.get('settings', {}) };
let raw = store.get('days', {});
let isDemo = store.get('demo', false);
let scored = [];
let idx = 0;
let tab = 'today';
let trendRange = 30;

const $ = (s) => document.querySelector(s);
const view = $('#view');
const maxHr = () => settings.maxHr || Math.round(208 - 0.7 * settings.age); // Tanaka formula

function rescore() {
  scored = score(raw, settings);
  idx = Math.max(0, Math.min(idx, scored.length - 1));
}

// ---- formatting --------------------------------------------------------------
const fmtH = (min) => (min == null ? '–' : `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}`);
const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtNum = (n) => (n == null ? '–' : n.toLocaleString());
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const localKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function dateLabel(key) {
  const today = localKey(new Date());
  const yest = localKey(new Date(Date.now() - 864e5));
  if (key === today) return 'Today';
  if (key === yest) return 'Yesterday';
  return new Date(key + 'T12:00:00').toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
}

function dial(value, max, color, label, text) {
  const r = 52, c = 2 * Math.PI * r;
  const frac = value == null ? 0 : Math.max(0.01, Math.min(1, value / max));
  return `<div class="dial">
    <svg viewBox="0 0 130 130" role="img" aria-label="${label} ${text}">
      <circle cx="65" cy="65" r="${r}" fill="none" stroke="var(--card2)" stroke-width="11"/>
      <circle cx="65" cy="65" r="${r}" fill="none" stroke="${color}" stroke-width="11" stroke-linecap="round"
        stroke-dasharray="${c * frac} ${c}" transform="rotate(-90 65 65)"/>
      <text x="65" y="74" text-anchor="middle" font-size="${text.length > 4 ? 22 : 28}">${text}</text>
    </svg>
    <div class="lab">${label}</div>
  </div>`;
}

function stat(k, v, unit, base, higherIsBetter) {
  let d = '';
  if (v != null && base != null) {
    const diff = Math.round((v - base) * 10) / 10;
    const good = higherIsBetter ? diff >= 0 : diff <= 0;
    d = `<div class="d ${Math.abs(diff) < 0.05 ? '' : good ? 'up' : 'down'}">${diff > 0 ? '▲' : diff < 0 ? '▼' : '•'} ${Math.abs(diff)} vs ${base} avg</div>`;
  }
  return `<div class="stat"><div class="k">${k}</div><div class="v">${v ?? '–'} <small>${v != null ? unit : ''}</small></div>${d}</div>`;
}

// ---- screens -------------------------------------------------------------------
function renderEmpty() {
  view.innerHTML = `<div class="empty">
    <svg width="84" height="84" viewBox="0 0 130 130"><circle cx="65" cy="65" r="52" fill="none" stroke="var(--card2)" stroke-width="11"/>
    <circle cx="65" cy="65" r="52" fill="none" stroke="var(--green)" stroke-width="11" stroke-linecap="round" stroke-dasharray="230 400" transform="rotate(-90 65 65)"/></svg>
    <h1>Welcome to Field Line</h1>
    <p>Daily recovery, strain and sleep scores from your Apple Health data. Nothing leaves your phone.</p>
    <button class="btn" data-go="settings">Import Apple Health data</button>
    <button class="btn ghost" id="tryDemo">Try it with demo data</button>
  </div>`;
}

function renderToday(d) {
  const target = strainTarget(d.recovery);
  const sleepText = d.sleepPerf != null ? d.sleepPerf + '%' : '–';
  const w = d.workouts || [];
  view.innerHTML = `
    <div class="dials">
      ${dial(d.recovery, 100, recoveryColor(d.recovery), 'Recovery', d.recovery != null ? d.recovery + '%' : '–')}
      ${dial(d.strain, 21, 'var(--strain)', 'Strain', d.strain != null ? d.strain.toFixed(1) : '–')}
      ${dial(d.sleepPerf, 100, 'var(--sleep)', 'Sleep', sleepText)}
    </div>

    <section class="card">
      <h2>Recovery</h2>
      <p class="headline" style="color:${recoveryColor(d.recovery)} !important">${recoveryWords(d.recovery)}</p>
      ${target ? `<p>Strain target today: <b style="color:var(--strain)">${target[0]}–${target[1]}</b></p>` : '<p>Recovery needs about a week of HRV or resting heart rate readings to build your baseline.</p>'}
      <div class="stats">
        ${stat('HRV', d.hrv, 'ms', d.baseline.hrv, true)}
        ${stat('Resting HR', d.rhr, 'bpm', d.baseline.rhr, false)}
        ${stat('Resp. rate', d.resp, 'rpm', d.baseline.resp, false)}
        ${stat('Blood oxygen', d.spo2, '%', null)}
      </div>
    </section>

    <section class="card">
      <h2>Heart rate</h2>
      <div id="hrChart"></div>
    </section>

    <section class="card">
      <h2>Strain</h2>
      <div class="big" style="color:var(--strain)">${d.strain != null ? d.strain.toFixed(1) : '–'} <small style="font-size:14px;color:var(--muted)">/ 21</small></div>
      ${d.zones ? `<div class="zones">${d.zones.map((m, i) => {
        const top = Math.max(...d.zones, 1);
        return `<div class="zone"><span>Zone ${i + 1}</span><div class="bar"><div style="width:${(m / top) * 100}%;opacity:${0.45 + i * 0.14}"></div></div><span>${fmtH(m)}</span></div>`;
      }).join('')}</div>` : '<p>No heart rate data for this day.</p>'}
      <div class="stats">
        ${stat('Max HR', d.maxHr, 'bpm')}
        ${stat('Avg HR', d.avgHr, 'bpm')}
        ${stat('Steps', d.steps != null ? fmtNum(d.steps) : null, '')}
        ${stat('Active cal', d.kcal != null ? fmtNum(d.kcal) : null, 'kcal')}
      </div>
      ${w.length ? `<ul class="list" style="margin-top:12px">${w.map((x) => `<li><span>${esc(x.type)}<br><span class="muted">${fmtTime(x.start)}</span></span><span style="text-align:right">${x.min} min${x.kcal ? `<br><span class="muted">${x.kcal} kcal</span>` : ''}</span></li>`).join('')}</ul>` : ''}
    </section>

    ${sleepCard(d, true)}`;
  mountHrChart(document.getElementById('hrChart'), scored, d.date);
}

const STAGES = {
  w: ['Awake', 'var(--awake)'],
  r: ['REM', 'var(--rem)'],
  c: ['Core', 'var(--core)'],
  d: ['Deep', 'var(--deep)'],
  s: ['Asleep', 'var(--sleep)'],
};

// Bar graph of the night: one row per stage, a block for each stretch of time in it.
function hypnogram(s) {
  if (!s.segs?.length) return '<p class="note" style="margin-top:12px">Re-import your Health export to see the stage-by-stage outline of each night.</p>';
  const rows = s.staged ? ['w', 'r', 'c', 'd'] : ['w', 's'];
  const total = Math.max(...s.segs.map((x) => x[1]), 1);
  const W = 320, H = s.staged ? 150 : 90, L = 46, R = 6, B = 18;
  const rowH = (H - B) / rows.length;
  const x = (m) => L + (m / total) * (W - L - R);
  const y = (code) => rows.indexOf(code === 's' && s.staged ? 'c' : code) * rowH;
  let ticks = '';
  const first = new Date(s.start);
  const stepH = total > 9 * 60 ? 2 : 1;
  for (let h = 1; ; h++) {
    const tm = new Date(first); tm.setMinutes(0, 0, 0); tm.setHours(first.getHours() + h);
    const m = (tm - s.start) / 6e4;
    if (m >= total) break;
    if (tm.getHours() % stepH) continue;
    ticks += `<line x1="${x(m)}" x2="${x(m)}" y1="0" y2="${H - B}" stroke="var(--line)"/>
      <text class="axis" x="${x(m)}" y="${H - 4}" text-anchor="middle">${tm.toLocaleTimeString([], { hour: 'numeric' }).replace(/\s?([AP])M/i, (_, a) => a.toLowerCase())}</text>`;
  }
  const step = s.segs.map((g, i) => `${i ? 'L' : 'M'}${x(g[0])},${y(g[2]) + rowH / 2} L${x(g[1])},${y(g[2]) + rowH / 2}`).join(' ');
  return `<div class="chart" style="margin-top:14px"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sleep stages through the night">
    ${rows.map((c, i) => `<text class="axis" x="0" y="${i * rowH + rowH / 2 + 3}">${STAGES[c][0]}</text>`).join('')}
    ${ticks}
    <path d="${step}" fill="none" stroke="var(--muted)" stroke-width="1" opacity=".35"/>
    ${s.segs.map((g) => `<rect x="${x(g[0])}" y="${y(g[2]) + 3}" width="${Math.max(1.2, x(g[1]) - x(g[0]))}" height="${rowH - 6}" rx="2" fill="${STAGES[g[2]][1]}"><title>${STAGES[g[2]][0]} ${fmtTime(s.start + g[0] * 6e4)}–${fmtTime(s.start + g[1] * 6e4)}</title></rect>`).join('')}
  </svg></div>`;
}

function sleepCard(d, compact) {
  const s = d.sleep;
  if (!s) return `<section class="card"><h2>Sleep</h2><p>No sleep recorded for last night. Wear your Apple Watch to bed with Sleep turned on in the Health app.</p></section>`;
  const span = s.asleep + s.awake || 1;
  const segs = s.staged
    ? [['deep', s.deep], ['core', s.core], ['rem', s.rem], ['awake', s.awake]]
    : [['sleep', s.asleep], ['awake', s.awake]];
  return `<section class="card">
    <h2>Sleep</h2>
    <div class="big" style="color:var(--sleep)">${fmtH(s.asleep)} <small style="font-size:14px;color:var(--muted)">of ${fmtH(d.sleepNeed)} needed</small></div>
    <p>${fmtTime(s.start)} → ${fmtTime(s.end)} · ${d.sleepPerf}% performance</p>
    ${hypnogram(s)}
    <div class="bar" style="height:14px;margin-top:10px">${segs.map(([k, m]) => `<div style="width:${(m / span) * 100}%;background:var(--${k === 'sleep' ? 'sleep' : k})"></div>`).join('')}</div>
    <div class="legend">${segs.map(([k, m]) => `<span><i style="background:var(--${k === 'sleep' ? 'sleep' : k})"></i>${k[0].toUpperCase() + k.slice(1)} ${fmtH(m)}</span>`).join('')}</div>
    ${compact ? '' : `<div class="stats">
      ${stat('Efficiency', Math.round((s.asleep / Math.max(1, (s.end - s.start) / 6e4)) * 100), '%')}
      ${stat('Sleep need', fmtH(d.sleepNeed), 'h')}
      ${stat('Deep', s.staged ? Math.round((s.deep / s.asleep) * 100) : null, '%')}
      ${stat('REM', s.staged ? Math.round((s.rem / s.asleep) * 100) : null, '%')}
    </div>
    <p class="note" style="margin-top:12px">Sleep need is your base of ${settings.sleepNeedHours} h, plus extra after a hard day and to pay back part of any sleep debt.</p>`}
  </section>`;
}

function renderSleep(d) {
  const week = scored.slice(Math.max(0, idx - 6), idx + 1);
  view.innerHTML = sleepCard(d, false) + `<section class="card chart"><h2>Last 7 nights</h2>
    ${bars(week.map((x) => ({ v: x.sleep?.asleep / 60, label: x.date.slice(8), color: 'var(--sleep)', ref: x.sleepNeed / 60 })), 10, (v) => v.toFixed(1) + 'h')}</section>`;
}

function bars(items, maxV, fmt) {
  const W = 320, H = 140, pad = 18, n = items.length || 1, bw = (W / n) * 0.7;
  const y = (v) => H - pad - (Math.min(v, maxV) / maxV) * (H - pad - 8);
  const showEvery = Math.ceil(n / 10);
  return `<svg viewBox="0 0 ${W} ${H}">
    ${items.map((it, i) => {
      const x = (i + 0.15) * (W / n);
      const val = it.v == null || isNaN(it.v) ? null : it.v;
      return `${val != null ? `<rect x="${x}" y="${y(val)}" width="${bw}" height="${H - pad - y(val)}" rx="${Math.min(3, bw / 2)}" fill="${it.color}"><title>${it.label}: ${fmt(val)}</title></rect>` : ''}
        ${it.ref ? `<rect x="${x - 1}" y="${y(it.ref) - 1}" width="${bw + 2}" height="2" fill="var(--muted)" opacity=".7"/>` : ''}
        ${i % showEvery === 0 ? `<text class="axis" x="${x + bw / 2}" y="${H - 4}" text-anchor="middle">${it.label}</text>` : ''}`;
    }).join('')}
  </svg>`;
}

function line(series, labels) {
  const W = 320, H = 140, pad = 18;
  const all = series.flatMap((s) => s.values).filter((v) => v != null);
  if (!all.length) return '<p>No data in this range.</p>';
  const lo = Math.min(...all) * 0.95, hi = Math.max(...all) * 1.05;
  const n = labels.length;
  const x = (i) => (n === 1 ? W / 2 : 6 + (i / (n - 1)) * (W - 12));
  const y = (v) => H - pad - ((v - lo) / (hi - lo || 1)) * (H - pad - 8);
  const showEvery = Math.ceil(n / 8);
  return `<svg viewBox="0 0 ${W} ${H}">
    ${series.map((s) => {
      const pts = s.values.map((v, i) => (v == null ? null : `${x(i)},${y(v)}`)).filter(Boolean).join(' ');
      return `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>`;
    }).join('')}
    ${labels.map((l, i) => (i % showEvery === 0 ? `<text class="axis" x="${x(i)}" y="${H - 4}" text-anchor="middle">${l}</text>` : '')).join('')}
  </svg>`;
}

function renderTrends() {
  const r = scored.slice(-trendRange);
  const avg = (k) => { const v = r.map((x) => x[k]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const labels = r.map((x) => x.date.slice(8));
  const nights = r.filter((x) => x.sleep);
  const avgSleep = nights.length ? nights.reduce((a, x) => a + x.sleep.asleep, 0) / nights.length : null;
  view.innerHTML = `
    <div class="seg">${[7, 30, 90].map((n) => `<button data-range="${n}" class="${n === trendRange ? 'on' : ''}">${n} days</button>`).join('')}</div>
    <section class="card chart"><h2>Recovery · avg ${avg('recovery') != null ? Math.round(avg('recovery')) + '%' : '–'}</h2>
      ${bars(r.map((x) => ({ v: x.recovery, label: x.date.slice(8), color: recoveryColor(x.recovery) })), 100, (v) => v + '%')}</section>
    <section class="card chart"><h2>Strain · avg ${avg('strain')?.toFixed(1) ?? '–'}</h2>
      ${bars(r.map((x) => ({ v: x.strain, label: x.date.slice(8), color: 'var(--strain)' })), 21, (v) => v.toFixed(1))}</section>
    <section class="card chart"><h2>Sleep · avg ${fmtH(avgSleep)}</h2>
      ${bars(r.map((x) => ({ v: x.sleep ? x.sleep.asleep / 60 : null, label: x.date.slice(8), color: 'var(--sleep)', ref: x.sleepNeed / 60 })), 10, (v) => v.toFixed(1) + 'h')}</section>
    <section class="card chart"><h2>HRV <span style="color:var(--green)">●</span> &nbsp;Resting HR <span style="color:var(--red)">●</span></h2>
      ${line([{ values: r.map((x) => x.hrv), color: 'var(--green)' }], labels)}
      ${line([{ values: r.map((x) => x.rhr), color: 'var(--red)' }], labels)}</section>`;
}

function renderSettings() {
  const n = Object.keys(raw).length;
  view.innerHTML = `
    <section class="card">
      <h2>Import Apple Health</h2>
      <ol class="steps">
        <li>Open the <b>Health</b> app on your iPhone.</li>
        <li>Tap your <b>profile picture</b> (top right).</li>
        <li>Tap <b>Export All Health Data</b> → <b>Export</b>. This can take a few minutes.</li>
        <li>Choose <b>Save to Files</b>.</li>
        <li>Come back here, tap the button below and pick <b>export.zip</b>.</li>
      </ol>
      <p class="note">Re-import every few days (or whenever you like) to bring in new days. The file is read on your phone and never uploaded anywhere.</p>
      <input type="file" id="file" accept=".zip,.xml,application/zip,text/xml" hidden>
      <button class="btn" id="pick" style="margin-top:12px">Choose export.zip</button>
      <div id="importStatus" class="note" style="margin-top:10px"></div>
      <div class="progress" hidden><div></div></div>
    </section>

    <section class="card">
      <h2>You</h2>
      <label class="row">Age <input type="number" id="age" min="10" max="100" value="${settings.age}"></label>
      <label class="row">Max heart rate <input type="number" id="maxHr" min="0" max="230" value="${settings.maxHr || ''}" placeholder="${maxHr()}"></label>
      <label class="row">Base sleep need (hours) <input type="number" id="sleepNeedHours" step="0.25" min="5" max="11" value="${settings.sleepNeedHours}"></label>
      <label class="row">Days to import
        <select id="importDays">${[30, 90, 180, 365, 730].map((v) => `<option value="${v}" ${v === settings.importDays ? 'selected' : ''}>${v}</option>`).join('')}</select>
      </label>
      <p class="note">Leave max heart rate blank to estimate it from your age. Change it and re-import to update heart-rate zones.</p>
    </section>

    <section class="card">
      <h2>Data</h2>
      <p>${n ? `${n} days stored on this device${isDemo ? ' (demo data)' : ''}.` : 'No data yet.'}</p>
      <button class="btn ghost" id="tryDemo">Load demo data</button>
      ${n ? '<button class="btn danger" id="clear">Delete all data from this device</button>' : ''}
    </section>

    <section class="card">
      <h2>How the scores work</h2>
      <p><b style="color:var(--text)">Recovery</b> compares last night's HRV, resting heart rate and breathing rate with your own 30-day average, and adds how well you slept.</p>
      <p><b style="color:var(--text)">Strain</b> (0–21) adds up time spent with your heart rate well above resting, weighting harder efforts more, on a scale that gets harder to climb the higher you go.</p>
      <p><b style="color:var(--text)">Sleep</b> is time asleep compared with what you needed.</p>
      <p class="note">Field Line is not a medical device. Scores are guides only.</p>
    </section>`;
}

// ---- import -------------------------------------------------------------------
function runImport(file) {
  const status = $('#importStatus'), prog = $('.progress'), bar = prog.firstElementChild;
  prog.hidden = false;
  status.textContent = `Reading ${file.name} (${(file.size / 1e6).toFixed(0)} MB)…`;
  $('#pick').disabled = true;
  const worker = new Worker(new URL('./import-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.progress != null) {
      bar.style.width = m.progress * 100 + '%';
      status.textContent = m.status || `Reading… ${Math.round(m.progress * 100)}% · ${fmtNum(m.records)} readings`;
    }
    if (m.error) {
      status.innerHTML = `<span class="down">Import failed: ${esc(m.error)}</span>`;
      $('#pick').disabled = false;
      worker.terminate();
    }
    if (m.done) {
      worker.terminate();
      if (isDemo) raw = {};
      isDemo = false;
      Object.assign(raw, m.days);
      const saved = store.set('days', raw);
      store.set('demo', false);
      rescore();
      idx = scored.length - 1;
      status.innerHTML = `<span class="up">Imported ${Object.keys(m.days).length} days (${fmtNum(m.records)} readings).</span>${saved ? '' : ' Could not save to this device, so it will be lost when you close the app.'}`;
      $('#pick').disabled = false;
      setTimeout(() => go('today'), 1200);
    }
  };
  worker.onerror = (e) => {
    status.innerHTML = `<span class="down">Import failed: ${esc(e.message || 'worker error')}</span>`;
    $('#pick').disabled = false;
  };
  worker.postMessage({ file, daysBack: settings.importDays, maxHr: maxHr() });
}

// ---- wiring -------------------------------------------------------------------
function render() {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  const d = scored[idx];
  const dated = tab === 'today' || tab === 'sleep';
  $('#prev').style.visibility = $('#next').style.visibility = dated && d ? 'visible' : 'hidden';
  $('#prev').disabled = idx <= 0;
  $('#next').disabled = idx >= scored.length - 1;
  $('#dateLabel').textContent = dated && d ? dateLabel(d.date) : { trends: 'Trends', settings: 'Settings' }[tab] || 'Field Line';
  $('#dateSub').textContent = dated && d && isDemo ? 'Demo data' : dated && d ? d.date : '';
  if (tab === 'settings') return renderSettings();
  if (!scored.length) return renderEmpty();
  if (tab === 'today') renderToday(d);
  else if (tab === 'sleep') renderSleep(d);
  else renderTrends();
  window.scrollTo(0, 0);
}

function go(t) { tab = t; render(); }

document.querySelector('.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) go(b.dataset.tab);
});
$('#prev').onclick = () => { if (idx > 0) { idx--; render(); } };
$('#next').onclick = () => { if (idx < scored.length - 1) { idx++; render(); } };

view.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.go) go(t.dataset.go);
  else if (t.dataset.range) { trendRange = +t.dataset.range; renderTrends(); }
  else if (t.id === 'tryDemo') {
    loadDemo();
    rescore(); idx = scored.length - 1; go('today');
  } else if (t.id === 'clear') {
    if (confirm('Delete all Field Line data from this device?')) {
      raw = {}; isDemo = false; store.del('days'); store.del('demo'); rescore(); render();
    }
  } else if (t.id === 'pick') $('#file').click();
});

view.addEventListener('change', (e) => {
  const el = e.target;
  if (el.id === 'file' && el.files[0]) return runImport(el.files[0]);
  if (el.id in settings) {
    settings[el.id] = el.value === '' ? 0 : +el.value;
    store.set('settings', settings);
    rescore();
  }
});

let touchX = null;
view.addEventListener('touchstart', (e) => { touchX = e.target.closest('.hr-chart') ? null : e.touches[0].clientX; }, { passive: true });
view.addEventListener('touchend', (e) => {
  if (touchX == null || (tab !== 'today' && tab !== 'sleep')) return;
  const dx = e.changedTouches[0].clientX - touchX;
  touchX = null;
  if (Math.abs(dx) > 70) (dx > 0 ? $('#prev') : $('#next')).click();
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

function loadDemo() {
  raw = demoDays(); isDemo = true;
  store.set('days', raw); store.set('demo', DEMO_VERSION);
}

// Refresh demo data saved by an older version so it has the newer charts.
if (isDemo && isDemo !== DEMO_VERSION) loadDemo();

rescore();
idx = scored.length - 1;
render();
