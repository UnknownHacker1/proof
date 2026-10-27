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

export function verdictText(row, { complete = false, mcid = 5 } = {}) {
  const name = label(row.concern);
  const v = row.verdict;
  if (v === VERDICTS.tooEarly && row.reason === 'not-enough-checkins') {
    const n = row.needed;
    return {
      headline: 'Not enough check-ins yet',
      body: n > 0 ? `Proof needs ${n} more check-in${n === 1 ? '' : 's'} before it will say anything about ${name.toLowerCase()}.` : 'Waiting for the calibration photos.',
      tone: 'wait',
    };
  }
  const [lo, hi] = row.ci;
  const pct = row.deltaPct != null ? ` (${fmt(row.deltaPct, 0)}%)` : '';
  const onset = row.onset ? ` It started around day ${row.onset.onsetDay}.` : '';
  switch (v) {
    case VERDICTS.improved:
      return {
        headline: 'Working',
        body: `${name} improved by ${abs(row.delta)} points${pct}. Even the cautious end of the range is ${fmt(lo)}, so this is not noise.${onset}`,
        tone: 'good',
      };
    case VERDICTS.smallGain:
      return {
        headline: 'Real, but small',
        body: `${name} is up ${abs(row.delta)} points. That is real, but under the ${mcid}-point bar for a change you would notice.`,
        tone: 'good',
      };
    case VERDICTS.noChange:
      return {
        headline: 'No real change',
        body: `Any change in ${name.toLowerCase()} is between ${fmt(lo)} and ${fmt(hi)} points, inside the ±${mcid} band you would not notice.${row.target ? ' If this is why you bought it, it is not delivering.' : ''}`,
        tone: 'flat',
      };
    case VERDICTS.smallLoss:
      return {
        headline: 'Slightly worse',
        body: `${name} is down ${abs(row.delta)} points. Real, but small. Worth watching.`,
        tone: 'bad',
      };
    case VERDICTS.worse:
      return {
        headline: 'Getting worse',
        body: `${name} dropped ${abs(row.delta)} points${pct}. If this started with the new product, consider pausing it.`,
        tone: 'bad',
      };
    default: {
      if (complete) {
        return {
          headline: 'Inconclusive',
          body: `No clear answer. If there is an effect on ${name.toLowerCase()}, it is somewhere between ${fmt(lo)} and ${fmt(hi)} points.`,
          tone: 'wait',
        };
      }
      const k = row.needed;
      return {
        headline: 'Too early to call',
        body: k ? `So far ${fmt(row.delta)} points, range ${fmt(lo)} to ${fmt(hi)}. About ${k} more check-in${k === 1 ? '' : 's'} should settle it.` : `So far ${fmt(row.delta)} points, range ${fmt(lo)} to ${fmt(hi)}. This one may need a longer trial.`,
        tone: 'wait',
      };
    }
  }
}

// One line for the whole trial, based only on the concerns the product claims to fix.
export function trialHeadline(report) {
  const t = report.targets.length ? report.targets : report.rows;
  const vs = t.map((r) => r.verdict);
  const n = vs.length;
  const count = (...kinds) => vs.filter((v) => kinds.includes(v)).length;
  if (report.rows.some((r) => r.verdict === VERDICTS.worse)) {
    const bad = report.rows.filter((r) => r.verdict === VERDICTS.worse).map((r) => label(r.concern).toLowerCase());
    if (count(VERDICTS.improved) > 0) return { headline: 'Working, with a side effect', sub: `It is doing its job, but ${bad.join(' and ')} got worse.` };
    return { headline: 'Something is getting worse', sub: `${bad.join(' and ')} dropped beyond noise.` };
  }
  if (count(VERDICTS.tooEarly) === n && !report.complete) return { headline: 'Too early to call', sub: 'Keep checking in. Proof will not guess.' };
  if (count(VERDICTS.improved) === n) return { headline: 'It is working', sub: 'Every claimed benefit shows a real change, beyond measurement noise.' };
  if (count(VERDICTS.improved, VERDICTS.smallGain) > 0) {
    const good = t.filter((r) => [VERDICTS.improved, VERDICTS.smallGain].includes(r.verdict)).map((r) => label(r.concern).toLowerCase());
    return { headline: 'Partly working', sub: `Real change in ${good.join(' and ')}. Not in the rest of what it claims.` };
  }
  if (count(VERDICTS.noChange) === n) return { headline: 'Not doing what it claims', sub: 'No change beyond measurement noise in anything it promised.' };
  return { headline: report.complete ? 'No clear answer' : 'Too early to call', sub: report.complete ? 'The trial ended without a clear effect either way.' : 'Some answers are in. Keep checking in for the rest.' };
}
