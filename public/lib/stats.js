// Proof statistics engine. Pure functions, no DOM, runs in the browser and in Node tests.
//
// The idea in one paragraph: YouCam Skin AI gives a score per concern, but any single score
// is noisy (lighting, angle, expression, time of day). Proof measures that noise on day 0
// (three back-to-back selfies), then fits a trend through the check-ins with a noise floor
// taken from that calibration, so a verdict is never more confident than the instrument
// allows. Pre-registered "target" concerns get a Holm correction; everything else is
// exploratory and gets Benjamini-Hochberg, so testing ten concerns does not manufacture a win.

// ---------- random numbers (seeded, so demos and tests are reproducible) ----------

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randn(rng) {
  let u = 0;
  while (u === 0) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

// ---------- descriptive ----------

export function mean(xs) {
  if (!xs.length) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function variance(xs) {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return s / (xs.length - 1);
}

export function sd(xs) {
  return Math.sqrt(variance(xs));
}

export function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (!n) return NaN;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

// ---------- Student t distribution ----------

function lnGamma(z) {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function betacf(a, b, x) {
  const MAXIT = 200;
  const EPS = 3e-14;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

// Regularized incomplete beta I_x(a, b).
export function incBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

export function tCdf(t, df) {
  if (!Number.isFinite(t)) return t > 0 ? 1 : 0;
  const x = df / (df + t * t);
  const tail = 0.5 * incBeta(x, df / 2, 0.5);
  return t >= 0 ? 1 - tail : tail;
}

export function tQuantile(p, df) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  let lo = -1e4;
  let hi = 1e4;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (tCdf(mid, df) < p) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-10) break;
  }
  return (lo + hi) / 2;
}

// ---------- multiple comparisons ----------

export function holm(pvals) {
  const m = pvals.length;
  const order = pvals.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]);
  const adj = new Array(m);
  let running = 0;
  order.forEach(([p, i], k) => {
    running = Math.max(running, Math.min(1, (m - k) * p));
    adj[i] = running;
  });
  return adj;
}

export function benjaminiHochberg(pvals) {
  const m = pvals.length;
  const order = pvals.map((p, i) => [p, i]).sort((a, b) => b[0] - a[0]);
  const adj = new Array(m);
  let running = 1;
  order.forEach(([p, i], k) => {
    const rank = m - k;
    running = Math.min(running, Math.min(1, (p * m) / rank));
    adj[i] = running;
  });
  return adj;
}

// ---------- step 1: measurement noise from calibration ----------

// Three selfies give only two degrees of freedom, and a standard deviation from three points
// can easily be off by a factor of two. So the calibration SD is combined with a prior
// (scaled inverse chi-square, worth `priorDf` observations) centred on a typical noise level.
export function estimateNoise(replicates, { priorSigma = 2.5, priorDf = 4 } = {}) {
  const n = replicates.length;
  const m = mean(replicates);
  const s2 = n >= 2 ? variance(replicates) : NaN;
  const dataDf = Math.max(0, n - 1);
  const df = priorDf + dataDf;
  const pooled = df > 0 ? (priorDf * priorSigma ** 2 + (dataDf ? dataDf * s2 : 0)) / df : priorSigma ** 2;
  return {
    n,
    mean: m,
    sampleSd: n >= 2 ? Math.sqrt(s2) : null,
    sigma: Math.sqrt(pooled),
    df,
  };
}

// ---------- step 2: weighted least squares with an estimated day-to-day variance ----------

function wls(ts, ys, ws) {
  let sw = 0;
  let st = 0;
  let sy = 0;
  for (let i = 0; i < ts.length; i++) {
    sw += ws[i];
    st += ws[i] * ts[i];
    sy += ws[i] * ys[i];
  }
  const tb = st / sw;
  const yb = sy / sw;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < ts.length; i++) {
    sxx += ws[i] * (ts[i] - tb) ** 2;
    sxy += ws[i] * (ts[i] - tb) * (ys[i] - yb);
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  const intercept = yb - slope * tb;
  return { slope, intercept, sxx, tbar: tb };
}

const HUBER_C = 1.345;

