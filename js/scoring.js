// Recovery, strain and sleep scores, worked out from the daily summaries.
// These are our own formulas, built on published training-load science
// (Banister TRIMP for strain, personal-baseline z-scores for recovery).
// They are guides, not medical measurements.

const BASELINE_DAYS = 30;

export function strainFromTrimp(trimp) {
  if (trimp == null) return null;
  return Math.round(21 * (1 - Math.exp(-trimp / 120)) * 10) / 10;
}

function stats(values) {
  const v = values.filter((x) => x != null && isFinite(x));
  if (v.length < 4) return null;
  const m = v.reduce((s, x) => s + x, 0) / v.length;
  const sd = Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
  return { mean: m, sd: Math.max(sd, m * 0.03, 0.5), n: v.length };
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export function sleepNeed(prev, settings) {
  // Base need + extra for yesterday's strain + paying back part of last night's debt.
  let need = settings.sleepNeedHours * 60;
  const strain = prev?.strain;
  if (strain > 10) need += (strain - 10) * 3;
  if (prev?.sleep && prev.sleepNeed) {
    const debt = Math.max(0, prev.sleepNeed - prev.sleep.asleep);
    need += Math.min(debt * 0.3, 45);
  }
  return Math.round(need);
}

/**
 * Takes the stored day summaries and adds strain, sleepNeed, sleepPerf,
 * recovery and the baseline comparison for each day. Returns an array sorted
 * oldest to newest.
 */
export function score(daysObj, settings) {
  const list = Object.values(daysObj).sort((a, b) => (a.date < b.date ? -1 : 1));
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const d = { ...list[i] };
    d.strain = strainFromTrimp(d.trimp);
    const prev = out[i - 1];
    d.sleepNeed = sleepNeed(prev, settings);
    d.sleepPerf = d.sleep ? Math.min(100, Math.round((d.sleep.asleep / d.sleepNeed) * 100)) : null;

    const window = out.slice(Math.max(0, i - BASELINE_DAYS), i);
    const base = {
      hrv: stats(window.map((x) => x.hrv && Math.log(x.hrv))),
      rhr: stats(window.map((x) => x.rhr)),
      resp: stats(window.map((x) => x.resp)),
    };
    d.baseline = {
      hrv: base.hrv && Math.round(Math.exp(base.hrv.mean) * 10) / 10,
      rhr: base.rhr && Math.round(base.rhr.mean * 10) / 10,
      resp: base.resp && Math.round(base.resp.mean * 10) / 10,
    };

    const parts = [];
    if (d.hrv && base.hrv) parts.push([0.55, clamp((Math.log(d.hrv) - base.hrv.mean) / base.hrv.sd, -3, 3)]);
    if (d.rhr && base.rhr) parts.push([0.25, clamp(-(d.rhr - base.rhr.mean) / base.rhr.sd, -3, 3)]);
    if (d.sleepPerf != null) parts.push([0.2, clamp((d.sleepPerf - 85) / 15, -3, 1.5)]);
    if (d.resp && base.resp) parts.push([0.05, clamp(-(d.resp - base.resp.mean) / base.resp.sd, -3, 3)]);

    // Need HRV or resting HR against a baseline to call it a recovery score.
    if (parts.some(([w]) => w >= 0.25)) {
      const w = parts.reduce((s, [wt]) => s + wt, 0);
      const s = parts.reduce((acc, [wt, z]) => acc + wt * z, 0) / w;
      d.recovery = clamp(Math.round(100 / (1 + Math.exp(-(1.4 * s + 0.4)))), 1, 99);
    } else {
      d.recovery = null;
    }
    out.push(d);
  }
  return out;
}

export function recoveryColor(r) {
  if (r == null) return 'var(--muted)';
  if (r >= 67) return 'var(--green)';
  if (r >= 34) return 'var(--yellow)';
  return 'var(--red)';
}

export function recoveryWords(r) {
  if (r == null) return 'Not enough data yet';
  if (r >= 67) return 'Primed. A good day to push hard.';
  if (r >= 34) return 'Steady. Train, but keep something in the tank.';
  return 'Run down. Go easy and prioritise sleep.';
}

// Strain target for the day, based on how recovered you are.
export function strainTarget(r) {
  if (r == null) return null;
  if (r >= 67) return [14, 18];
  if (r >= 34) return [10, 14];
  return [5, 10];
}
