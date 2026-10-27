// Plain-language verdicts. Pure functions so the wording is tested alongside the maths.

import { VERDICTS } from './stats.js';
import { label } from './concerns.js';

const fmt = (x, d = 1) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(d);
const abs = (x, d = 1) => Math.abs(x).toFixed(d);

export function tone(verdict) {
  switch (verdict) {
    case VERDICTS.improved:
    case VERDICTS.smallGain:
      return 'good';
    case VERDICTS.worse:
    case VERDICTS.smallLoss:
      return 'bad';
    case VERDICTS.noChange:
      return 'flat';
    default:
      return 'wait';
  }
}

// One vocabulary everywhere (app, card, README, write-up). Verdicts exist only once the
// planned final check-in is in; before that every row is "Trend so far".
export const VERDICT_NAMES = {
  improved: 'Improved since you started',
  'small-gain': 'Small improvement',
  'no-change': 'No real change',
  'small-loss': 'Slightly worse',
  worse: 'Worse since you started',
  'too-early': 'Inconclusive',
  interim: 'Trend so far',
};

export function verdictText(row, { complete = false, mcid = 5, finalDay = null } = {}) {
  const name = label(row.concern);
  const v = row.verdict;
  if (row.reason === 'not-enough-checkins') {
    const n = row.needed;
    return {
      headline: 'Not enough check-ins yet',
      body: n > 0 ? `Proof needs ${n} more check-in${n === 1 ? '' : 's'} before it can show a trend for ${name.toLowerCase()}.` : 'Waiting for the calibration photos.',
      tone: 'wait',
    };
  }
  const [lo, hi] = row.ci;
  const pct = row.deltaPct != null ? ` (${fmt(row.deltaPct, 0)}%)` : '';
  if (!complete) {
    const down = v === VERDICTS.worse || v === VERDICTS.smallLoss;
    return {
      headline: VERDICT_NAMES.interim,
      body: `So far ${fmt(row.delta)} points, range ${fmt(lo)} to ${fmt(hi)}. The verdict comes at the final check-in${finalDay ? ` (day ${finalDay})` : ''}; calling it earlier would mean more false alarms.${down ? ' It is trending down. If your skin feels irritated, stopping is your call; that needs no statistics.' : ''}`,
      tone: 'wait',
    };
  }
  const onset = row.onset ? ` It started around day ${row.onset.onsetDay}.` : '';
  switch (v) {
    case VERDICTS.improved:
      return {
        headline: VERDICT_NAMES.improved,
        body: `${name} is up ${abs(row.delta)} points${pct}. Even the cautious end of the range is ${fmt(lo)}, so this is more than photo noise.${onset}`,
        tone: 'good',
      };
    case VERDICTS.smallGain:
      return {
        headline: VERDICT_NAMES['small-gain'],
        body: `${name} is up ${abs(row.delta)} points. More than photo noise, but under the ${mcid}-point bar for a change you would notice.`,
        tone: 'good',
      };
    case VERDICTS.noChange:
      return {
        headline: VERDICT_NAMES['no-change'],
        body: `Any change in ${name.toLowerCase()} is between ${fmt(lo)} and ${fmt(hi)} points, inside the ±${mcid} band you would not notice.${row.target ? ' If this is why you bought it, it is not delivering.' : ''}`,
        tone: 'flat',
      };
    case VERDICTS.smallLoss:
      return {
        headline: VERDICT_NAMES['small-loss'],
        body: `${name} is down ${abs(row.delta)} points. More than photo noise, but small. Worth watching.`,
        tone: 'bad',
      };
    case VERDICTS.worse:
      return {
        headline: VERDICT_NAMES.worse,
        body: `${name} dropped ${abs(row.delta)} points${pct}. If this started with the new product, consider pausing it.`,
        tone: 'bad',
      };
    default:
      return {
        headline: VERDICT_NAMES['too-early'],
        body: `No clear answer. If there is a change in ${name.toLowerCase()}, it is somewhere between ${fmt(lo)} and ${fmt(hi)} points.`,
        tone: 'wait',
      };
  }
}

// One line for the whole trial, based only on the concerns the product claims to fix.
export function trialHeadline(report) {
  const t = report.targets.length ? report.targets : report.rows;
  if (!report.complete) {
    const final = report.finalDay ?? report.horizonDays;
    const started = t.some((r) => r.fit);
    return {
      headline: started ? 'Trend so far' : 'Too early for a trend',
      sub: started ? `The verdict comes at the final check-in, day ${final}. Until then this is a running trend, not an answer.` : 'Keep checking in. Proof will not guess.',
    };
  }
  const vs = t.map((r) => r.verdict);
  const n = vs.length;
  const count = (...kinds) => vs.filter((v) => kinds.includes(v)).length;
  const lower = (rows) => rows.map((r) => label(r.concern).toLowerCase()).join(' and ');
  const worse = report.rows.filter((r) => r.verdict === VERDICTS.worse);
  if (worse.length) {
    if (count(VERDICTS.improved) > 0) return { headline: 'Improved, with a side effect', sub: `What it claims improved, but ${lower(worse)} got worse.` };
    return { headline: 'Something got worse', sub: `${lower(worse)} dropped beyond photo noise.` };
  }
  if (count(VERDICTS.improved) === n) return { headline: 'Improved since you started', sub: 'Every claimed benefit shows a change beyond photo noise.' };
  if (count(VERDICTS.improved, VERDICTS.smallGain) > 0) {
    const good = t.filter((r) => [VERDICTS.improved, VERDICTS.smallGain].includes(r.verdict));
    return { headline: 'Partly improved', sub: `Real change in ${lower(good)}. Not in the rest of what it claims.` };
  }
  if (count(VERDICTS.noChange) === n) return { headline: 'No real change', sub: 'Nothing it promised moved beyond photo noise.' };
  return { headline: 'No clear answer', sub: 'The trial ended without a clear change either way.' };
}

// What a trend over time can and can't tell you. Shown with every final verdict.
export const CAUSALITY_NOTE = 'Proof shows what changed since you started, not why. Season, humidity, stress, a skin flare you started on, or any other change in your routine can move scores too. Change one product at a time and keep the same spot and light.';