// sessions: [{ day, values: [scores...], weight? }]. The calibration session has several
// values on day 0; each check-in normally has one. `weight` < 1 marks a capture that passed
// but looked off (lighting drift); it counts less.
export function fitTrend(sessions, sigmaW) {
  const pts = sessions
    .filter((s) => s.values && s.values.length)
    .map((s) => ({ t: s.day, y: mean(s.values), m: s.values.length, q: s.weight ?? 1 }));
  const n = pts.length;
  const ts = pts.map((p) => p.t);
  const ys = pts.map((p) => p.y);
  const floorVar = pts.map((p) => sigmaW ** 2 / p.m);
  let tau2 = 0;
  let huber = pts.map(() => 1);
  let fit = null;
  let vs = floorVar.slice();
  for (let iter = 0; iter < 30; iter++) {
    vs = floorVar.map((f) => f + tau2);
    const ws = vs.map((v, i) => (huber[i] * pts[i].q) / v);
    fit = wls(ts, ys, ws);
    const resid = ys.map((y, i) => y - (fit.intercept + fit.slope * ts[i]));
    const newHuber = resid.map((r, i) => {
      const z = Math.abs(r) / Math.sqrt(vs[i]);
      return z <= HUBER_C ? 1 : HUBER_C / z;
    });
    let newTau2 = tau2;
    if (n > 2) {
      // Method of moments: spread of residuals beyond what calibration noise explains.
      let ss = 0;
      for (let i = 0; i < n; i++) ss += newHuber[i] * resid[i] ** 2;
      const hsum = newHuber.reduce((a, b) => a + b, 0);
      const meanFloor = floorVar.reduce((a, f, i) => a + newHuber[i] * f, 0) / hsum;
      newTau2 = Math.max(0, (ss / hsum) * (n / (n - 2)) - meanFloor);
    }
    const converged = Math.abs(newTau2 - tau2) < 1e-9 && newHuber.every((h, i) => Math.abs(h - huber[i]) < 1e-9);
    tau2 = newTau2;
    huber = newHuber;
    if (converged) break;
  }
  vs = floorVar.map((f) => f + tau2);
  const ws = vs.map((v, i) => (huber[i] * pts[i].q) / v);
  fit = wls(ts, ys, ws);
  const resid = ys.map((y, i) => y - (fit.intercept + fit.slope * ts[i]));
  // Residual scale relative to the model, floored at 1: the noise floor. Proof can become
  // less confident than calibration suggests, never more.
  let chi = 0;
  for (let i = 0; i < n; i++) chi += ws[i] * resid[i] ** 2;
  const scale = n > 2 ? Math.max(1, chi / (n - 2)) : 1;
  const seSlope = fit.sxx > 0 ? Math.sqrt(scale / fit.sxx) : Infinity;
  return {
    n,
    slope: fit.slope,
    intercept: fit.intercept,
    seSlope,
    tau: Math.sqrt(tau2),
    sigmaW,
    df: Math.max(1, n - 2),
    weights: huber.map((h, i) => h * pts[i].q),
    points: pts.map((p, i) => ({ day: p.t, score: p.y, reps: p.m, weight: huber[i] * p.q, resid: resid[i] })),
    sxx: fit.sxx,
    tbar: fit.tbar,
    scale,
  };
}

// ---------- step 3: when did it start? (hinge change-point, descriptive only) ----------

function sseLinearLike(ts, ys, ws, basis) {
  const fit = wls(basis, ys, ws);
  let sse = 0;
  for (let i = 0; i < ts.length; i++) sse += ws[i] * (ys[i] - (fit.intercept + fit.slope * basis[i])) ** 2;
  return { sse, fit };
}

export function detectOnset(points, { minAfter = 3 } = {}) {
  const ts = points.map((p) => p.day);
  const ys = points.map((p) => p.score);
  const ws = points.map((p) => Math.max(1e-6, p.weight ?? 1));
  const n = ts.length;
  if (n < 5) return null;
  const sw = ws.reduce((a, b) => a + b, 0);
  const lin = sseLinearLike(ts, ys, ws, ts);
  const bic = (sse, k) => n * Math.log(Math.max(sse, 1e-12) / sw) + k * Math.log(n);
  const bicLin = bic(lin.sse, 2);
  let best = null;
  const tMax = Math.max(...ts);
  const candidates = [...new Set(ts)].filter((tau) => tau > 0 && ts.filter((t) => t > tau).length >= minAfter && tau < tMax);
  for (const tau of candidates) {
    const basis = ts.map((t) => Math.max(0, t - tau));
    const h = sseLinearLike(ts, ys, ws, basis);
    const b = bic(h.sse, 3); // tau counts as a parameter
    if (!best || b < best.bic) best = { tau, bic: b, slope: h.fit.slope };
  }
  if (!best) return null;
  const deltaBic = bicLin - best.bic;
  return { onsetDay: best.tau, deltaBic, slopeAfter: best.slope, preferred: deltaBic > 2 };
}

