import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tCdf,
  tQuantile,
  holm,
  benjaminiHochberg,
  estimateNoise,
  fitTrend,
  detectOnset,
  analyzeTrial,
  checkinsNeeded,
  minimumDetectableChange,
  naiveBeforeAfter,
  VERDICTS,
  mean,
  sd,
  median,
} from '../public/lib/stats.js';
import { createSubject, simulateTrial } from '../public/lib/simulate.js';
import { noisePrior, DEFAULT_CONCERNS } from '../public/lib/concerns.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b}, got ${a}`);

test('descriptive helpers', () => {
  assert.equal(mean([1, 2, 3, 4]), 2.5);
  close(sd([2, 4, 4, 4, 5, 5, 7, 9]), 2.138, 1e-3);
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test('t distribution matches textbook tables', () => {
  close(tCdf(0, 7), 0.5, 1e-12);
  close(tCdf(2.015, 5), 0.95, 1e-3);
  close(tCdf(-2.228, 10), 0.025, 1e-3);
  close(tQuantile(0.975, 10), 2.228, 1e-3);
  close(tQuantile(0.95, 2), 2.92, 1e-2);
  close(tQuantile(0.95, 1000), 1.646, 1e-3);
});

test('Holm and Benjamini-Hochberg adjustments', () => {
  const p = [0.01, 0.04, 0.03, 0.005];
  const h = holm(p);
  // sorted: .005*4=.02, .01*3=.03, .03*2=.06, .04*1=.04 -> monotone .06
  assert.deepEqual(h.map((x) => +x.toFixed(4)), [0.03, 0.06, 0.06, 0.02]);
  const bh = benjaminiHochberg(p);
  // sorted asc: .005*4/1=.02, .01*4/2=.02, .03*4/3=.04, .04*4/4=.04
  assert.deepEqual(bh.map((x) => +x.toFixed(4)), [0.02, 0.04, 0.04, 0.02]);
  assert.ok(holm([0.9]).every((x) => x <= 1));
});

test('calibration noise is shrunk toward the prior, not trusted blindly', () => {
  const flat = estimateNoise([60, 60, 60], { priorSigma: 2.5, priorDf: 4 });
  assert.ok(flat.sigma > 1.5 && flat.sigma < 2.5, 'three identical shots do not mean zero noise');
  const wild = estimateNoise([50, 62, 56], { priorSigma: 2.5, priorDf: 4 });
  assert.ok(wild.sampleSd > 5.5);
  assert.ok(wild.sigma < wild.sampleSd && wild.sigma > 2.5, 'pulled down but still above the prior');
  assert.equal(wild.df, 6);
  close(wild.mean, 56, 1e-9);
});

test('trend fit recovers a known slope and downweights a bad photo', () => {
  const sessions = [{ day: 0, values: [50, 50, 50] }];
  for (let d = 3; d <= 27; d += 3) sessions.push({ day: d, values: [50 + 0.3 * d] });
  const fit = fitTrend(sessions, 2);
  close(fit.slope, 0.3, 1e-6);
  // Corrupt one check-in (e.g. dim lighting knocked 15 points off)
  sessions[4].values = [sessions[4].values[0] - 15];
  const robust = fitTrend(sessions, 2);
  close(robust.slope, 0.3, 0.08, 'Huber weights keep the slope near truth');
  const outlier = robust.points.find((p) => p.day === 12);
  assert.ok(outlier.weight < 0.5, 'the bad photo counts for less');
});

test('noise floor: perfectly smooth data never gives a zero-width interval', () => {
  const sessions = [{ day: 0, values: [60, 60, 60] }];
  for (let d = 3; d <= 27; d += 3) sessions.push({ day: d, values: [60] });
  const fit = fitTrend(sessions, 2);
  assert.ok(fit.seSlope > 0.03, 'uncertainty comes from calibration, not from lucky residuals');
});

test('change-point finds when an effect started', () => {
  const points = [];
  for (let d = 0; d <= 27; d += 3) points.push({ day: d, score: d < 12 ? 60 : 60 + 0.8 * (d - 12), weight: 1 });
  const on = detectOnset(points);
  assert.ok(on.preferred);
  assert.equal(on.onsetDay, 12);
  const linear = [];
  for (let d = 0; d <= 27; d += 3) linear.push({ day: d, score: 60 + 0.3 * d, weight: 1 });
  assert.ok(!detectOnset(linear).preferred, 'a straight line is not a change-point');
});

test('verdicts: improvement, no change, worse, too early', () => {
  const subj = createSubject({
    seed: 7,
    effects: { redness: { delta: 10, onset: 3, ramp: 14 }, oiliness: { delta: -9, onset: 0, ramp: 10 } },
  });
  const trial = simulateTrial(subj, { targets: ['redness', 'pore'] });
  const r = analyzeTrial(trial, { noisePrior: noisePrior() });
  const by = Object.fromEntries(r.rows.map((x) => [x.concern, x]));
  assert.equal(by.redness.verdict, VERDICTS.improved);
  assert.ok(by.redness.ci[0] > 0);
  assert.ok(by.redness.provenDay >= 3 && by.redness.provenDay <= 27, 'time to proof is a check-in day');
  assert.equal(by.oiliness.verdict, VERDICTS.worse);
  assert.ok([VERDICTS.noChange, VERDICTS.tooEarly].includes(by.pore.verdict), `pore was ${by.pore.verdict}`);
  assert.ok(r.complete);

  const early = { ...trial, checkins: trial.checkins.slice(0, 2) };
  const e = analyzeTrial(early, { noisePrior: noisePrior() });
  assert.ok(e.rows.every((x) => x.verdict === VERDICTS.tooEarly));
  assert.equal(e.rows[0].needed, 1);
});

test('a flat 28-day trial reaches "no change" for several concerns and never a false win', () => {
  const subj = createSubject({ seed: 11 });
  const trial = simulateTrial(subj, { targets: ['redness'], cadenceDays: 2 });
  const r = analyzeTrial(trial, { noisePrior: noisePrior() });
  const noChange = r.rows.filter((x) => x.verdict === VERDICTS.noChange).length;
  // Exploratory concerns get corrected (wider) ranges, so fewer of them can prove "no change".
  assert.ok(noChange >= 2, `only ${noChange} of 10 reached no-change`);
  assert.ok(r.rows.every((x) => x.verdict !== VERDICTS.improved && x.verdict !== VERDICTS.worse));
  // In this seed one exploratory concern (wrinkle) drifts up by luck with an interval that
  // excludes zero. Uncorrected, that would be a fake win; the BH correction holds it back,
  // and the range shown to the user is widened to match.
  const wr = r.rows.find((x) => x.concern === 'wrinkle');
  assert.ok(wr.ciRaw[0] > 0 && wr.pImprove < 0.05 && wr.pImproveAdj >= 0.05);
  assert.ok(wr.ci[0] <= 0, 'corrected range includes zero, like the corrected verdict');
});

test('shown ranges agree with the corrected verdicts on every row', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const subj = createSubject({ seed, effects: seed % 3 ? {} : { redness: { delta: 6, onset: 0, ramp: 14 } } });
    const r = analyzeTrial(simulateTrial(subj, { targets: ['redness', 'pore'] }), { noisePrior: noisePrior() });
    for (const x of r.rows.filter((row) => row.fit)) {
      const sigUp = x.pImproveAdj < 0.05;
      const sigDown = x.pWorseAdj < 0.05;
      assert.equal(x.ci[0] > 0, sigUp, `seed ${seed} ${x.concern}: up`);
      assert.equal(x.ci[1] < 0, sigDown, `seed ${seed} ${x.concern}: down`);
      assert.ok(x.ci[1] - x.ci[0] >= x.ciRaw[1] - x.ciRaw[0] - 1e-9);
    }
  }
});

