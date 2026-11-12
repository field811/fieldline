// Made-up but realistic data so the app can be tried before importing anything.
export function demoDays(count = 90) {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const noise = (sd) => (rand() + rand() + rand() - 1.5) * sd * 1.4;
  const days = {};
  let prevTrimp = 40, prevSleep = 450;
  const sports = ['Running', 'Cycling', 'Functional Strength Training', 'Swimming', 'High Intensity Interval Training'];
  for (let i = count - 1; i >= 0; i--) {
    const date = new Date(Date.now() - i * 864e5);
    const key = date.toISOString().slice(0, 10);
    const dow = date.getDay();
    const training = dow !== 0 && rand() > 0.25;
    const trimp = training ? 60 + rand() * 150 : 5 + rand() * 25;
    const asleep = Math.round(clamp(440 + noise(45) - (dow === 6 ? 40 : 0), 300, 560));
    const fatigue = (prevTrimp - 90) / 60 + (440 - prevSleep) / 60;
    const hrv = Math.round((58 - fatigue * 5 + noise(5)) * 10) / 10;
    const rhr = Math.round(54 + fatigue * 1.6 + noise(1.5));
    const wake = new Date(key + 'T06:' + String(Math.floor(rand() * 50) + 10).padStart(2, '0') + ':00').getTime();
    const deep = Math.round(asleep * (0.14 + rand() * 0.06));
    const rem = Math.round(asleep * (0.2 + rand() * 0.06));
    const awake = Math.round(15 + rand() * 30);
    const workouts = [];
    if (training) {
      const min = Math.round(30 + rand() * 60);
      workouts.push({ type: sports[Math.floor(rand() * sports.length)], min, kcal: Math.round(min * (7 + rand() * 5)), start: wake + 10 * 3600e3, end: wake + 10 * 3600e3 + min * 6e4 });
    }
    const z = training ? [40, 25, 20, 12, 4].map((m) => Math.round(m * (0.6 + rand() * 0.8))) : [25, 6, 0, 0, 0].map((m) => Math.round(m * rand()));
    days[key] = {
      date: key,
      rhr, hrv,
      resp: Math.round((14.5 + noise(0.4)) * 10) / 10,
      spo2: Math.round((96.5 + noise(0.8)) * 10) / 10,
      steps: Math.round(6000 + rand() * 8000 + (training ? 3000 : 0)),
      kcal: Math.round(400 + trimp * 3 + rand() * 200),
      trimp: Math.round(trimp * 10) / 10,
      maxHr: Math.round(training ? 160 + rand() * 25 : 110 + rand() * 20),
      avgHr: Math.round(68 + rand() * 10),
      zones: z,
      sleep: {
        start: wake - (asleep + awake) * 6e4, end: wake,
        asleep, deep, rem, core: asleep - deep - rem, awake, inBed: asleep + awake + 10, staged: true,
      },
      workouts,
    };
    prevTrimp = trimp; prevSleep = asleep;
  }
  return days;
}

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
