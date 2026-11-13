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
      // time, bpm, and minute of the local day (for the 5-minute heart rate chart)
      a.push(toMs(start), v, +start.slice(11, 13) * 60 + +start.slice(14, 16));
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
    for (const all of Object.values(bySrc)) {
      // If this source has stages, drop plain "asleep" records that overlap them
      // (happens when the Shortcut mixes iPhone and Watch sleep under one source).
      const hasStages = all.some((r) => r.stage === 'core' || r.stage === 'deep' || r.stage === 'rem');
      const recs = hasStages ? all.filter((r) => r.stage !== 'asleep') : all;
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
      if (s.asleep > 0 && (!best || s.asleep > best.asleep)) { best = s; best.recs = recs; }
    }
    if (best && best.asleep >= 30) {
      best.segs = sleepSegments(best.recs, best.start);
      delete best.recs;
      for (const k of ['asleep', 'core', 'deep', 'rem', 'awake', 'inBed']) best[k] = Math.round(best[k]);
      out.set(key, best);
    }
  }
  return out;
}

// The night's stages as [startMin, endMin, code] from bedtime, merged where
// the same stage continues. Codes: d deep, c core, r REM, w awake, s asleep.
const STAGE_CODE = { deep: 'd', core: 'c', rem: 'r', awake: 'w', asleep: 's' };
function sleepSegments(recs, start) {
  const segs = [];
  for (const r of recs.filter((x) => x.stage !== 'inBed').sort((a, b) => a.start - b.start)) {
    const seg = [Math.round((r.start - start) / 6e4), Math.round((r.end - start) / 6e4), STAGE_CODE[r.stage]];
    const last = segs[segs.length - 1];
    if (last && last[2] === seg[2] && seg[0] <= last[1] + 1) last[1] = Math.max(last[1], seg[1]);
    else if (seg[1] > seg[0]) segs.push(seg);
  }
  return segs;
}

function summariseHr(samples, rhr, maxHr) {
  const pairs = [];
  const sum5 = new Array(288).fill(0), n5 = new Array(288).fill(0);
  for (let i = 0; i < samples.length; i += 3) {
    pairs.push([samples[i], samples[i + 1]]);
    const b = Math.floor(samples[i + 2] / 5);
    sum5[b] += samples[i + 1]; n5[b]++;
  }
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
    hrBins: sum5.map((s, i) => (n5[i] ? Math.round(s / n5[i]) : 0)), // 288 five-minute averages, 0 = no reading
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
    if (hr && hr.length > 6) Object.assign(out, summariseHr(hr, rhr || 60, maxHrSetting));
    result[key] = out;
  }
  return result;
}

// ---- daily Shortcut file ---------------------------------------------------------
// The "Field Line Sync" Shortcut writes a small text file:
//   FIELDLINE1
//   #hr.date      ← one ISO date per line
//   #hr.value     ← matching values, same order
//   #sleep.date / #sleep.end / #sleep.value / #sleep.source ...
const SYNC_TYPES = {
  hr: HK + 'HeartRate', hrv: HK + 'HeartRateVariabilitySDNN', rhr: HK + 'RestingHeartRate',
  resp: HK + 'RespiratoryRate', spo2: HK + 'OxygenSaturation', steps: HK + 'StepCount',
  kcal: HK + 'ActiveEnergyBurned', sleep: 'HKCategoryTypeIdentifierSleepAnalysis',
};

// Any date the Shortcut gives us → "2026-11-14 07:12:44 +1100" in this phone's time zone.
function toAppleDate(s) {
  const ms = Date.parse(s);
  if (isNaN(ms)) return null;
  const d = new Date(ms), p = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${off >= 0 ? '+' : '-'}${p(Math.floor(Math.abs(off) / 60))}${p(Math.abs(off) % 60)}`;
}

function sleepValue(v) {
  v = v.toLowerCase();
  if (v.includes('deep')) return 'HKCategoryValueSleepAnalysisAsleepDeep';
  if (v.includes('rem')) return 'HKCategoryValueSleepAnalysisAsleepREM';
  if (v.includes('core')) return 'HKCategoryValueSleepAnalysisAsleepCore';
  if (v.includes('awake')) return 'HKCategoryValueSleepAnalysisAwake';
  if (v.includes('bed')) return 'HKCategoryValueSleepAnalysisInBed';
  return 'HKCategoryValueSleepAnalysisAsleepUnspecified';
}

function number(v) {
  v = String(v || '').trim();
  if (/^\d{1,3}(,\d{3})+(\.\d+)?/.test(v)) v = v.replace(/,/g, ''); // 1,234
  else v = v.replace(',', '.');                                     // 0,97
  return parseFloat(v);
}

function readSync(text) {
  if (!/^\s*FIELDLINE1/.test(text)) throw new Error("That isn't a Field Line Sync file. Run the Field Line Sync shortcut first.");
  const cols = {};
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('#')) { cur = t.slice(1).toLowerCase(); cols[cur] = []; }
    else if (cur && t) cols[cur].push(t);
  }
  let bad = 0, read = 0;
  const clean = (s) => String(s || 'Shortcut').replace(/"/g, '');
  for (const [k, type] of Object.entries(SYNC_TYPES)) {
    const dates = cols[k + '.date'] || [], ends = cols[k + '.end'] || [], vals = cols[k + '.value'] || [], srcs = cols[k + '.source'] || [];
    for (let i = 0; i < dates.length; i++) {
      const s = toAppleDate(dates[i]);
      if (!s) { bad++; continue; }
      const e = (ends[i] && toAppleDate(ends[i])) || s;
      const v = k === 'sleep' ? sleepValue(vals[i] || '') : String(number(vals[i]));
      if (k !== 'sleep' && v === 'NaN') { bad++; continue; }
      handleRecord(` type="${type}" sourceName="${clean(srcs[i])}" startDate="${s}" endDate="${e}" value="${v}"`);
      read++;
    }
  }
  if (!read && bad) throw new Error("Couldn't read the dates in the Sync file. In the Shortcut's Text action, set each date's Date Format to ISO 8601 with time.");
  return bad;
}

// ---- entry point ------------------------------------------------------------
self.onmessage = async (e) => {
  const { file, daysBack, maxHr, syncText } = e.data;
  cutoffKey = new Date(Date.now() - daysBack * 864e5).toISOString().slice(0, 10);
  if (syncText != null) {
    try {
      const bad = readSync(syncText);
      const result = finish(maxHr);
      // The Shortcut's window starts part-way through its first day, so that day is incomplete. Skip it.
      const keys = Object.keys(result).sort();
      if (keys.length > 1) delete result[keys[0]];
      self.postMessage({ done: true, days: result, records, bad });
    } catch (err) {
      self.postMessage({ error: err.message || String(err) });
    }
    return;
  }
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