test('checkinsNeeded is a small positive number mid-trial', () => {
  const subj = createSubject({ seed: 3, effects: { redness: { delta: 8, onset: 0, ramp: 20 } } });
  const trial = simulateTrial(subj, { horizonDays: 9 });
  const r = analyzeTrial(trial, { noisePrior: noisePrior() });
  const red = r.rows.find((x) => x.concern === 'redness');
  if (red.verdict === VERDICTS.tooEarly) {
    const k = checkinsNeeded(red.fit, { cadenceDays: 3, mcid: 5, alpha: 0.05 });
    assert.ok(k === null || (k >= 1 && k <= 12));
  }
});

test('minimum detectable change grows with noise', () => {
  const quiet = minimumDetectableChange(1.5);
  const loud = minimumDetectableChange(4);
  assert.ok(quiet < loud);
  assert.ok(quiet > 0.5 && quiet < 5, `quiet MDC ${quiet}`);
});

// ---------- the numbers quoted in the write-up come from these simulations ----------

function runMany(n, makeEffects, { targets = ['redness'], cadenceDays = 3 } = {}) {
  const prior = noisePrior();
  const out = [];
  for (let i = 0; i < n; i++) {
    const subj = createSubject({ seed: 1000 + i, effects: makeEffects(i) });
    const trial = simulateTrial(subj, { targets, cadenceDays });
    const r = analyzeTrial(trial, { noisePrior: prior });
    out.push({ subj, trial, r });
  }
  return out;
}

