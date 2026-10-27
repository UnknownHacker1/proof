// Builds public/demo/maya.json: a complete, clearly synthetic 28-day trial so anyone can see a
// finished report instantly without spending YouCam units.
//
// Every photo goes through the real pipeline in mock mode: the YouCam client registers a file,
// uploads, starts a task and polls the simulated YouCam server, and the documented response is
// normalized exactly like a live one. The simulated person has known "true" effects (the answer
// key ships in the file, and the report can reveal it).
//
// Usage: node scripts/make-demo.js [--search]
//   --search  try seeds and print which ones tell the planted story cleanly.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createYouCamClient, normalizeSkinOutput } from '../server/youcam-client.js';
import { createMockYouCam } from '../server/mock-youcam.js';
import { createSubject } from '../public/lib/simulate.js';
import { analyzeTrial, mulberry32 } from '../public/lib/stats.js';
import { DEFAULT_CONCERNS, noisePrior } from '../public/lib/concerns.js';
import { compareToBaseline } from '../public/lib/quality.js';
import { ROOT } from '../server/config.js';

const TRUTH = {
  redness: { delta: 10, onset: 9, ramp: 8 },
  oiliness: { delta: 7, onset: 3, ramp: 14 },
  moisture: { delta: -6, onset: 2, ramp: 10 },
};
const TARGETS = ['redness', 'pore'];
const START = '2026-09-28T08:30:00.000Z';
const CADENCE = 3;
const HORIZON = 28;
const DIM_DAY = 15; // one check-in shot under a dimmer lamp
// Chosen with --search: the seed whose noise realization tells the planted story without a
// spurious extra finding. The method's real error rates come from test/stats.test.js and
// scripts/simulate.js across thousands of seeds, not from this one run.
const SEED = 'maya-demo-34';

function jpegStub() {
  // 960x1280 baseline JPEG header: enough for the size checks the mock enforces.
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const sof = [0xff, 0xc0, 0x00, 0x11, 8, 1280 >> 8, 1280 & 255, 960 >> 8, 960 & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof, 0xff, 0xd9]);
}

async function build(seed) {
  const subject = createSubject({ seed, concerns: DEFAULT_CONCERNS, effects: TRUTH, noiseScale: 0.7, dayNoise: 0.8 });
  const rng = mulberry32(7);
  let ctx = { subject, day: 0, luma: 140 };
  const client = createYouCamClient({
    apiKey: 'mock',
    fetchImpl: createMockYouCam({ apiKey: 'mock', subjectFor: () => ctx, runningPolls: 1 }),
    sleep: async () => {},
  });
  const startMs = Date.parse(START);
  async function shot(day, minuteOffset, luma) {
    ctx = { subject, day, luma };
    const r = await client.analyzeSkin(jpegStub(), { concerns: DEFAULT_CONCERNS });
    const n = normalizeSkinOutput(r.output);
    const at = new Date(startMs + day * 86400e3 + minuteOffset * 60e3 + Math.round(rng() * 40) * 60e3).toISOString();
    return {
      id: r.taskId,
      at,
      day,
      scores: n.scores,
      ui: n.ui,
      all: n.all,
      skinAge: n.skinAge,
      quality: { luma, warmth: 1.14 + (rng() - 0.5) * 0.04, sharpness: 140 + rng() * 60, evenness: 0.03 + rng() * 0.04, clipHigh: 0, clipLow: 0 },
      mode: 'mock',
      units: 0,
      unitsIfLive: r.unitsCharged,
    };
  }
  const calibration = [];
  for (let i = 0; i < 3; i++) calibration.push(await shot(0, i, 138 + rng() * 6));
  const checkins = [];
  for (let d = CADENCE; d <= HORIZON; d += CADENCE) {
    const luma = d === DIM_DAY ? 96 : 136 + rng() * 8;
    const s = await shot(d, 0, luma);
    const cmp = compareToBaseline(s.quality, calibration.map((c) => c.quality));
    s.weight = cmp.weight;
    s.warnings = cmp.issues.map((i) => i.message);
    checkins.push(s);
  }
  return {
    id: 'demo-maya',
    demo: true,
    person: 'Maya (synthetic demo)',
    product: '10% niacinamide serum',
    type: 'serum',
    targets: TARGETS,
    concerns: DEFAULT_CONCERNS,
    cadenceDays: CADENCE,
    horizonDays: HORIZON,
    startedAt: START,
    mode: 'mock',
    calibration,
    checkins,
    truth: Object.fromEntries(DEFAULT_CONCERNS.map((c) => [c, TRUTH[c] ? TRUTH[c].delta : 0])),
  };
}

function story(trial) {
  const r = analyzeTrial(trial, { concerns: DEFAULT_CONCERNS, noisePrior: noisePrior() });
  const v = Object.fromEntries(r.rows.map((x) => [x.concern, x.verdict]));
  const red = r.rows.find((x) => x.concern === 'redness');
  const clean =
    v.redness === 'improved' &&
    v.pore === 'no-change' &&
    ['improved', 'small-gain'].includes(v.oiliness) &&
    ['worse', 'small-loss'].includes(v.moisture) &&
    r.rows.filter((x) => !['redness', 'pore', 'oiliness', 'moisture'].includes(x.concern)).every((x) => ['no-change', 'too-early'].includes(x.verdict));
  const settled = r.rows.filter((x) => x.verdict !== 'too-early').length;
  return { clean, v, onset: red.onset?.onsetDay, proven: red.provenDay, settled };
}

export { build, story };
if (process.argv.includes("--search")) {
  for (let i = 0; i < 80; i++) {
    const seed = `maya-demo-${i}`;
    const s = story(await build(seed));
    if (s.clean || process.argv.includes("--all")) console.log(s.clean ? "CLEAN" : "     ", seed, "settled", s.settled, "proven", s.proven, "onset", s.onset, JSON.stringify(s.v));
  }
} else {
  const trial = await build(SEED);
  const s = story(trial);
  const out = join(ROOT, 'public', 'demo', 'maya.json');
  writeFileSync(out, JSON.stringify(trial, null, 1) + '\n');
  console.log(`Wrote ${out}`);
  console.log(`Story ${s.clean ? 'matches' : 'DOES NOT match'} the planted truth:`, s.v);
}
