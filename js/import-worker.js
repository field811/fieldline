// Streams an Apple Health export (export.zip or export.xml) and turns it into
// small per-day summaries. Runs in a Web Worker so the page stays responsive,
// and never holds the whole file in memory (exports are often 1GB+).
import { Unzip, UnzipInflate } from 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js';

const HK = 'HKQuantityTypeIdentifier';
const WANT = {
  [HK + 'HeartRate']: 'hr',
  [HK + 'RestingHeartRate']: 'rhr',
  [HK + 'HeartRateVariabilitySDNN']: 'hrv',
  [HK + 'RespiratoryRate']: 'resp',
  [HK + 'OxygenSaturation']: 'spo2',
  [HK + 'StepCount']: 'steps',
  [HK + 'ActiveEnergyBurned']: 'kcal',
  HKCategoryTypeIdentifierSleepAnalysis: 'sleep',
};

let cutoffKey = '0000-00-00';
const days = new Map();        // date -> accumulator
const hrByDay = new Map();     // date -> [t, bpm, t, bpm, ...]
const sleepRecs = [];          // {src, start, end, stage}
const workouts = [];
let records = 0;

function day(key) {
  let d = days.get(key);
  if (!d) {
    d = { rhr: [], hrv: [], resp: [], spo2: [], steps: {}, kcal: {} };
    days.set(key, d);
  }
  return d;
}

// "2024-03-01 07:12:44 +1100" -> epoch ms (keeps the offset it was recorded in)
function toMs(s) {
  return Date.parse(s.slice(0, 10) + 'T' + s.slice(11, 19) + s.slice(20, 23) + ':' + s.slice(23, 25));
}

function attr(tag, name) {
  const i = tag.indexOf(' ' + name + '="');
  if (i < 0) return null;
  const s = i + name.length + 3;
  return tag.slice(s, tag.indexOf('"', s));
}