test('false alarms: with no real effect, Proof rarely calls a target "improved"', () => {
  const runs = runMany(600, () => ({}));
  const fp = runs.filter(({ r }) => r.targets[0].verdict === VERDICTS.improved || r.targets[0].verdict === VERDICTS.smallGain).length / runs.length;
  assert.ok(fp <= 0.07, `false positive rate ${fp}`);
  // Family-wise: any of 10 concerns falsely "improved"
  const anyFp = runs.filter(({ r }) => r.rows.some((x) => x.verdict === VERDICTS.improved)).length / runs.length;
  assert.ok(anyFp <= 0.12, `any-concern false "improved" ${anyFp}`);
});

test('the before/after selfie comparison fools you far more often', () => {
  const runs = runMany(600, () => ({}));
  let anyNaive = 0;
  for (const { trial } of runs) {
    const before = trial.calibration[0].scores;
    const after = trial.checkins[trial.checkins.length - 1].scores;
    if (DEFAULT_CONCERNS.some((c) => naiveBeforeAfter(before[c], after[c]) === VERDICTS.improved)) anyNaive++;
  }
  const rate = anyNaive / runs.length;
  assert.ok(rate > 0.5, `naive any-concern false win rate ${rate}`);
});

test('power: a real 8-point improvement is caught by day 28 most of the time', () => {
  const runs = runMany(400, () => ({ redness: { delta: 8, onset: 0, ramp: 14 } }));
  // 8 points clears the 5-point bar, so most runs should read "improved" outright.
  const hit = runs.filter(({ r }) => r.targets[0].verdict === VERDICTS.improved || r.targets[0].verdict === VERDICTS.smallGain).length / runs.length;
  assert.ok(hit >= 0.8, `power ${hit}`);
});

test('the 90% interval for the change covers the truth about 90% of the time', () => {
  // Linear truth so the estimand is unambiguous: delta over the observed window.
  const runs = runMany(600, () => ({ redness: { delta: 6, onset: 0, ramp: 27 } }));
  let covered = 0;
  for (const { subj, r } of runs) {
    const row = r.targets[0];
    const truth = subj.trueLevel('redness', row.lastDay) - subj.trueLevel('redness', 0);
    if (row.ci[0] <= truth && truth <= row.ci[1]) covered++;
  }
  const cov = covered / runs.length;
  assert.ok(cov >= 0.85 && cov <= 0.98, `coverage ${cov}`);
});
