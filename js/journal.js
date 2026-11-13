// Morning check-in: a few yes/no questions about yesterday, then over time
// we show how each habit lines up with your recovery.

export const BUILT_IN = [
  { id: 'alcohol', q: 'Did you drink alcohol?', short: 'Alcohol' },
  { id: 'caffeine', q: 'Did you have caffeine?', short: 'Caffeine' },
  { id: 'lateMeal', q: 'Did you eat a late meal?', short: 'Late meal' },
  { id: 'anxiety', q: 'Did you experience anxiety?', short: 'Anxiety' },
  { id: 'journaled', q: 'Did you journal your thoughts?', short: 'Journaling' },
  { id: 'wfh', q: 'Did you work from home?', short: 'Worked from home' },
  { id: 'sex', q: 'Did you have sex?', short: 'Sex' },
  { id: 'unwell', q: 'Did you feel unwell, such as having a headache or fever?', short: 'Unwell' },
  { id: 'therapy', q: 'Did you have an ice bath, massage or acupuncture?', short: 'Ice bath / massage' },
  { id: 'supplements', q: 'Did you take supplements, such as melatonin or turmeric?', short: 'Supplements' },
  { id: 'blueLight', q: 'Did you wear blue-light-blocking glasses?', short: 'Blue-light glasses' },
  { id: 'sleepAid', q: 'Did you use a sleep mask or sound machine?', short: 'Mask / sound machine' },
  // extras you can switch on in Settings
  { id: 'lateCaffeine', q: 'Did you have caffeine after 2 pm?', short: 'Late caffeine' },
  { id: 'screens', q: 'Did you use your phone in bed?', short: 'Phone in bed' },
  { id: 'stress', q: 'Did you feel stressed?', short: 'Stress' },
  { id: 'hydrated', q: 'Did you drink plenty of water?', short: 'Well hydrated' },
  { id: 'stretch', q: 'Did you stretch or do mobility work?', short: 'Stretching' },
  { id: 'sore', q: 'Did you feel sore?', short: 'Sore' },
  { id: 'outside', q: 'Did you get outside in daylight?', short: 'Daylight' },
  { id: 'sauna', q: 'Did you have a sauna?', short: 'Sauna' },
  { id: 'nap', q: 'Did you have a nap?', short: 'Nap' },
  { id: 'magnesium', q: 'Did you take magnesium?', short: 'Magnesium' },
];
export const DEFAULT_ON = ['alcohol', 'caffeine', 'lateMeal', 'anxiety', 'journaled', 'wfh', 'sex', 'unwell', 'therapy', 'supplements', 'blueLight', 'sleepAid'];
// Bump when the default question list changes, so saved settings pick up the new list once.
export const QUESTIONS_VERSION = 2;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const FEEL = ['Awful', 'Rough', 'OK', 'Good', 'Great'];

export function allQuestions(settings) {
  return [...BUILT_IN, ...(settings.custom || [])];
}

export function activeQuestions(settings) {
  const on = settings.questions || DEFAULT_ON;
  return allQuestions(settings).filter((q) => on.includes(q.id));
}

/** The full question card. `draft` is the in-progress answers. */
export function checkinCard(date, draft, questions, isToday) {
  const yn = (id) => `<div class="yn" data-q="${id}">
      <button data-ans="${id}" data-v="1" class="${draft.a[id] === true ? 'on yes' : ''}">Yes</button>
      <button data-ans="${id}" data-v="0" class="${draft.a[id] === false ? 'on no' : ''}">No</button>
    </div>`;
  return `<section class="card journal">
    <h2>${isToday ? 'Good morning' : 'Check-in'}</h2>
    <p class="headline">${isToday ? 'A few quick questions about yesterday.' : 'About the day before.'}</p>
    <div class="jq feelrow"><span>How do you feel this morning?</span>
      <div class="feel">${FEEL.map((f, i) => `<button data-feel="${i + 1}" class="${draft.feel === i + 1 ? 'on' : ''}">${f}</button>`).join('')}</div>
    </div>
    ${questions.map((q) => `<div class="jq"><span>${esc(q.q)}</span>${yn(q.id)}</div>`).join('')}
    <button class="btn" id="jSave" data-date="${date}" style="margin-top:14px">Save check-in</button>
    <p class="note" style="margin-top:8px;text-align:center">Skip any you don't want to answer. Change the questions in Settings.</p>
  </section>`;
}