function decodeEntities(s) {
  return s.indexOf('&') < 0 ? s : s.replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

const SLEEP_STAGE = {
  HKCategoryValueSleepAnalysisInBed: 'inBed',
  HKCategoryValueSleepAnalysisAwake: 'awake',
  HKCategoryValueSleepAnalysisAsleepCore: 'core',
  HKCategoryValueSleepAnalysisAsleepDeep: 'deep',
  HKCategoryValueSleepAnalysisAsleepREM: 'rem',
  HKCategoryValueSleepAnalysisAsleepUnspecified: 'asleep',
  HKCategoryValueSleepAnalysisAsleep: 'asleep',
};

function handleRecord(tag) {
  const type = attr(tag, 'type');
  const kind = WANT[type];
  if (!kind) return;
  const start = attr(tag, 'startDate');
  if (!start) return;
  const key = start.slice(0, 10);
  if (kind !== 'sleep' && key < cutoffKey) return;
  records++;
  const v = parseFloat(attr(tag, 'value'));
  switch (kind) {
    case 'hr': {
      let a = hrByDay.get(key);
      if (!a) hrByDay.set(key, (a = []));
      a.push(toMs(start), v);
      break;
    }
    case 'rhr': case 'hrv': case 'resp':
      day(key)[kind].push(v);
      break;
    case 'spo2':
      day(key).spo2.push(v <= 1 ? v * 100 : v);
      break;
    case 'steps': case 'kcal': {
      const src = decodeEntities(attr(tag, 'sourceName') || '?');
      const bucket = day(key)[kind];
      bucket[src] = (bucket[src] || 0) + v;
      break;
    }
    case 'sleep': {
      const end = attr(tag, 'endDate');
      if (end.slice(0, 10) < cutoffKey) return;
      sleepRecs.push({
        src: decodeEntities(attr(tag, 'sourceName') || '?'),
        start: toMs(start),
        end: toMs(end),
        startStr: start,
        stage: SLEEP_STAGE[attr(tag, 'value')] || 'asleep',
      });
      break;
    }
  }
}

function handleWorkout(tag) {
  const start = attr(tag, 'startDate');
  if (!start || start.slice(0, 10) < cutoffKey) return;
  const dur = parseFloat(attr(tag, 'duration')) || 0;
  const unit = attr(tag, 'durationUnit') || 'min';
  const kcal = parseFloat(attr(tag, 'totalEnergyBurned')) || null;
  workouts.push({
    date: start.slice(0, 10),
    type: (attr(tag, 'workoutActivityType') || 'Workout').replace('HKWorkoutActivityType', '').replace(/([a-z])([A-Z])/g, '$1 $2'),
    min: Math.round(unit === 'min' ? dur : unit === 's' ? dur / 60 : dur * 60),
    kcal: kcal && Math.round(kcal),
    start: toMs(start),
    end: toMs(attr(tag, 'endDate')),
  });
}

// ---- streaming XML scan -------------------------------------------------
const decoder = new TextDecoder();
let tail = '';
const TAG = /<(Record|Workout) ([^>]*)>/g;

function scanText(text, final) {
  text = tail + text;
  const cut = final ? text.length : text.lastIndexOf('<');
  const body = cut < 0 ? text : text.slice(0, cut);
  tail = cut < 0 ? '' : text.slice(cut);
  TAG.lastIndex = 0;
  let m;
  while ((m = TAG.exec(body))) {
    const t = ' ' + m[2];
    if (m[1] === 'Record') handleRecord(t); else handleWorkout(t);
  }
}

function onXmlChunk(bytes, final) {
  scanText(decoder.decode(bytes, { stream: !final }), final);
}

// ---- summarising ----------------------------------------------------------
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const maxSource = (o) => { const v = Object.values(o); return v.length ? Math.max(...v) : null; };
const dateKeyOf = (ms, offsetStr) => {
  // Shift by the record's own UTC offset so the key matches the user's local day.
  const sign = offsetStr[0] === '-' ? -1 : 1;
  const off = sign * (parseInt(offsetStr.slice(1, 3)) * 60 + parseInt(offsetStr.slice(3, 5))) * 60000;
  return new Date(ms + off).toISOString().slice(0, 10);
};

function summariseSleep() {
  // A night belongs to the day you wake up: key = local date of (start + 12h).
  const nights = new Map();
  for (const r of sleepRecs) {
    const key = dateKeyOf(r.start + 12 * 3600e3, r.startStr.slice(20));
    if (key < cutoffKey) continue;
    let n = nights.get(key);
    if (!n) nights.set(key, (n = {}));
    (n[r.src] ||= []).push(r);
  }
  const out = new Map();
  for (const [key, bySrc] of nights) {
    let best = null;
    for (const recs of Object.values(bySrc)) {
      const s = { start: Infinity, end: 0, asleep: 0, core: 0, deep: 0, rem: 0, awake: 0, inBed: 0, staged: false };
      for (const r of recs) {
        const min = (r.end - r.start) / 60000;
        if (r.stage === 'inBed') { s.inBed += min; continue; }
        s.start = Math.min(s.start, r.start);
        s.end = Math.max(s.end, r.end);
        if (r.stage === 'awake') s.awake += min;
        else {
          s.asleep += min;
          if (r.stage !== 'asleep') { s[r.stage] += min; s.staged = true; }
        }
      }
      if (s.asleep > 0 && (!best || s.asleep > best.asleep)) best = s;
    }
    if (best && best.asleep >= 30) {
      for (const k of ['asleep', 'core', 'deep', 'rem', 'awake', 'inBed']) best[k] = Math.round(best[k]);
      out.set(key, best);
    }
  }
  return out;
}

function summariseHr(samples, rhr, maxHr) {
  const pairs = [];
  for (let i = 0; i < samples.length; i += 2) pairs.push([samples[i], samples[i + 1]]);
  pairs.sort((a, b) => a[0] - b[0]);
  const zones = [0, 0, 0, 0, 0];
  let trimp = 0, peak = 0, sum = 0;
  for (let i = 0; i < pairs.length; i++) {
    const [t, bpm] = pairs[i];
    peak = Math.max(peak, bpm);
    sum += bpm;
    if (i === pairs.length - 1) break;
    const dt = Math.min((pairs[i + 1][0] - t) / 60000, 10); // cap gaps at 10 min
    const hr = (bpm + pairs[i + 1][1]) / 2;
    const pct = hr / maxHr;
    if (pct >= 0.5) zones[Math.min(4, Math.floor((pct - 0.5) * 10))] += dt;
    const hrr = (hr - rhr) / (maxHr - rhr);
    if (hrr >= 0.3) trimp += dt * hrr * 0.64 * Math.exp(1.92 * Math.min(hrr, 1));
  }
  return {
    trimp: Math.round(trimp * 10) / 10,
    maxHr: Math.round(peak),
    avgHr: pairs.length ? Math.round(sum / pairs.length) : null,
    zones: zones.map(Math.round),
  };
}

function finish(maxHrSetting) {
  const sleep = summariseSleep();
  const keys = new Set([...days.keys(), ...hrByDay.keys(), ...sleep.keys()]);
  const result = {};
  for (const key of [...keys].sort()) {
    if (key < cutoffKey) continue;
    const d = days.get(key) || { rhr: [], hrv: [], resp: [], spo2: [], steps: {}, kcal: {} };
    const rhr = d.rhr.length ? d.rhr[d.rhr.length - 1] : null;
    const out = {
      date: key,
      rhr: rhr && Math.round(rhr),
      hrv: d.hrv.length ? Math.round(mean(d.hrv) * 10) / 10 : null,
      resp: d.resp.length ? Math.round(mean(d.resp) * 10) / 10 : null,
      spo2: d.spo2.length ? Math.round(mean(d.spo2) * 10) / 10 : null,
      steps: maxSource(d.steps) && Math.round(maxSource(d.steps)),
      kcal: maxSource(d.kcal) && Math.round(maxSource(d.kcal)),
      sleep: sleep.get(key) || null,
      workouts: workouts.filter((w) => w.date === key).map(({ date, ...w }) => w),
    };
    const hr = hrByDay.get(key);
    if (hr && hr.length > 4) Object.assign(out, summariseHr(hr, rhr || 60, maxHrSetting));
    result[key] = out;
  }
  return result;
}

// ---- entry point ------------------------------------------------------------
self.onmessage = async (e) => {
  const { file, daysBack, maxHr } = e.data;
  cutoffKey = new Date(Date.now() - daysBack * 864e5).toISOString().slice(0, 10);
  try {
    const isZip = /\.zip$/i.test(file.name);
    let found = !isZip;
    let unzip;
    if (isZip) {
      unzip = new Unzip((entry) => {
        if (/(^|\/)export\.xml$/.test(entry.name)) {
          found = true;
          entry.ondata = (err, chunk, final) => {
            if (err) throw err;
            onXmlChunk(chunk, final);
          };
          entry.start();
        }
      });
      unzip.register(UnzipInflate);
    }
    const reader = file.stream().getReader();
    let read = 0, lastPost = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      read += value.length;
      if (isZip) unzip.push(value, false); else onXmlChunk(value, false);
      if (read - lastPost > 4e6) {
        lastPost = read;
        self.postMessage({ progress: read / file.size, records });
      }
    }
    if (isZip) unzip.push(new Uint8Array(0), true); else onXmlChunk(new Uint8Array(0), true);
    if (!found) throw new Error('No export.xml inside that zip. Choose the export.zip made by the Health app.');
    self.postMessage({ progress: 1, records, status: 'Working out scores…' });
    self.postMessage({ done: true, days: finish(maxHr), records });
  } catch (err) {
    self.postMessage({ error: err.message || String(err) });
  }
};
