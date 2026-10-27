// A virtual person whose skin we control, used by the mock YouCam server, the demo profile
// and the statistics tests. Scores follow YouCam's raw_score convention: 1-100, higher is
// healthier.
//
// Each observation = true level on that day + day-to-day wobble (sleep, hydration, season)
// + per-photo measurement noise (light, angle, expression).

import { mulberry32, randn, hashSeed } from './stats.js';
import { CONCERNS, DEFAULT_CONCERNS } from './concerns.js';

export function clampScore(x) {
  return Math.min(99.5, Math.max(1, x));
}

// effects: { [concern]: { delta, onset = 0, ramp = 14 } } meaning the true score rises by
// `delta` points, starting at `onset` and reaching full effect after `ramp` days.
export function createSubject({ seed = 1, concerns = DEFAULT_CONCERNS, effects = {}, noiseScale = 1, dayNoise = 1.0 } = {}) {
  const rng = mulberry32(typeof seed === 'string' ? hashSeed(seed) : seed);
  const baseline = {};
  for (const c of concerns) baseline[c] = 45 + rng() * 35; // 45..80, typical of the docs' samples
  const dayCache = new Map();

  function trueLevel(concern, day) {
    const e = effects[concern];
    let lift = 0;
    if (e) {
      const onset = e.onset ?? 0;
      const ramp = e.ramp ?? 14;
      const p = Math.min(1, Math.max(0, (day - onset) / ramp));
      lift = e.delta * p;
    }
    return baseline[concern] + lift;
  }

  function dayOffset(concern, day) {
    const key = concern + '@' + Math.round(day);
    if (!dayCache.has(key)) {
      const r = mulberry32(hashSeed(String(seed) + key));
      dayCache.set(key, randn(r) * dayNoise);
    }
    return dayCache.get(key);
  }

  function observe(concern, day, { lightingPenalty = 0 } = {}) {
    const sigma = (CONCERNS[concern]?.noise ?? 2.5) * noiseScale;
    const x = trueLevel(concern, day) + dayOffset(concern, day) + randn(rng) * sigma - lightingPenalty;
    return clampScore(x);
  }

  function photo(day, opts) {
    const scores = {};
    for (const c of concerns) scores[c] = observe(c, day, opts);
    return scores;
  }

  return { baseline, trueLevel, observe, photo, concerns, effects };
}

// How the mock YouCam (and this simulator) model lighting: dim photos read as duller skin on
// every concern, growing below a comfortable mean brightness of 110/255.
export function lightingPenaltyFor(luma) {
  return luma != null && luma < 110 ? (110 - luma) / 12 : 0;
}

// A full trial as Proof stores it: 3 calibration photos on day 0, then a check-in every
// `cadenceDays` up to `horizonDays`.
// lighting(day) -> mean brightness of that photo (optional). Each photo then gets the lighting
// penalty, and `weighFor(luma, baselineLuma)` (the app's own rule, passed in) sets its weight.
export function simulateTrial(subject, { cadenceDays = 3, horizonDays = 28, targets = [], calibrationShots = 3, skip = [], lighting = null, weighFor = null } = {}) {
  const shot = (day) => {
    const luma = lighting ? lighting(day) : null;
    return { luma, scores: subject.photo(day, { lightingPenalty: lightingPenaltyFor(luma) }) };
  };
  const calibration = [];
  for (let i = 0; i < calibrationShots; i++) {
    const p = shot(0);
    calibration.push({ scores: p.scores, quality: { luma: p.luma } });
  }
  const baseLuma = lighting ? calibration.reduce((t, c) => t + c.quality.luma, 0) / calibration.length : null;
  const checkins = [];
  for (let d = cadenceDays; d <= horizonDays; d += cadenceDays) {
    if (skip.includes(d)) continue;
    const p = shot(d);
    const c = { day: d, scores: p.scores };
    if (lighting && weighFor) c.weight = weighFor(p.luma, baseLuma);
    checkins.push(c);
  }
  return { targets, cadenceDays, horizonDays, calibration, checkins };
}
