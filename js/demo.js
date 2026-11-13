// Made-up but realistic data so the app can be tried before importing anything.
export const DEMO_VERSION = 3;

export function demoDays(count = 90) {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const noise = (sd) => (rand() + rand() + rand() - 1.5) * sd * 1.4;
  const days = {};
  let prevTrimp = 40, prevSleep = 450;
  const sports = ['Running', 'Cycling', 'Functional Strength Training', 'Swimming', 'High Intensity Interval Training'];
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (let i = count - 1; i >= 0; i--) {
    const date = new Date(Date.now() - i * 864e5);
    const key = localKey(date);
    const dow = date.getDay();
    const training = dow !== 0 && rand() > 0.25;
    const trimp = training ? 60 + rand() * 150 : 5 + rand() * 25;
    const target = Math.round(clamp(440 + noise(45) - (dow === 6 ? 40 : 0), 300, 560));
    const fatigue = (prevTrimp - 90) / 60 + (440 - prevSleep) / 60;
    const hrv = Math.round((58 - fatigue * 5 + noise(5)) * 10) / 10;
    const rhr = Math.round(54 + fatigue * 1.6 + noise(1.5));
    const wakeMin = 6 * 60 + 10 + Math.floor(rand() * 50);
    const wake = new Date(key + 'T00:00:00').getTime() + wakeMin * 6e4;

    // A night of sleep cycles: core → deep → core → REM, deep early, REM later, brief wakes.
    const segs = [];
    let t = 0, asleep = 0;
    for (let cycle = 0; asleep < target; cycle++) {
      const deepMin = Math.max(0, Math.round((32 - cycle * 8) * (0.7 + rand() * 0.6)));
      const remMin = Math.round((10 + cycle * 8) * (0.7 + rand() * 0.6));
      const plan = [['c', 15 + rand() * 20], ['d', deepMin], ['c', 15 + rand() * 25], ['r', remMin]];
      if (cycle > 0 && rand() > 0.45) plan.unshift(['w', 2 + rand() * 8]);
      for (const [code, m] of plan) {
        let len = Math.round(m);
        if (len <= 0) continue;
        if (code !== 'w') len = Math.min(len, target - asleep);
        if (len <= 0) break;
        const last = segs[segs.length - 1];
        if (last && last[2] === code) last[1] += len; else segs.push([t, t + len, code]);
        t += len;
        if (code !== 'w') asleep += len;
      }
    }
    const tot = (c) => segs.filter((s) => s[2] === c).reduce((a, s) => a + s[1] - s[0], 0);
    const sleepStart = wake - t * 6e4;
    const bedMin = 22 * 60 + Math.floor(rand() * 75); // tonight's bedtime, for the HR chart

    const workouts = [];
    let wStart = null, wLen = 0;
    if (training) {
      wLen = Math.round(30 + rand() * 60);
      wStart = wakeMin + 60 + Math.floor(rand() * 10) * 60;
      const ms = new Date(key + 'T00:00:00').getTime() + wStart * 6e4;
      workouts.push({ type: sports[Math.floor(rand() * sports.length)], min: wLen, kcal: Math.round(wLen * (7 + rand() * 5)), start: ms, end: ms + wLen * 6e4 });
    }

    // 5-minute heart rate for the whole day.
    const hrBins = [];
    let drift = 0;
    for (let b = 0; b < 288; b++) {
      const m = b * 5;
      drift = drift * 0.8 + noise(4);
      let v;
      if (m < wakeMin || m >= bedMin) v = rhr - 3 + noise(2);
      else if (wStart != null && m >= wStart && m < wStart + wLen) {
        const p = (m - wStart) / wLen;
        v = 120 + 45 * Math.sin(Math.PI * Math.min(1, p * 1.3)) + noise(5);
      } else v = rhr + 18 + drift + (m > 12 * 60 && m < 13 * 60 ? 10 : 0);
      if (i === 0 && m > nowMin) v = 0; // no future readings today
      hrBins.push(v ? Math.round(v) : 0);
    }
    const seen = hrBins.filter(Boolean);

    const z = training ? [40, 25, 20, 12, 4].map((m) => Math.round(m * (0.6 + rand() * 0.8))) : [25, 6, 0, 0, 0].map((m) => Math.round(m * rand()));
    days[key] = {
      date: key,
      rhr, hrv,
      resp: Math.round((14.5 + noise(0.4)) * 10) / 10,
      spo2: Math.round((96.5 + noise(0.8)) * 10) / 10,
      steps: Math.round(6000 + rand() * 8000 + (training ? 3000 : 0)),
      kcal: Math.round(400 + trimp * 3 + rand() * 200),
      trimp: Math.round(trimp * 10) / 10,
      maxHr: Math.max(...seen),
      avgHr: Math.round(seen.reduce((a, b) => a + b, 0) / seen.length),
      zones: z,
      hrBins,
      sleep: {
        start: sleepStart, end: wake,
        asleep, deep: tot('d'), rem: tot('r'), core: tot('c'), awake: tot('w'), inBed: t + 10, staged: true, segs,
      },
      workouts,
    };
    prevTrimp = trimp; prevSleep = asleep;
  }
  return days;
}

function localKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