// ---------- step 4: verdicts ----------

export const VERDICTS = {
  improved: 'improved',
  smallGain: 'small-gain',
  noChange: 'no-change',
  smallLoss: 'small-loss',
  worse: 'worse',
  tooEarly: 'too-early',
};

export const DEFAULTS = {
  alpha: 0.05, // one-sided, so the 90% interval is the matching display
  // Equivalence margin: changes smaller than this many raw-score points (on YouCam's 1-100
  // scale) are treated as too small to matter. Also the bar a real improvement has to clear.
  mcid: 5,
  minCheckins: 3,
  horizonDays: 28,
  cadenceDays: 3,
};

// How many more check-ins (at the trial cadence) until the question is settled, assuming the
// current trend and noise hold. Returns null if it would take more than `maxExtra`.
export function checkinsNeeded(fit, { cadenceDays, mcid, alpha, maxExtra = 12 }) {
  const lastDay = Math.max(...fit.points.map((p) => p.day));
  const v = fit.sigmaW ** 2 + fit.tau ** 2;
  const ts = fit.points.map((p) => p.day);
  const ws = fit.points.map((p) => p.weight / (fit.sigmaW ** 2 / p.reps + fit.tau ** 2));
  for (let k = 1; k <= maxExtra; k++) {
    const t2 = [...ts];
    const w2 = [...ws];
    for (let j = 1; j <= k; j++) {
      t2.push(lastDay + j * cadenceDays);
      w2.push(1 / v);
    }
    let sw = 0;
    let st = 0;
    for (let i = 0; i < t2.length; i++) {
      sw += w2[i];
      st += w2[i] * t2[i];
    }
    const tb = st / sw;
    let sxx = 0;
    for (let i = 0; i < t2.length; i++) sxx += w2[i] * (t2[i] - tb) ** 2;
    const se = Math.sqrt(fit.scale / sxx);
    const T = lastDay + k * cadenceDays;
    const tq = tQuantile(1 - alpha, Math.max(1, t2.length - 2));
    const half = tq * se * T;
    const delta = fit.slope * T;
    if (half < Math.abs(delta) || Math.abs(delta) + half < mcid) return k;
  }
  return null;
}

// Minimum detectable change by the end of the trial for a given noise level: the smallest
// true change whose 90% interval would exclude zero half the time. Shown after calibration.
export function minimumDetectableChange(sigmaW, { horizonDays = 28, cadenceDays = 3, calibrationShots = 3, alpha = 0.05, tau = 1.0 } = {}) {
  const days = [0];
  const vars = [sigmaW ** 2 / calibrationShots + tau ** 2];
  for (let d = cadenceDays; d <= horizonDays; d += cadenceDays) {
    days.push(d);
    vars.push(sigmaW ** 2 + tau ** 2);
  }
  const ws = vars.map((v) => 1 / v);
  const sw = ws.reduce((a, b) => a + b, 0);
  const tb = days.reduce((a, t, i) => a + ws[i] * t, 0) / sw;
  const sxx = days.reduce((a, t, i) => a + ws[i] * (t - tb) ** 2, 0);
  const se = Math.sqrt(1 / sxx);
  const tq = tQuantile(1 - alpha, days.length - 2);
  return tq * se * horizonDays;
}

