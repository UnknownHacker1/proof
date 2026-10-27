// How often does Proof get it right? Runs thousands of simulated 28-day trials with known
// true effects and prints error rates for Proof and for the before/after selfie comparison.
// These are the numbers quoted in the README and the Devpost write-up.
//
// Proof only issues verdicts at the planned final check-in (earlier reports show the trend
// so far), so the main rates are final-day rates. The "if it peeked" block shows what showing
// a verdict at every check-in would have cost.
//
// Usage: node scripts/simulate.js [trials=2000]

import { analyzeTrial, naiveBeforeAfter, VERDICTS } from '../public/lib/stats.js';
import { createSubject, simulateTrial } from '../public/lib/simulate.js';
import { DEFAULT_CONCERNS, noisePrior } from '../public/lib/concerns.js';
import { compareToBaseline } from '../public/lib/quality.js';

const N = Number(process.argv.find((a) => /^\d+$/.test(a)) || 2000);
const prior = noisePrior();
const pct = (x) => (100 * x).toFixed(1) + '%';
const UP = [VERDICTS.improved, VERDICTS.smallGain];
const DIRECTIONAL = [VERDICTS.improved, VERDICTS.smallGain, VERDICTS.worse, VERDICTS.smallLoss];
const line = (label, value) => console.log(`  ${label} ${'.'.repeat(Math.max(2, 52 - label.length))} ${value}`);
const weighFor = (luma, base) => compareToBaseline({ luma, warmth: 1 }, [{ luma: base, warmth: 1 }]).weight;

function run(effects, seedBase, { noiseScale = 1, lighting = null, peek = false } = {}) {
  const o = { improved: 0, up: 0, directional: 0, anyImproved: 0, anyUp: 0, anyDirectional: 0, anyWorse: 0, naiveTarget: 0, naiveAny: 0, noChange: 0, covered: 0, proven: [], peekTargetUp: 0, peekAnyUp: 0 };
  for (let i = 0; i < N; i++) {
    const subj = createSubject({ seed: seedBase + i, effects, noiseScale });
    const trial = simulateTrial(subj, { targets: ['redness'], lighting: lighting && ((d) => lighting(d, i)), weighFor });
    const r = analyzeTrial(trial, { noisePrior: prior });
    const red = r.targets[0];
    if (red.verdict === VERDICTS.improved) o.improved++;
    if (UP.includes(red.verdict)) o.up++;
    if (DIRECTIONAL.includes(red.verdict)) o.directional++;
    if (red.verdict === VERDICTS.noChange) o.noChange++;
    if (r.rows.some((x) => x.verdict === VERDICTS.improved)) o.anyImproved++;
    if (r.rows.some((x) => UP.includes(x.verdict))) o.anyUp++;
    if (r.rows.some((x) => DIRECTIONAL.includes(x.verdict))) o.anyDirectional++;
    if (r.rows.some((x) => [VERDICTS.worse, VERDICTS.smallLoss].includes(x.verdict))) o.anyWorse++;
    const before = trial.calibration[0].scores;
    const after = trial.checkins[trial.checkins.length - 1].scores;
    if (naiveBeforeAfter(before.redness, after.redness) === VERDICTS.improved) o.naiveTarget++;
    if (DEFAULT_CONCERNS.some((c) => naiveBeforeAfter(before[c], after[c]) === VERDICTS.improved)) o.naiveAny++;
    const truth = subj.trueLevel('redness', red.lastDay) - subj.trueLevel('redness', 0);
    if (red.ci[0] <= truth && truth <= red.ci[1]) o.covered++;
    if (red.provenDay && UP.includes(red.verdict)) o.proven.push(red.provenDay);
    if (peek) {
      let tUp = false;
      let aUp = false;
      for (let k = 3; k <= trial.checkins.length; k++) {
        const rk = analyzeTrial({ ...trial, checkins: trial.checkins.slice(0, k) }, { noisePrior: prior });
        if (UP.includes(rk.targets[0].verdict)) tUp = true;
        if (rk.rows.some((x) => UP.includes(x.verdict))) aUp = true;
      }
      if (tUp) o.peekTargetUp++;
      if (aUp) o.peekAnyUp++;
    }
  }
  return o;
}

console.log(`Proof simulation: ${N} trials per scenario, 10 concerns, 3 calibration photos, a check-in every 3 days, verdict at day 27\n`);

const nul = run({}, 10_000, { peek: true });
console.log('Product does nothing (no real effect anywhere):');
console.log(' The claimed concern');
line('Proof says Improved', pct(nul.improved / N));
line('Proof says Improved or Small improvement', pct(nul.up / N));
line('Proof gives any directional verdict (incl. worse)', pct(nul.directional / N));
line('Before/after selfie says it improved', pct(nul.naiveTarget / N));
line('Proof says "No real change"', pct(nul.noChange / N));
line('Shown range contains the true change', pct(nul.covered / N));
console.log(' Any of the 10 concerns (the fair comparison)');
line('Proof says Improved or Small improvement', pct(nul.anyUp / N));
line('Before/after selfie finds an improvement', pct(nul.naiveAny / N));
line('Proof says Improved (5+ points) only', pct(nul.anyImproved / N));
line('Proof gives any directional verdict (incl. worse)', pct(nul.anyDirectional / N));
console.log(' If Proof showed a verdict at every check-in instead (why it waits)');
line('Claimed concern shown improving at some point', pct(nul.peekTargetUp / N));
line('Any concern shown improving at some point', pct(nul.peekAnyUp / N));
console.log();

for (const delta of [5, 8, 12]) {
  const eff = run({ redness: { delta, onset: 0, ramp: 14 } }, 20_000 + delta * 1000);
  const days = eff.proven.sort((a, b) => a - b);
  console.log(`Real ${delta}-point improvement in the claimed concern:`);
  line('Proof says Improved or Small improvement at day 27', pct(eff.up / N));
  line('Proof says Improved (5+ points)', pct(eff.improved / N));
  line('Median day the trend became clear (in hindsight)', days.length ? days[Math.floor(days.length / 2)] : 'n/a');
  line('Shown range contains the true change', pct(eff.covered / N));
  console.log();
}

console.log('Stress tests (product does nothing):');
for (const scale of [1.5, 2]) {
  const s = run({}, 40_000 + scale * 1000, { noiseScale: scale });
  console.log(` Real photo noise ${scale}x the built-in guesses`);
  line('Any of 10 says Improved or Small improvement', pct(s.anyUp / N));
  line('Claimed concern reaches "No real change"', pct(s.noChange / N));
}
// Light that drifts dimmer over the month (window light in autumn): 140 -> 95 mean brightness,
// plus day-to-day jitter. Proof down-weights photos whose light moved >25% from day 0, but it
// does not model the lighting effect, so a steady drift biases scores downward.
const drift = run({}, 50_000, { lighting: (d, i) => 140 - (45 * d) / 27 + (((i * 7 + d * 13) % 11) - 5) });
console.log(' Light drifting from bright to dim over the month');
line('Any of 10 says Improved or Small improvement', pct(drift.anyUp / N));
line('Any of 10 says Worse or Slightly worse', pct(drift.anyWorse / N));
