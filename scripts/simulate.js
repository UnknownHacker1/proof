// How often does Proof get it right? Runs thousands of simulated 28-day trials with known
// true effects and prints error rates for Proof and for the before/after selfie comparison.
// These are the numbers quoted in the README and the Devpost write-up.
//
// Usage: node scripts/simulate.js [trials=2000] [--noise=1.0]

import { analyzeTrial, naiveBeforeAfter, VERDICTS } from '../public/lib/stats.js';
import { createSubject, simulateTrial } from '../public/lib/simulate.js';
import { DEFAULT_CONCERNS, noisePrior } from '../public/lib/concerns.js';

const N = Number(process.argv.find((a) => /^\d+$/.test(a)) || 2000);
const noiseScale = Number((process.argv.find((a) => a.startsWith('--noise=')) || '--noise=1').split('=')[1]);
const prior = noisePrior();
const pct = (x) => (100 * x).toFixed(1) + '%';
const isWin = (v) => v === VERDICTS.improved || v === VERDICTS.smallGain;

function run(effects, seedBase) {
  const out = { targetWin: 0, anyWin: 0, naiveAnyWin: 0, naiveTargetWin: 0, covered: 0, noChange: 0, settledByDay: [] };
  for (let i = 0; i < N; i++) {
    const subj = createSubject({ seed: seedBase + i, effects, noiseScale });
    const trial = simulateTrial(subj, { targets: ['redness'] });
    const r = analyzeTrial(trial, { noisePrior: prior });
    const red = r.targets[0];
    if (isWin(red.verdict)) out.targetWin++;
    if (red.verdict === VERDICTS.noChange) out.noChange++;
    if (r.rows.some((x) => x.verdict === VERDICTS.improved)) out.anyWin++;
    const before = trial.calibration[0].scores;
    const after = trial.checkins[trial.checkins.length - 1].scores;
    if (naiveBeforeAfter(before.redness, after.redness) === VERDICTS.improved) out.naiveTargetWin++;
    if (DEFAULT_CONCERNS.some((c) => naiveBeforeAfter(before[c], after[c]) === VERDICTS.improved)) out.naiveAnyWin++;
    const truth = subj.trueLevel('redness', red.lastDay) - subj.trueLevel('redness', 0);
    if (red.ci[0] <= truth && truth <= red.ci[1]) out.covered++;
    if (red.provenDay) out.settledByDay.push(red.provenDay);
  }
  return out;
}

console.log(`Proof simulation: ${N} trials per scenario, 10 concerns, 3 calibration photos, check-in every 3 days to day 27, noise x${noiseScale}\n`);

const nul = run({}, 10_000);
console.log('No real effect anywhere (the product does nothing):');
console.log(`  Proof calls the claimed concern improved ........ ${pct(nul.targetWin / N)}`);
console.log(`  Proof calls ANY of 10 concerns improved ......... ${pct(nul.anyWin / N)}`);
console.log(`  Before/after selfie says claimed one improved ... ${pct(nul.naiveTargetWin / N)}`);
console.log(`  Before/after selfie finds a win in any of 10 .... ${pct(nul.naiveAnyWin / N)}`);
console.log(`  Proof reaches "no real change" for the claim .... ${pct(nul.noChange / N)}`);
console.log(`  90% range contains the true change .............. ${pct(nul.covered / N)}\n`);

for (const delta of [5, 8, 12]) {
  const eff = run({ redness: { delta, onset: 0, ramp: 14 } }, 20_000 + delta * 1000);
  const days = eff.settledByDay.sort((a, b) => a - b);
  const med = days.length ? days[Math.floor(days.length / 2)] : null;
  console.log(`Real ${delta}-point improvement in the claimed concern:`);
  console.log(`  Proof confirms it by day 27 ..................... ${pct(eff.targetWin / N)}`);
  console.log(`  Median day it became clear ...................... ${med ?? 'n/a'}`);
  console.log(`  90% range contains the true change .............. ${pct(eff.covered / N)}\n`);
}
