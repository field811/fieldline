// Morning check-in: a few yes/no questions about yesterday, then over time
// we show how each habit lines up with your recovery.

export const BUILT_IN = [
  { id: 'alcohol', q: 'Did you have any alcohol?', short: 'Alcohol' },
  { id: 'caffeine', q: 'Caffeine after 2 pm?', short: 'Late caffeine' },
  { id: 'lateMeal', q: 'Eat within 2 hours of bed?', short: 'Late meal' },
  { id: 'screens', q: 'Use your phone in bed?', short: 'Phone in bed' },
  { id: 'stress', q: 'Feel stressed?', short: 'Stress' },
  { id: 'hydrated', q: 'Drink plenty of water?', short: 'Well hydrated' },
  { id: 'stretch', q: 'Stretch or do mobility work?', short: 'Stretching' },
  { id: 'sore', q: 'Feel sore or unwell?', short: 'Sore or unwell' },
  { id: 'outside', q: 'Get outside in daylight?', short: 'Daylight' },
  { id: 'sauna', q: 'Sauna or cold plunge?', short: 'Sauna / cold' },
  { id: 'nap', q: 'Have a nap?', short: 'Nap' },
  { id: 'magnesium', q: 'Take magnesium?', short: 'Magnesium' },
];
export const DEFAULT_ON = ['alcohol', 'caffeine', 'lateMeal', 'screens', 'stress', 'hydrated', 'stretch', 'sore'];

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
        alcohol: p(0.55, 0.2, 0.08), caffeine: p(0.45, 0.3, 0.2), lateMeal: p(0.5, 0.3, 0.2), screens: p(0.7, 0.5, 0.35),
        stress: p(0.6, 0.3, 0.12), hydrated: p(0.4, 0.65, 0.85), stretch: p(0.25, 0.4, 0.6), sore: p(0.4, 0.15, 0.05),
      },
      at: Date.now(),
    };
  }
  return out;
}