// trial: { targets: [concern], cadenceDays, horizonDays,
//          calibration: [{ scores: {concern: raw} }],
//          checkins: [{ day, scores: {concern: raw}, weight? }] }
// noisePrior: { [concern]: sigma } typical noise per concern (prior centre).
export function analyzeTrial(trial, { concerns, noisePrior = {}, mcid = DEFAULTS.mcid, alpha = DEFAULTS.alpha, minCheckins = DEFAULTS.minCheckins } = {}) {
  const cadenceDays = trial.cadenceDays ?? DEFAULTS.cadenceDays;
  const horizonDays = trial.horizonDays ?? DEFAULTS.horizonDays;
  const list = concerns ?? Object.keys(trial.calibration?.[0]?.scores ?? {});
  const targets = new Set(trial.targets ?? []);
  const rows = list.map((concern) => {
    const reps = (trial.calibration ?? []).map((s) => s.scores?.[concern]).filter(Number.isFinite);
    const noise = estimateNoise(reps, { priorSigma: noisePrior[concern] ?? 2.5 });
    const checks = (trial.checkins ?? [])
      .filter((c) => Number.isFinite(c.scores?.[concern]))
      .map((c) => ({ day: c.day, values: [c.scores[concern]], weight: c.weight ?? 1 }));
    const base = { concern, target: targets.has(concern), noise, baseline: noise.mean, checkins: checks.length };
    if (!reps.length || checks.length < minCheckins) {
      return { ...base, verdict: VERDICTS.tooEarly, needed: Math.max(0, minCheckins - checks.length), reason: 'not-enough-checkins' };
    }
    const sessions = [{ day: 0, values: reps }, ...checks];
    const fit = fitTrend(sessions, noise.sigma);
    const lastDay = Math.max(...checks.map((c) => c.day));
    const tq = tQuantile(1 - alpha, fit.df);
    const delta = fit.slope * lastDay;
    const half = tq * fit.seSlope * lastDay;
    const tstat = fit.seSlope > 0 ? fit.slope / fit.seSlope : 0;
    const pImprove = 1 - tCdf(tstat, fit.df);
    const pWorse = tCdf(tstat, fit.df);
    const onset = detectOnset(fit.points);
    return {
      ...base,
      fit,
      lastDay,
      delta,
      ci: [delta - half, delta + half],
      deltaPct: base.baseline ? (100 * delta) / base.baseline : null,
      pImprove,
      pWorse,
      onset: onset && onset.preferred && fit.slope > 0 ? onset : null,
    };
  });

  // Corrections: targets were declared up front (Holm); the rest are exploratory (BH).
  const tested = rows.filter((r) => r.fit);
  const tgt = tested.filter((r) => r.target);
  const exp = tested.filter((r) => !r.target);
  const applyAdj = (group, key, fn) => {
    const adj = fn(group.map((r) => r[key]));
    group.forEach((r, i) => (r[key + 'Adj'] = adj[i]));
  };
  if (tgt.length) {
    applyAdj(tgt, 'pImprove', holm);
    applyAdj(tgt, 'pWorse', holm);
  }
  if (exp.length) {
    applyAdj(exp, 'pImprove', benjaminiHochberg);
    applyAdj(exp, 'pWorse', benjaminiHochberg);
  }

  for (const r of tested) {
    if (r.pImproveAdj < alpha) r.verdict = r.delta >= mcid ? VERDICTS.improved : VERDICTS.smallGain;
    else if (r.pWorseAdj < alpha) r.verdict = -r.delta >= mcid ? VERDICTS.worse : VERDICTS.smallLoss;
    else if (r.ci[0] > -mcid && r.ci[1] < mcid) r.verdict = VERDICTS.noChange;
    else r.verdict = VERDICTS.tooEarly;
    if (r.verdict === VERDICTS.tooEarly) {
      r.needed = checkinsNeeded(r.fit, { cadenceDays, mcid, alpha });
      r.reason = 'uncertain';
    }
  }

  const day = Math.max(0, ...(trial.checkins ?? []).map((c) => c.day));
  return {
    day,
    horizonDays,
    cadenceDays,
    mcid,
    alpha,
    complete: day + cadenceDays > horizonDays,
    rows,
    targets: rows.filter((r) => r.target),
    others: rows.filter((r) => !r.target),
  };
}

// The comparison most people actually make: one photo before, one photo after.
// Used only by the simulation to show how often it fools you.
export function naiveBeforeAfter(before, after, threshold = DEFAULTS.mcid) {
  const d = after - before;
  if (d >= threshold) return VERDICTS.improved;
  if (d <= -threshold) return VERDICTS.worse;
  return VERDICTS.noChange;
}