/** One-line summary once you've answered. */
export function checkinSummary(date, entry, settings) {
  const qs = allQuestions(settings);
  const yes = Object.entries(entry.a).filter(([, v]) => v).map(([id]) => qs.find((q) => q.id === id)?.short).filter(Boolean);
  return `<section class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      <h2 style="margin:0">Check-in</h2>
      <button class="link" data-jedit="${date}">Edit</button>
    </div>
    <p>${entry.feel ? `Felt <b>${FEEL[entry.feel - 1].toLowerCase()}</b>. ` : ''}${yes.length ? `Yes to: ${yes.map(esc).join(', ')}.` : 'No to everything.'}</p>
  </section>`;
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

/** How recovery differs on mornings after "yes" compared with "no", for each question. */
export function habitImpact(scored, journal, settings) {
  const recByDate = new Map(scored.filter((d) => d.recovery != null).map((d) => [d.date, d.recovery]));
  const rows = [];
  for (const q of allQuestions(settings)) {
    const yes = [], no = [];
    for (const [date, e] of Object.entries(journal)) {
      const r = recByDate.get(date);
      if (r == null || e.a[q.id] == null) continue;
      (e.a[q.id] ? yes : no).push(r);
    }
    if (yes.length >= 3 && no.length >= 3) rows.push({ q, diff: Math.round(mean(yes) - mean(no)), yes: yes.length, no: no.length, yesAvg: Math.round(mean(yes)) });
  }
  // Feeling vs recovery
  const feelPairs = Object.entries(journal).filter(([d, e]) => e.feel && recByDate.has(d)).map(([d, e]) => [e.feel, recByDate.get(d)]);

  if (!rows.length) {
    return '<p>Answer the morning check-in for a couple of weeks and you\'ll see how each habit lines up with your recovery here.</p>';
  }
  rows.sort((a, b) => b.diff - a.diff);
  const max = Math.max(10, ...rows.map((r) => Math.abs(r.diff)));
  let feelNote = '';
  if (feelPairs.length >= 7) {
    const good = feelPairs.filter(([f]) => f >= 4).map(([, r]) => r), bad = feelPairs.filter(([f]) => f <= 2).map(([, r]) => r);
    if (good.length >= 2 && bad.length >= 2) {
      feelNote = `<p class="note" style="margin-top:12px">On mornings you felt good or great your recovery averaged <b>${Math.round(mean(good))}%</b>, and <b>${Math.round(mean(bad))}%</b> when you felt rough or awful.</p>`;
    }
  }
  return `<div class="impact">
    ${rows.map((r) => {
      const w = (Math.abs(r.diff) / max) * 50;
      const color = r.diff >= 0 ? 'var(--green)' : 'var(--red)';
      return `<div class="imp-row" title="Yes ${r.yes} times, no ${r.no} times">
        <span class="imp-name">${esc(r.q.short)}</span>
        <div class="imp-bar"><div class="imp-mid"></div><div style="${r.diff >= 0 ? 'left:50%' : `left:${50 - w}%`};width:${Math.max(w, 1)}%;background:${color}"></div></div>
        <span class="imp-val" style="color:${color}">${r.diff > 0 ? '+' : ''}${r.diff}%</span>
      </div>`;
    }).join('')}
  </div>
  <p class="note" style="margin-top:10px">Recovery the morning after you answered yes, compared with mornings you answered no. Green helps, red hurts. Patterns, not proof.</p>
  ${feelNote}`;
}

/** Made-up answers for the demo, loosely tied to each day's recovery (today left blank so you can try it). */
export function demoJournal(scored, todayKey) {
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const out = {};
  for (const d of scored.slice(-60)) {
    if (d.date === todayKey || d.recovery == null) continue;
    const low = d.recovery < 50, high = d.recovery >= 67;
    const p = (lowP, midP, highP) => rand() < (low ? lowP : high ? highP : midP);
    out[d.date] = {
      feel: Math.max(1, Math.min(5, Math.round(d.recovery / 22 + rand() * 1.4 - 0.4))),
      a: {
        alcohol: p(0.55, 0.2, 0.08), caffeine: p(0.8, 0.7, 0.6), lateMeal: p(0.5, 0.3, 0.2), anxiety: p(0.5, 0.25, 0.1),
        journaled: p(0.15, 0.3, 0.45), wfh: p(0.4, 0.4, 0.4), sex: p(0.15, 0.2, 0.3), unwell: p(0.35, 0.08, 0.02),
        therapy: p(0.08, 0.15, 0.3), supplements: p(0.3, 0.4, 0.5), blueLight: p(0.15, 0.3, 0.45), sleepAid: p(0.25, 0.4, 0.6),
      },
      at: Date.now(),
    };
  }
  return out;
}

