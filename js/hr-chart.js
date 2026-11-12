// A 24-hour heart rate chart you drag sideways to travel back through the days.
// The line under the centre marker is the reading shown above the chart.

const BINS = 288; // 5-minute bins per day
let cache = null; // timeline built from the scored days, reused between renders

function buildTimeline(scored) {
  if (cache && cache.src === scored) return cache;
  const first = new Date(scored[0].date + 'T12:00:00');
  const last = new Date(scored[scored.length - 1].date + 'T12:00:00');
  const nDays = Math.round((last - first) / 864e5) + 1;
  const dates = [];
  for (let i = 0; i < nDays; i++) {
    const d = new Date(first); d.setDate(first.getDate() + i);
    dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  const data = new Int16Array(nDays * BINS);
  const byDate = new Map(scored.map((d) => [d.date, d]));
  let lo = 999, hi = 0, any = false;
  const dayStats = [];
  dates.forEach((k, i) => {
    const bins = byDate.get(k)?.hrBins;
    let mn = 999, mx = 0, sum = 0, n = 0;
    if (bins) bins.forEach((v, b) => {
      if (!v) return;
      data[i * BINS + b] = v; any = true;
      mn = Math.min(mn, v); mx = Math.max(mx, v); sum += v; n++;
    });
    dayStats.push(n ? { lo: mn, hi: mx, avg: Math.round(sum / n) } : null);
    if (n) { lo = Math.min(lo, mn); hi = Math.max(hi, mx); }
  });
  cache = {
    src: scored, dates, data, dayStats, any,
    lo: Math.max(30, Math.floor((lo - 5) / 10) * 10),
    hi: Math.ceil((hi + 5) / 10) * 10,
  };
  return cache;
}

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function mountHrChart(el, scored, focusDate) {
  if (!el) return;
  const tl = scored.length ? buildTimeline(scored) : null;
  if (!tl || !tl.any) {
    el.innerHTML = '<p>No heart rate readings yet. Import your Health export to see your heart rate through each day.</p>';
    return;
  }
  el.innerHTML = `
    <div class="hr-readout">
      <div><span class="hr-bpm">–</span> <small>bpm</small></div>
      <div class="hr-when"></div>
    </div>
    <div class="hr-chart"><canvas></canvas></div>
    <div class="hr-day note"></div>
    <p class="note">Drag the chart left or right to move through the day and back to earlier days. Tap a spot to jump to it.</p>`;
  const canvas = el.querySelector('canvas');
  const bpmEl = el.querySelector('.hr-bpm'), whenEl = el.querySelector('.hr-when'), dayEl = el.querySelector('.hr-day');
  const total = tl.dates.length * BINS;

  // Start at the latest reading on the chosen day.
  const di = Math.max(0, tl.dates.indexOf(focusDate));
  let lastBin = -1;
  for (let b = BINS - 1; b >= 0; b--) if (tl.data[di * BINS + b]) { lastBin = b; break; }
  let center = di * BINS + (lastBin >= 0 ? lastBin : BINS / 2);

  const colors = { line: css('--red'), grid: css('--line'), muted: css('--muted'), text: css('--text'), card: css('--card') };
  let W = 0, H = 0, dpr = 1;

  function size() {
    dpr = window.devicePixelRatio || 1;
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  }

  const valueNear = (b) => {
    for (let d = 0; d <= 2; d++) {
      const v = tl.data[b + d] || tl.data[b - d];
      if (v) return v;
    }
    return 0;
  };

  function draw() {
    if (!W) size();
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const top = 20, bottom = H - 18, right = W - 28;
    const pxPerBin = right / BINS;
    const x = (b) => right / 2 + (b - center) * pxPerBin;
    const y = (v) => bottom - ((v - tl.lo) / (tl.hi - tl.lo)) * (bottom - top);
    const b0 = Math.max(0, Math.floor(center - BINS / 2) - 1), b1 = Math.min(total - 1, Math.ceil(center + BINS / 2) + 1);

    // horizontal grid + bpm labels
    ctx.font = '300 10px ' + css('--font');
    ctx.textBaseline = 'middle';
    const step = tl.hi - tl.lo > 100 ? 40 : 20;
    for (let v = Math.ceil(tl.lo / step) * step; v <= tl.hi; v += step) {
      ctx.strokeStyle = colors.grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, y(v)); ctx.lineTo(right, y(v)); ctx.stroke();
      ctx.fillStyle = colors.muted; ctx.textAlign = 'left';
      ctx.fillText(v, right + 6, y(v));
    }

    // midnights (with date) and 6-hourly time labels
    ctx.textBaseline = 'alphabetic';
    for (let b = Math.ceil(b0 / 72) * 72; b <= b1; b += 72) {
      const px = x(b);
      if (b % BINS === 0) {
        ctx.strokeStyle = colors.muted; ctx.globalAlpha = 0.5;
        ctx.beginPath(); ctx.moveTo(px, top - 6); ctx.lineTo(px, bottom); ctx.stroke();
        ctx.globalAlpha = 1;
        const d = new Date(tl.dates[b / BINS] + 'T12:00:00');
        ctx.fillStyle = colors.text; ctx.textAlign = 'left';
        ctx.fillText(d.toLocaleDateString([], { weekday: 'short', day: 'numeric' }), px + 4, 12);
      }
      const h = ((b % BINS) / 12) | 0;
      ctx.fillStyle = colors.muted; ctx.textAlign = 'center';
      ctx.fillText(h === 0 ? '12a' : h === 12 ? '12p' : h > 12 ? h - 12 + 'p' : h + 'a', px, H - 4);
    }

    // the heart rate line, filled underneath, broken where there are no readings
    const grad = ctx.createLinearGradient(0, top, 0, bottom);
    grad.addColorStop(0, colors.line + '55'); grad.addColorStop(1, colors.line + '00');
    let run = [];
    const flush = () => {
      if (run.length > 1) {
        ctx.beginPath();
        run.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
        ctx.strokeStyle = colors.line; ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.stroke();
        ctx.lineTo(run[run.length - 1][0], bottom); ctx.lineTo(run[0][0], bottom); ctx.closePath();
        ctx.fillStyle = grad; ctx.fill();
      } else if (run.length === 1) {
        ctx.fillStyle = colors.line; ctx.fillRect(run[0][0] - 1, run[0][1] - 1, 2, 2);
      }
      run = [];
    };
    // Watches read every few minutes, so bridge gaps up to 20 minutes.
    let lastB = -99;
    for (let b = Math.max(0, b0 - 4); b <= b1; b++) {
      const v = tl.data[b];
      if (!v) continue;
      if (b - lastB > 4) flush();
      run.push([x(b), y(v)]);
      lastB = b;
    }
    flush();

    // centre marker
    const cb = Math.round(center);
    const v = valueNear(cb);
    ctx.strokeStyle = colors.text; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(right / 2, top - 6); ctx.lineTo(right / 2, bottom); ctx.stroke();
    if (v) {
      ctx.beginPath(); ctx.arc(right / 2, y(v), 4.5, 0, Math.PI * 2);
      ctx.fillStyle = colors.line; ctx.fill();
      ctx.strokeStyle = colors.card; ctx.lineWidth = 2; ctx.stroke();
    }

    // readout
    const day = Math.min(tl.dates.length - 1, Math.floor(cb / BINS));
    const mins = (cb - day * BINS) * 5;
    const when = new Date(tl.dates[day] + 'T00:00:00'); when.setMinutes(mins);
    bpmEl.textContent = v || '–';
    whenEl.textContent = when.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const st = tl.dayStats[day];
    dayEl.textContent = st ? `This day: low ${st.lo} · average ${st.avg} · high ${st.hi} bpm` : 'No readings on this day';
  }

  // dragging, with a little momentum when you let go
  let dragX = null, startCenter = 0, moved = 0, lastX = 0, lastT = 0, vel = 0, anim = 0;
  const clampC = (c) => Math.max(0, Math.min(total - 1, c));
  const binsPerPx = () => BINS / (W - 28);
  let queued = false;
  const redraw = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; draw(); }); } };

  canvas.addEventListener('pointerdown', (e) => {
    cancelAnimationFrame(anim);
    dragX = lastX = e.clientX; lastT = e.timeStamp; startCenter = center; moved = 0; vel = 0;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (dragX == null) return;
    moved = Math.max(moved, Math.abs(e.clientX - dragX));
    center = clampC(startCenter - (e.clientX - dragX) * binsPerPx());
    const dt = e.timeStamp - lastT;
    if (dt > 0) vel = (-(e.clientX - lastX) * binsPerPx()) / dt;
    lastX = e.clientX; lastT = e.timeStamp;
    redraw();
  });
  const end = (e) => {
    if (dragX == null) return;
    if (moved < 6) {
      const rect = canvas.getBoundingClientRect();
      center = clampC(center + (e.clientX - rect.left - (W - 28) / 2) * binsPerPx());
      redraw();
    } else if (Math.abs(vel) > 0.02 && e.timeStamp - lastT < 80) {
      let t0 = performance.now();
      const glide = (t) => {
        const dt = t - t0; t0 = t;
        center = clampC(center + vel * dt);
        vel *= Math.pow(0.994, dt);
        draw();
        if (Math.abs(vel) > 0.005 && center > 0 && center < total - 1) anim = requestAnimationFrame(glide);
      };
      anim = requestAnimationFrame(glide);
    }
    dragX = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', () => { dragX = null; });

  const onResize = () => { if (!document.body.contains(canvas)) return window.removeEventListener('resize', onResize); size(); draw(); };
  window.addEventListener('resize', onResize);
  document.fonts?.ready.then(() => document.body.contains(canvas) && draw());
  size();
  draw();
}
