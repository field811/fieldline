// Charts and findings that connect strain, sleep and recovery.
import { recoveryColor } from './scoring.js';

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const hrs = (min) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, '0')}m`;

// Each day's strain, paired with the sleep that followed it and the recovery the next morning.
// (Sleep and recovery are stored on the day you wake up, so they come from the next day.)
export function pairs(scored) {
  const out = [];
  for (let i = 0; i < scored.length; i++) {
    const day = scored[i], next = scored[i + 1];
    out.push({
      date: day.date,
      strain: day.strain,
      sleepAfter: next?.sleep ? next.sleep.asleep : null,
      needAfter: next?.sleepNeed ?? null,
      recoveryAfter: next?.recovery ?? null,
      bedtime: next?.sleep ? next.sleep.start : null,
    });
  }
  return out;
}

/** Strain bars, the sleep that followed as a line, and next morning's recovery as coloured dots. */
export function strainSleepChart(scored, range) {
  const p = pairs(scored).slice(-range);
  const W = 320, H = 190, L = 22, R = 26, top = 8, plotB = 140;
  const n = p.length || 1, slot = (W - L - R) / n, bw = Math.max(2, slot * 0.62);
  const x = (i) => L + i * slot + (slot - bw) / 2;
  const yS = (v) => plotB - (Math.min(v, 21) / 21) * (plotB - top);
  const yH = (h) => plotB - (Math.min(h, 10) / 10) * (plotB - top);
  const showEvery = Math.ceil(n / 10);
  const linePts = p.map((d, i) => (d.sleepAfter != null ? `${x(i) + bw / 2},${yH(d.sleepAfter / 60)}` : null));
  // break the line where a night is missing
  const segs = [];
  let cur = [];
  linePts.forEach((pt) => { if (pt) cur.push(pt); else { if (cur.length) segs.push(cur); cur = []; } });
  if (cur.length) segs.push(cur);
  const dotR = Math.min(4, slot * 0.32);

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Strain each day with the sleep and recovery that followed">
    ${[0, 7, 14, 21].map((v) => `<line x1="${L}" x2="${W - R}" y1="${yS(v)}" y2="${yS(v)}" stroke="var(--line)"/>
      <text class="axis" x="${L - 4}" y="${yS(v) + 3}" text-anchor="end">${v}</text>`).join('')}
    ${[0, 4, 8].map((h) => `<text class="axis" x="${W - R + 4}" y="${yH(h) + 3}" style="fill:var(--sleep)">${h}h</text>`).join('')}
    ${p.map((d, i) => (d.strain != null ? `<rect x="${x(i)}" y="${yS(d.strain)}" width="${bw}" height="${plotB - yS(d.strain)}" rx="${Math.min(3, bw / 2)}" fill="var(--strain)" opacity=".75"><title>${d.date}: strain ${d.strain.toFixed(1)}${d.sleepAfter != null ? `, then slept ${hrs(d.sleepAfter)}` : ''}${d.recoveryAfter != null ? `, recovery ${d.recoveryAfter}%` : ''}</title></rect>` : '')).join('')}
    ${segs.map((s) => `<polyline points="${s.join(' ')}" fill="none" stroke="var(--sleep)" stroke-width="2" stroke-linejoin="round"/>`).join('')}
    ${linePts.map((pt) => (pt ? `<circle cx="${pt.split(',')[0]}" cy="${pt.split(',')[1]}" r="${Math.min(2.5, dotR)}" fill="var(--sleep)"/>` : '')).join('')}
    <text class="axis" x="${L}" y="${plotB + 18}">Next-day recovery</text>
    ${p.map((d, i) => (d.recoveryAfter != null ? `<circle cx="${x(i) + bw / 2}" cy="${plotB + 30}" r="${dotR}" fill="${recoveryColor(d.recoveryAfter)}"/>` : '')).join('')}
    ${p.map((d, i) => (i % showEvery === 0 ? `<text class="axis" x="${x(i) + bw / 2}" y="${H - 3}" text-anchor="middle">${d.date.slice(8)}</text>` : '')).join('')}
  </svg>
  <div class="legend">
    <span><i style="background:var(--strain)"></i>Strain that day (left)</span>
    <span><i style="background:var(--sleep)"></i>Sleep that night (right)</span>
    <span><i style="background:var(--green);border-radius:50%"></i>Recovery next morning</span>
  </div>`;
}

/** Each night as a dot: hours slept across, next-morning recovery up, with a trend line. */
export function sleepRecoveryScatter(scored) {
  const pts = scored.filter((d) => d.sleep && d.recovery != null).map((d) => [d.sleep.asleep / 60, d.recovery, d.date]);
  if (pts.length < 5) return '<p>Needs at least 5 nights with a recovery score.</p>';
  const W = 320, H = 180, L = 30, R = 8, top = 8, B = 22;
  const lo = Math.floor(Math.min(...pts.map((p) => p[0]))), hi = Math.ceil(Math.max(...pts.map((p) => p[0])));
  const x = (h) => L + ((h - lo) / (hi - lo || 1)) * (W - L - R);
  const y = (r) => H - B - (r / 100) * (H - B - top);
  // least-squares trend line
  const mx = mean(pts.map((p) => p[0])), my = mean(pts.map((p) => p[1]));
  const sxx = pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0) || 1;
  const slope = pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / sxx;
  const at = (h) => Math.max(0, Math.min(100, my + slope * (h - mx)));
  const ticks = [];
  for (let h = lo; h <= hi; h++) ticks.push(h);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Hours slept against next-morning recovery">
    ${[0, 33, 67, 100].map((r) => `<line x1="${L}" x2="${W - R}" y1="${y(r)}" y2="${y(r)}" stroke="var(--line)"/><text class="axis" x="${L - 4}" y="${y(r) + 3}" text-anchor="end">${r}%</text>`).join('')}
    ${ticks.map((h) => `<text class="axis" x="${x(h)}" y="${H - 6}" text-anchor="middle">${h}h</text>`).join('')}
    ${pts.map(([h, r, d]) => `<circle cx="${x(h)}" cy="${y(r)}" r="4" fill="${recoveryColor(r)}" opacity=".85"><title>${d}: ${h.toFixed(1)}h sleep, ${r}% recovery</title></circle>`).join('')}
    <line x1="${x(lo)}" y1="${y(at(lo))}" x2="${x(hi)}" y2="${y(at(hi))}" stroke="var(--text)" stroke-width="1.5" stroke-dasharray="4 4" opacity=".7"/>
  </svg>
  <p class="note">Each dot is one night. The dashed line is your trend: ${slope >= 0.5 ? `each extra hour of sleep has come with about <b>${Math.round(slope)}% more recovery</b>` : slope <= -0.5 ? 'more sleep hasn\'t lifted your recovery so far' : 'sleep length and recovery haven\'t been closely linked so far'}.</p>`;
}

function corr(xs, ys) {
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; syy += (ys[i] - my) ** 2; });
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}

const linkWords = (r) => {
  const a = Math.abs(r);
  return a < 0.15 ? 'barely any' : a < 0.35 ? 'a weak' : a < 0.6 ? 'a clear' : 'a strong';
};

function clock(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Plain-English findings from your own history. Each only shows when there's enough data. */
export function insights(scored) {
  const all = pairs(scored).slice(-90);
  const out = [];
  const MIN = 3;

  // 1. Hard days vs easy days → that night's sleep and next morning's recovery
  const hard = all.filter((d) => d.strain >= 14), easy = all.filter((d) => d.strain != null && d.strain < 10);
  const hR = hard.filter((d) => d.recoveryAfter != null), eR = easy.filter((d) => d.recoveryAfter != null);
  if (hR.length >= MIN && eR.length >= MIN) {
    const a = Math.round(mean(hR.map((d) => d.recoveryAfter))), b = Math.round(mean(eR.map((d) => d.recoveryAfter)));
    out.push({ big: `${a}%`, color: recoveryColor(a), text: `average recovery the morning after a hard day (strain 14+), compared with <b>${b}%</b> after an easy day (under 10).` });
  }
  const hS = hard.filter((d) => d.sleepAfter != null), eS = easy.filter((d) => d.sleepAfter != null);
  if (hS.length >= MIN && eS.length >= MIN) {
    const diff = mean(hS.map((d) => d.sleepAfter)) - mean(eS.map((d) => d.sleepAfter));
    out.push({ big: `${diff >= 0 ? '+' : '–'}${Math.round(Math.abs(diff))}m`, color: 'var(--sleep)', text: `sleep after hard days compared with easy days. ${diff < 10 ? 'Your body needs more after a big day, so try to get to bed earlier on those nights.' : 'Good, you\'re sleeping longer when you\'ve worked harder.'}` });
  }

  // 2. Long vs short sleep → recovery
  const withRec = all.filter((d) => d.sleepAfter != null && d.recoveryAfter != null);
  const long = withRec.filter((d) => d.sleepAfter >= 450), short = withRec.filter((d) => d.sleepAfter < 420);
  if (long.length >= MIN && short.length >= MIN) {
    const a = Math.round(mean(long.map((d) => d.recoveryAfter))), b = Math.round(mean(short.map((d) => d.recoveryAfter)));
    out.push({ big: `${a}%`, color: recoveryColor(a), text: `average recovery after 7½ hours or more of sleep, compared with <b>${b}%</b> after less than 7 hours.` });
  }

  // 3. Bedtime → recovery
  const withBed = withRec.filter((d) => d.bedtime);
  if (withBed.length >= MIN * 2) {
    const minsAfter6pm = (ms) => { const t = new Date(ms); let m = t.getHours() * 60 + t.getMinutes() - 18 * 60; return m < 0 ? m + 1440 : m; };
    const sorted = [...withBed].sort((a, b) => minsAfter6pm(a.bedtime) - minsAfter6pm(b.bedtime));
    const mid = sorted[Math.floor(sorted.length / 2)];
    const early = sorted.slice(0, Math.floor(sorted.length / 2)), late = sorted.slice(Math.floor(sorted.length / 2));
    const a = Math.round(mean(early.map((d) => d.recoveryAfter))), b = Math.round(mean(late.map((d) => d.recoveryAfter)));
    out.push({ big: `${a}%`, color: recoveryColor(a), text: `average recovery when you're asleep before <b>${clock(mid.bedtime)}</b>, compared with <b>${b}%</b> when it's later.` });
  }

  // 4. How strongly strain and sleep move together
  const both = all.filter((d) => d.strain != null && d.sleepAfter != null);
  if (both.length >= 10) {
    const r = corr(both.map((d) => d.strain), both.map((d) => d.sleepAfter));
    out.push({ big: r.toFixed(2), color: 'var(--strain)', text: `There's ${linkWords(r)} link between how hard you go and how long you sleep that night${Math.abs(r) >= 0.15 ? (r > 0 ? ': harder days, longer sleep.' : ': harder days, <i>shorter</i> sleep.') : '.'} (1.00 would be a perfect match.)` });
  }

  // 5. Sleep debt over the last week
  const week = scored.slice(-7).filter((d) => d.sleep && d.sleepNeed);
  if (week.length >= 4) {
    const debt = week.reduce((s, d) => s + (d.sleepNeed - d.sleep.asleep), 0);
    out.push({ big: debt > 0 ? hrs(debt) : 'None', color: debt > 120 ? 'var(--red)' : debt > 0 ? 'var(--yellow)' : 'var(--green)', text: debt > 0 ? `short of the sleep you needed over the last ${week.length} nights. An earlier night or two will help pay it back.` : `sleep debt over the last ${week.length} nights. You've been getting what you need.` });
  }

  // 6. Best day of the week for recovery
  const byDow = Array.from({ length: 7 }, () => []);
  scored.slice(-90).forEach((d) => { if (d.recovery != null) byDow[new Date(d.date + 'T12:00:00').getDay()].push(d.recovery); });
  if (byDow.every((a) => a.length >= 2)) {
    const avgs = byDow.map(mean);
    const best = avgs.indexOf(Math.max(...avgs)), worst = avgs.indexOf(Math.min(...avgs));
    const name = (i) => new Date(2024, 0, 7 + i).toLocaleDateString([], { weekday: 'long' });
    out.push({ big: name(best).slice(0, 3), color: 'var(--green)', text: `is usually your best-recovered day (${Math.round(avgs[best])}%). <b>${name(worst)}</b> is usually your lowest (${Math.round(avgs[worst])}%), so it's a good one for an easier session.` });
  }

  if (!out.length) return '<p>Findings appear once you have about two weeks of data.</p>';
  return `<ul class="insights">${out.map((o) => `<li><div class="ins-big" style="color:${o.color}">${o.big}</div><div>${o.text}</div></li>`).join('')}</ul>`;
}
