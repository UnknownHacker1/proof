import { analyzeTrial, estimateNoise, minimumDetectableChange, VERDICTS } from './lib/stats.js';
import { CONCERNS, PRODUCT_TYPES, noisePrior, label } from './lib/concerns.js';
import { verdictText, trialHeadline, tone } from './lib/copy.js';
import { forestPlot, seriesChart, noiseBars } from './lib/charts.js';
import { mountCapture } from './lib/camera.js';
import { compareToBaseline } from './lib/quality.js';
import { drawVerdictCard } from './lib/card.js';
import * as store from './lib/store.js';

const app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtDate = (d) => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const sign = (x, d = 1) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(d);

// Charts are drawn in SVG user units; draw them at the width they will occupy so text stays legible.
function fit(max, inset = 72) {
  return Math.max(280, Math.min(max, document.documentElement.clientWidth - inset));
}

let config = { mode: 'mock', concerns: Object.keys(CONCERNS), unitsPerScan: 14, minShortSide: 480, quality: 'sd' };
let demoTrial = null;
let cleanup = null;

// ---------- data ----------

async function loadConfig() {
  try {
    config = await (await fetch('/api/config')).json();
  } catch {
    /* offline: stay in mock defaults */
  }
}

async function getDemo() {
  if (!demoTrial) demoTrial = await (await fetch('/demo/maya.json')).json();
  return demoTrial;
}

function reportFor(trial) {
  return analyzeTrial(trial, { concerns: trial.concerns, noisePrior: noisePrior(trial.concerns) });
}

async function analyzeShot(shot, trial, day) {
  const res = await fetch('/api/analyze', {
    method: 'POST',
    body: shot.blob,
    headers: {
      'Content-Type': shot.blob.type,
      'x-proof-subject': store.load().subjectId,
      'x-proof-day': String(day),
      'x-proof-luma': String(Math.round(shot.metrics.luma)),
      'x-proof-masks': trial.targets.join(','),
    },
  });
  const json = await res.json().catch(() => ({ ok: false, message: 'The server sent an unreadable reply.' }));
  if (!json.ok) throw json;
  return json;
}

async function thumbnail(blob, size = 120) {
  const img = new Image();
  img.src = URL.createObjectURL(blob);
  await img.decode();
  const c = document.createElement('canvas');
  c.width = size;
  c.height = Math.round(size / 0.75);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
}

function scanFrom(result, shot, day, thumb) {
  return {
    id: result.taskId,
    at: new Date().toISOString(),
    day,
    scores: result.scores,
    ui: result.ui,
    all: result.all,
    skinAge: result.skinAge,
    quality: shot.metrics,
    mode: result.mode,
    units: result.unitsCharged,
    unitsIfLive: result.unitsIfLive,
    receipt: result.receipt,
    thumb,
  };
}

// ---------- shell ----------

function modeBadge() {
  if (config.mode === 'live') return `<span class="mode mode-live" title="Scores come from the real YouCam Skin AI API">Live YouCam</span>`;
  return `<span class="mode mode-mock" title="Scores come from a simulated YouCam API that replies in the documented format. No units are used.">Sample mode</span>`;
}

function shell(content, { wide = false } = {}) {
  const t = store.activeTrial();
  app.innerHTML = `
    <header class="top">
      <a class="wordmark" href="#/">Proof</a>
      <nav>
        ${t ? `<a href="#/report/${t.id}">My trial</a>` : ''}
        <a href="#/example">Example</a>
        <a href="#/method">How it decides</a>
      </nav>
      ${modeBadge()}
    </header>
    <main class="page${wide ? ' page-wide' : ''}">${content}</main>
    <footer class="foot">
      <p>Proof uses YouCam Skin AI to measure and its own statistics to decide. Not medical advice: for persistent or painful skin problems, see a dermatologist.</p>
    </footer>`;
  window.scrollTo(0, 0);
}

function busy(el, steps) {
  let i = 0;
  el.innerHTML = `<div class="busy"><span class="spinner" aria-hidden="true"></span><span class="busy-text">${steps[0]}</span></div>`;
  const text = el.querySelector('.busy-text');
  const id = setInterval(() => {
    i = Math.min(i + 1, steps.length - 1);
    text.textContent = steps[i];
  }, 1400);
  return () => clearInterval(id);
}

function errorBox(err) {
  const units = err?.unitsCharged === 0 ? ' No units were used.' : '';
  return `<div class="notice notice-bad" role="alert"><strong>${esc(err?.hint || err?.message || 'That did not work.')}</strong>${err?.hint && err?.message && err.message !== err.hint ? `<br><span class="fine">${esc(err.message)}</span>` : ''}<span class="fine">${units}</span></div>`;
}

// ---------- home ----------

async function viewHome() {
  const t = store.activeTrial();
  if (t) return viewTrialHome(t);
  const demo = await getDemo();
  const rep = reportFor(demo);
  shell(`
    <section class="hero">
      <h1>Is your skincare actually working?</h1>
      <p class="lede">You bought the serum. Four weeks later you squint at the mirror and still can't tell. Proof answers it properly: it measures your skin with YouCam Skin AI, learns how noisy those measurements are for <em>your</em> face and light, and runs the product like a small clinical trial.</p>
      <div class="actions">
        <a class="btn btn-primary" href="#/new">Start a 28-day trial</a>
        <a class="btn btn-quiet" href="#/example">See a finished trial</a>
      </div>
    </section>
    <section class="teaser" aria-label="Example result">
      <div class="teaser-head">
        <p class="teaser-title">${esc(demo.product)}, day ${rep.day}</p>
        <p class="fine">Synthetic example. ${esc(trialHeadline(rep).sub)}</p>
      </div>
      ${forestPlot(rep.rows.filter((r) => r.target || ['oiliness', 'moisture'].includes(r.concern)), { mcid: rep.mcid, width: fit(560, 82), compact: true })}
      <a class="link" href="#/example">Open the full report</a>
    </section>
    <section class="steps">
      <h2>How a trial works</h2>
      <ol>
        <li><strong>Calibrate.</strong> Three selfies on day 0. Your scores wobble a little between photos even though your skin did not change; Proof measures that wobble.</li>
        <li><strong>Check in.</strong> One selfie every few days, same spot, same light. Proof flags photos taken in different light and counts them less.</li>
        <li><strong>Get a verdict.</strong> For each thing the product claims: working, no real change, getting worse, or too early to tell. Always with the range, never a guess.</li>
      </ol>
    </section>`);
}

function viewTrialHome(t) {
  const day = store.trialDay(t);
  const calibrated = t.calibration.length >= 3;
  const last = store.lastCheckinDay(t);
  const next = store.nextCheckinDay(t);
  const done = day >= t.horizonDays;
  const due = calibrated && day >= next;
  const canCheck = calibrated && day > last && !done;
  const rep = calibrated ? reportFor(t) : null;
  const pct = Math.min(100, (day / t.horizonDays) * 100);
  const ticks = [];
  for (let d = t.cadenceDays; d <= t.horizonDays; d += t.cadenceDays) {
    const hit = t.checkins.some((c) => c.day === d) || t.checkins.some((c) => Math.abs(c.day - d) < t.cadenceDays / 2);
    ticks.push(`<span class="tick${hit ? ' tick-done' : ''}" style="left:${(d / t.horizonDays) * 100}%"></span>`);
  }
  let action;
  if (!calibrated) action = `<a class="btn btn-primary" href="#/calibrate">Finish calibration (${t.calibration.length} of 3 photos)</a>`;
  else if (done) action = `<a class="btn btn-primary" href="#/report/${t.id}">See your verdict</a>`;
  else if (due) action = `<a class="btn btn-primary" href="#/checkin">Check in now</a>`;
  else action = `<p class="next">Next check-in: day ${next}, ${fmtDate(store.dateForDay(t, next))}</p>${canCheck ? `<a class="btn btn-quiet" href="#/checkin">Check in early</a>` : ''}`;
  shell(`
    <section class="trial-card">
      <p class="eyebrowless">${esc(t.product)}</p>
      <h1 class="day">Day ${Math.min(day, t.horizonDays)} <span>of ${t.horizonDays}</span></h1>
      <div class="progress" role="progressbar" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100"><span class="bar" style="width:${pct}%"></span>${ticks.join('')}</div>
      <div class="actions">${action}</div>
      ${config.mode === 'mock' && calibrated && !done ? `<button class="btn btn-ghost" id="skip" type="button">Skip ahead ${t.cadenceDays} days</button><p class="fine">Sample mode only: lets you run a whole trial in a few minutes.</p>` : ''}
    </section>
    ${rep ? `<section class="panel"><h2>${esc(trialHeadline(rep).headline)}</h2><p class="fine">${esc(trialHeadline(rep).sub)}</p>${forestPlot(rep.rows, { mcid: rep.mcid, width: fit(560, 82), compact: true })}<a class="link" href="#/report/${t.id}">Full report</a></section>` : ''}
    <section class="quiet-actions"><button class="btn btn-ghost" id="end" type="button">End this trial</button></section>`);
  document.getElementById('skip')?.addEventListener('click', () => {
    store.update(() => (t.dayOffset = (t.dayOffset || 0) + t.cadenceDays));
    route();
  });
  document.getElementById('end').addEventListener('click', () => {
    if (!confirm('End this trial? Its results stay saved in this browser.')) return;
    store.update((s) => (s.activeId = null));
    route();
  });
}

// ---------- setup ----------

function viewSetup() {
  const types = PRODUCT_TYPES.map((p) => `<button type="button" class="chip" data-type="${p.id}" aria-pressed="false">${p.name}</button>`).join('');
  const concerns = config.concerns.map((c) => `<label class="chip check"><input type="checkbox" name="target" value="${c}"><span>${esc(label(c))}</span></label>`).join('');
  shell(`
    <section class="form-page">
      <h1>What are you testing?</h1>
      <form id="setup" novalidate>
        <label class="field"><span>Product</span><input name="product" required maxlength="60" placeholder="e.g. 10% niacinamide serum" autocomplete="off"></label>
        <fieldset class="field"><legend>Type</legend><div class="chips">${types}</div></fieldset>
        <fieldset class="field">
          <legend>What does it claim to fix? <span class="fine">Pick up to 3.</span></legend>
          <div class="chips">${concerns}</div>
          <p class="fine">These are the main question. Proof still tracks all ${config.concerns.length} concerns, but corrects for testing many at once, so a lucky wobble elsewhere can't count as a win.</p>
        </fieldset>
        <div class="field-row">
          <label class="field"><span>Check in every</span><select name="cadence"><option value="2">2 days</option><option value="3" selected>3 days</option><option value="4">4 days</option></select></label>
          <label class="field"><span>Trial length</span><select name="horizon"><option value="21">21 days</option><option value="28" selected>28 days</option><option value="42">42 days</option></select></label>
        </div>
        <div class="notice">Change one product at a time. If you start a new cleanser in the same month, Proof can't tell which one did it.</div>
        <p class="form-error" hidden></p>
        <button class="btn btn-primary" type="submit">Start calibration</button>
        ${config.mode === 'live' ? `<p class="fine">Each photo is one YouCam analysis (${config.unitsPerScan} units). A full 28-day trial at this pace is about ${3 + Math.floor(28 / 3)} photos.</p>` : ''}
      </form>
    </section>`);
  const form = document.getElementById('setup');
  let type = null;
  form.querySelectorAll('[data-type]').forEach((b) =>
    b.addEventListener('click', () => {
      type = b.dataset.type;
      form.querySelectorAll('[data-type]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      const claims = PRODUCT_TYPES.find((p) => p.id === type).claims;
      form.querySelectorAll('input[name=target]').forEach((i) => (i.checked = claims.includes(i.value)));
    }),
  );
  form.addEventListener('change', (e) => {
    if (e.target.name !== 'target') return;
    const on = [...form.querySelectorAll('input[name=target]:checked')];
    if (on.length > 3) e.target.checked = false;
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const product = String(fd.get('product') || '').trim();
    const targets = fd.getAll('target');
    const err = form.querySelector('.form-error');
    if (!product) {
      err.hidden = false;
      err.textContent = 'Name the product so the report knows what it is judging.';
      return;
    }
    if (!targets.length) {
      err.hidden = false;
      err.textContent = 'Pick at least one thing it claims to fix.';
      return;
    }
    const trial = {
      id: store.uid(),
      product,
      type,
      targets,
      concerns: config.concerns,
      cadenceDays: Number(fd.get('cadence')),
      horizonDays: Number(fd.get('horizon')),
      startedAt: new Date().toISOString(),
      dayOffset: 0,
      mode: config.mode,
      calibration: [],
      checkins: [],
    };
    store.update((s) => {
      s.trials.push(trial);
      s.activeId = trial.id;
    });
    location.hash = '#/calibrate';
  });
}

// ---------- calibration ----------

function viewCalibrate() {
  const t = store.activeTrial();
  if (!t) return (location.hash = '#/new');
  const n = t.calibration.length;
  if (n >= 3) return viewCalibrationResult(t);
  shell(`
    <section class="capture-page">
      <p class="step">Calibration photo ${n + 1} of 3</p>
      <h1>${n === 0 ? 'First, measure the noise' : n === 1 ? 'Step away, then come back' : 'One more'}</h1>
      <p class="lede small">${n === 0 ? 'Three photos, a minute apart. Your skin will not change in that minute, so any difference between the scores is measurement noise. Proof uses it to decide later what counts as a real change.' : 'Leave the frame and sit back down between photos, so the noise includes the small changes in position you will have on real check-in days.'}</p>
      <div id="cap"></div>
      <div id="status"></div>
      <div class="thumbs">${t.calibration.map((c) => (c.thumb ? `<img src="${c.thumb}" alt="Calibration photo">` : '')).join('')}</div>
    </section>`);
  const status = document.getElementById('status');
  const cap = mountCapture(document.getElementById('cap'), {
    minShortSide: config.minShortSide,
    shutterLabel: `Take photo ${n + 1}`,
    onShot: async (shot) => {
      if (!shot.quality.ok) {
        status.innerHTML = errorBox({ hint: shot.quality.issues.find((i) => i.level === 'block').message, unitsCharged: 0 });
        return;
      }
      const stopBusy = busy(status, ['Uploading the photo', 'YouCam Skin AI is analyzing 10 concerns', 'Reading the scores']);
      try {
        const result = await analyzeShot(shot, t, 0);
        stopBusy();
        const thumb = await thumbnail(shot.blob);
        store.update(() => t.calibration.push(scanFrom(result, shot, 0, thumb)));
        cap.stop();
        route();
      } catch (err) {
        stopBusy();
        status.innerHTML = errorBox(err);
      }
    },
  });
  cleanup = () => cap.stop();
}

function viewCalibrationResult(t) {
  const prior = noisePrior(t.concerns);
  const items = t.concerns
    .map((c) => {
      const noise = estimateNoise(t.calibration.map((s) => s.scores[c]).filter(Number.isFinite), { priorSigma: prior[c] });
      return { concern: c, sigma: noise.sigma, sampleSd: noise.sampleSd, mdc: minimumDetectableChange(noise.sigma, { horizonDays: t.horizonDays, cadenceDays: t.cadenceDays }) };
    })
    .sort((a, b) => a.sigma - b.sigma);
  const best = items[0];
  const worst = items[items.length - 1];
  const units = store.unitsUsed(t);
  shell(`
    <section class="calib-result">
      <p class="step">Calibration done</p>
      <h1>Your measurement noise</h1>
      <p class="lede small">How much a single photo's score moves on its own. The darker bar is that wobble; the full bar is the smallest real change Proof should be able to confirm by day ${t.horizonDays} at one check-in every ${t.cadenceDays} days.</p>
      ${noiseBars(items, { width: fit(560, 40) })}
      <p>Steadiest: ${esc(label(best.concern).toLowerCase())}, ±${best.sigma.toFixed(1)} points per photo. Noisiest: ${esc(label(worst.concern).toLowerCase())}, ±${worst.sigma.toFixed(1)}, so expect that verdict to take longer.</p>
      <p class="fine">Three photos are not many, so Proof blends them with typical noise levels instead of trusting them outright.${units ? ` YouCam units used so far: ${units}.` : ''}</p>
      <div class="thumbs">${t.calibration.map((c) => (c.thumb ? `<img src="${c.thumb}" alt="Calibration photo">` : '')).join('')}</div>
      <div class="actions"><a class="btn btn-primary" href="#/">Start the trial</a></div>
      <p class="fine">First check-in: day ${t.cadenceDays}, ${fmtDate(store.dateForDay(t, t.cadenceDays))}. Same spot, same light, same time of day if you can.</p>
    </section>`);
}

// ---------- check-in ----------

function viewCheckin() {
  const t = store.activeTrial();
  if (!t) return (location.hash = '#/new');
  if (t.calibration.length < 3) return (location.hash = '#/calibrate');
  const day = store.trialDay(t);
  if (day <= store.lastCheckinDay(t) && t.checkins.length) {
    shell(`<section class="capture-page"><h1>Already checked in today</h1><p class="lede small">One photo per day keeps the trend honest. Next check-in: day ${store.nextCheckinDay(t)}.</p><a class="btn btn-quiet" href="#/">Back</a></section>`);
    return;
  }
  shell(`
    <section class="capture-page">
      <p class="step">Day ${day} check-in</p>
      <h1>Same spot, same light</h1>
      <p class="lede small">Match your day-0 setup. Proof compares this photo's lighting with your calibration photos and warns you if it changed.</p>
      <div id="cap"></div>
      <div id="status"></div>
    </section>`);
  const status = document.getElementById('status');
  const baseline = t.calibration.map((c) => c.quality).filter(Boolean);
  const cap = mountCapture(document.getElementById('cap'), {
    minShortSide: config.minShortSide,
    shutterLabel: 'Take check-in photo',
    onShot: async (shot) => {
      if (!shot.quality.ok) {
        status.innerHTML = errorBox({ hint: shot.quality.issues.find((i) => i.level === 'block').message, unitsCharged: 0 });
        return;
      }
      const cmp = compareToBaseline(shot.metrics, baseline);
      const warns = [...shot.quality.issues, ...cmp.issues].filter((i) => i.level === 'warn');
      if (warns.length) {
        status.innerHTML = `<div class="notice notice-warn"><ul>${warns.map((w) => `<li>${esc(w.message)}</li>`).join('')}</ul>
          <p class="fine">${cmp.weight < 1 ? 'You can still use it. It will count for less in the trend.' : 'You can still use it.'}</p>
          <div class="actions"><button class="btn btn-quiet" id="retake" type="button">Retake</button><button class="btn btn-primary" id="use" type="button">Use this photo</button></div></div>`;
        document.getElementById('retake').onclick = () => (status.innerHTML = '');
        document.getElementById('use').onclick = () => send();
      } else send();

      async function send() {
        const stopBusy = busy(status, ['Uploading the photo', 'YouCam Skin AI is analyzing', 'Updating your trend']);
        try {
          const result = await analyzeShot(shot, t, day);
          stopBusy();
          const thumb = await thumbnail(shot.blob);
          const scan = scanFrom(result, shot, day, thumb);
          scan.weight = cmp.weight;
          scan.warnings = cmp.issues.map((i) => i.message);
          store.update(() => t.checkins.push(scan));
          cap.stop();
          viewCheckinResult(t, scan, result, shot);
        } catch (err) {
          stopBusy();
          status.innerHTML = errorBox(err);
        }
      }
    },
  });
  cleanup = () => cap.stop();
}

function viewCheckinResult(t, scan, result, shot) {
  const base = {};
  for (const c of t.concerns) {
    const v = t.calibration.map((s) => s.scores[c]).filter(Number.isFinite);
    base[c] = v.reduce((a, b) => a + b, 0) / v.length;
  }
  const focus = t.targets[0];
  const mask = result.masks?.[focus];
  const rows = [...t.targets, ...t.concerns.filter((c) => !t.targets.includes(c))]
    .map((c) => {
      const d = scan.scores[c] - base[c];
      return `<tr class="${t.targets.includes(c) ? 'is-target' : ''}"><th scope="row">${esc(label(c))}</th><td>${scan.scores[c].toFixed(1)}</td><td class="${d >= 0 ? 'up' : 'down'}">${sign(d)}</td></tr>`;
    })
    .join('');
  const rep = reportFor(t);
  shell(`
    <section class="checkin-result">
      <p class="step">Day ${scan.day} saved</p>
      <h1>${esc(trialHeadline(rep).headline)}</h1>
      <p class="lede small">${esc(trialHeadline(rep).sub)}</p>
      <div class="split">
        <figure class="maskfig">
          <img class="photo" src="${shot.previewUrl}" alt="Today's photo">
          ${mask ? `<img class="mask" src="${esc(mask)}" alt="${esc(label(focus))} areas found by YouCam">` : ''}
          <figcaption>${mask ? `${esc(label(focus))} areas, ${result.mode === 'live' ? 'from YouCam Skin AI' : 'sample overlay'}` : 'Today'}</figcaption>
        </figure>
        <div>
          <table class="scores"><thead><tr><th>Concern</th><th>Today</th><th>vs day 0</th></tr></thead><tbody>${rows}</tbody></table>
          <p class="fine">One photo is noisy, so don't read much into a single row. The trend across check-ins is what Proof judges.${result.unitsCharged ? ` This scan used ${result.unitsCharged} YouCam units.` : ''}</p>
        </div>
      </div>
      <div class="actions"><a class="btn btn-primary" href="#/report/${t.id}">See the trend</a><a class="btn btn-quiet" href="#/">Done</a></div>
    </section>`);
}

// ---------- report ----------

async function viewReport(id) {
  const trial = id === 'demo' ? await getDemo() : store.getTrial(id);
  if (!trial) {
    shell(`<section><h1>No trial here</h1><p>This trial isn't saved in this browser.</p><a class="btn btn-primary" href="#/new">Start a trial</a></section>`);
    return;
  }
  if (trial.calibration.length < 3) return (location.hash = '#/calibrate');
  const rep = reportFor(trial);
  const head = trialHeadline(rep);
  const opts = { complete: rep.complete, mcid: rep.mcid };
  const card = (r, i) => {
    const v = verdictText(r, opts);
    return `<article class="verdict v-${v.tone}${r.target ? ' is-target' : ''}">
      <header><h3>${esc(label(r.concern))}</h3><span class="tag tag-${v.tone}">${esc(v.headline)}</span></header>
      <p>${esc(v.body)}</p>
      ${r.fit ? `<details${r.target && i === 0 ? ' open' : ''}><summary>Trend and numbers</summary>
        ${seriesChart(r, { width: fit(560, r.target ? 76 : 40), height: 190, horizon: trial.horizonDays })}
        <dl class="nums">
          <div><dt>Change so far</dt><dd>${sign(r.delta)} pts</dd></div>
          <div><dt>90% range</dt><dd>${sign(r.ci[0])} to ${sign(r.ci[1])}</dd></div>
          <div><dt>Photo noise</dt><dd>±${r.noise.sigma.toFixed(1)}</dd></div>
          <div><dt>Day-to-day</dt><dd>±${r.fit.tau.toFixed(1)}</dd></div>
          <div><dt>p, adjusted</dt><dd>${fmtP(r.delta >= 0 ? r.pImproveAdj : r.pWorseAdj)}</dd></div>
          ${r.provenDay ? `<div><dt>Clear from</dt><dd>day ${r.provenDay}</dd></div>` : ''}
        </dl></details>` : ''}
    </article>`;
  };
  const unresolved = rep.targets.filter((r) => ![VERDICTS.improved].includes(r.verdict) && r.fit);
  const photos = [...trial.calibration, ...trial.checkins];
  const units = store.unitsUsed(trial);
  shell(
    `
    <section class="report-head">
      ${trial.demo ? `<p class="demo-flag">Synthetic demo. ${esc(trial.person)} is not a real person: this trial was generated through Proof's real pipeline against the simulated YouCam API, with true effects you can reveal below.</p>` : ''}
      <p class="eyebrowless">${esc(trial.product)}</p>
      <h1>${esc(head.headline)}</h1>
      <p class="lede">${esc(head.sub)}</p>
      <p class="meta">Day ${rep.day} of ${trial.horizonDays}${rep.complete ? ', trial complete' : ''}. ${photos.length} photos.${units ? ` ${units} YouCam units.` : ''}</p>
    </section>
    <section class="forest-wrap" aria-labelledby="fp-title">
      <div class="forest-head">
        <h2 id="fp-title">Change since day 0</h2>
        <p class="fine">Dot: estimated change in YouCam's raw score. Line: 90% range. Shaded: under ±${rep.mcid} points, too small to notice. <span class="claim-key">Filled marker</span> = the product claims this.</p>
      </div>
      <div id="forest">${forestPlot(rep.rows, { mcid: rep.mcid, width: fit(720, 82) })}</div>
      ${trial.demo ? `<label class="toggle"><input type="checkbox" id="truth"> Show the planted true effects (answer key)</label>` : ''}
    </section>
    <section class="verdicts">
      <h2>What it claims</h2>
      ${rep.targets.map(card).join('')}
      <h2>Everything else</h2>
      <p class="fine">Not claimed by the product, so these get a stricter bar (false discovery rate control across all of them).</p>
      ${rep.others.map(card).join('')}
    </section>
    ${unresolved.length ? `<section class="next-try"><h2>If it isn't doing the job</h2>${unresolved.map((r) => `<div class="try"><h3>${esc(label(r.concern))}</h3><p>Ingredient classes often used for this: ${CONCERNS[r.concern].next.map(esc).join(', ')}.</p></div>`).join('')}<p class="fine">General cosmetic information, not medical advice. Patch test new products, and start one at a time so your next trial can tell what worked.</p></section>` : ''}
    <section class="log">
      <h2>Photos</h2>
      <ul class="photolog">${photos
        .map((s) => `<li>${s.thumb ? `<img src="${s.thumb}" alt="">` : `<span class="nothumb">day ${s.day}</span>`}<span>Day ${s.day}${s.day === 0 ? ' (calibration)' : ''}</span>${s.weight != null && s.weight < 1 ? `<span class="fine warn-text">${esc(s.warnings?.[0] || 'Counted less')}</span>` : ''}</li>`)
        .join('')}</ul>
      <div class="verify">
        <button class="btn btn-quiet" id="verify" type="button">Check the scan signatures</button>
        <p class="fine" id="verify-out">Every score is signed by the server the moment YouCam returns it, so a shared result can be checked for edits.</p>
      </div>
    </section>
    <section class="share">
      <a class="btn btn-primary" href="#/card/${trial.demo ? 'demo' : trial.id}">Make the ${rep.day}-day verdict card</a>
      <a class="link" href="#/method">How Proof decides</a>
    </section>`,
    { wide: true },
  );
  document.getElementById('truth')?.addEventListener('change', (e) => {
    document.getElementById('forest').innerHTML = forestPlot(rep.rows, { mcid: rep.mcid, width: fit(720, 82), truth: e.target.checked ? trial.truth : null });
  });
  document.getElementById('verify').addEventListener('click', async () => {
    const out = document.getElementById('verify-out');
    if (trial.demo) {
      out.textContent = 'Demo data is synthetic and unsigned, so there is nothing to verify. Your own trials carry a signature on every scan.';
      return;
    }
    const receipts = photos.map((p) => p.receipt).filter(Boolean);
    const v = await (await fetch('/api/verify', { method: 'POST', body: JSON.stringify({ receipts }) })).json();
    out.textContent = `${v.valid} of ${photos.length} scans carry a valid signature from this server${v.live ? ` (${v.live} from live YouCam calls)` : ''}. Trial code ${v.code}.${v.valid < photos.length ? ' Scans signed before a server restart without a fixed RECEIPT_SECRET will not verify.' : ''}`;
  });
}

function fmtP(p) {
  if (p == null) return 'n/a';
  if (p < 0.001) return 'under 0.1%';
  return `${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`;
}

// ---------- verdict card ----------

async function viewCard(id) {
  const trial = id === 'demo' ? await getDemo() : store.getTrial(id);
  if (!trial) return (location.hash = '#/');
  const rep = reportFor(trial);
  shell(`
    <section class="card-page">
      <h1>Your verdict card</h1>
      <p class="lede small">For your notes, a review, or a refund request. It shows ranges, not just a before and after.</p>
      <canvas id="card" class="vcard" aria-label="Verdict card"></canvas>
      <div class="actions"><button class="btn btn-primary" id="share" type="button">Share</button><button class="btn btn-quiet" id="dl" type="button">Download PNG</button></div>
      <a class="link" href="#/report/${trial.demo ? 'demo' : trial.id}">Back to the report</a>
    </section>`);
  let verified = null;
  let code = null;
  if (!trial.demo) {
    const receipts = [...trial.calibration, ...trial.checkins].map((p) => p.receipt).filter(Boolean);
    try {
      const v = await (await fetch('/api/verify', { method: 'POST', body: JSON.stringify({ receipts }) })).json();
      verified = v.valid;
      code = v.code;
    } catch {
      /* offline: draw without */
    }
  }
  const canvas = document.getElementById('card');
  await drawVerdictCard(canvas, trial, rep, { verified, code });
  const name = `proof-${trial.product.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-day${rep.day}.png`;
  const blob = () => new Promise((r) => canvas.toBlob(r, 'image/png'));
  document.getElementById('dl').onclick = async () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await blob());
    a.download = name;
    a.click();
  };
  const shareBtn = document.getElementById('share');
  shareBtn.onclick = async () => {
    const file = new File([await blob()], name, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: `${trial.product}: ${trialHeadline(rep).headline}` });
      } catch {
        /* cancelled */
      }
    } else document.getElementById('dl').click();
  };
}

// ---------- method ----------

function viewMethod() {
  shell(`
    <article class="method">
      <h1>How Proof decides</h1>
      <p class="lede">A mirror compares today with a fuzzy memory. A before/after selfie compares two noisy numbers. Proof does what a clinical trial does, scaled down to one person.</p>

      <h2>YouCam is the instrument</h2>
      <p>Every photo goes to YouCam Skin AI (<code>POST /s2s/v2.0/task/skin-analysis</code>), which scores ${config.concerns.length} concerns from 1 to 100. YouCam returns two numbers per concern. The <code>ui_score</code> is adjusted upward on purpose to feel encouraging; the <code>raw_score</code> is what the model actually measured. Proof only does statistics on <code>raw_score</code>, because an encouraging transform would hide real changes.</p>

      <h2>Step 1: measure the noise</h2>
      <p>Three photos on day 0, a minute apart. Skin does not change in a minute, so the spread between their scores is pure measurement noise: light, angle, expression. Three photos are only two "degrees of freedom", which is not much, so Proof blends your spread with a typical noise level for each concern rather than trusting it outright.</p>

      <h2>Step 2: fit a trend, not a before/after</h2>
      <p>Each check-in adds a point. Proof fits a straight line through all of them, weighting each point by how noisy it should be, and also estimates how much your skin wobbles from day to day (sleep, weather, hormones). Two safety rails:</p>
      <ul>
        <li><strong>Noise floor.</strong> The uncertainty can grow beyond what calibration predicts, never shrink below it. Five lucky check-ins in a row can't make Proof overconfident.</li>
        <li><strong>Bad photos count less.</strong> A check-in in different light than day 0 is down-weighted, and any point far off the trend is automatically discounted (a robust fit).</li>
      </ul>

      <h2>Step 3: a verdict with a range</h2>
      <p>The change so far comes with a 90% range. Changes under ±5 points are treated as too small to notice. Then:</p>
      <ul class="verdict-key">
        <li><span class="tag tag-good">Working</span> the whole range is above zero and the change clears 5 points.</li>
        <li><span class="tag tag-flat">No real change</span> the whole range sits inside ±5. That is a real answer: the product is not doing anything you would see.</li>
        <li><span class="tag tag-bad">Getting worse</span> the whole range is below zero by more than 5.</li>
        <li><span class="tag tag-wait">Too early</span> none of the above yet. Proof estimates how many more check-ins it needs.</li>
      </ul>

      <h2>Step 4: no fishing for wins</h2>
      <p>Test ten concerns and one will look better by luck. So before the trial starts you say what the product claims to fix. Those claims are the main question (Holm correction across them). Everything else is exploratory and has to clear a stricter bar (Benjamini-Hochberg false discovery rate control).</p>

      <h2>Does it work?</h2>
      <p>The method is checked by simulation (<code>npm run simulate</code>: 2,000 simulated 28-day trials per scenario, plus the test suite).</p>
      <ul>
        <li>When the product does nothing, Proof calls the claimed concern improved in 3.8% of trials, and calls <em>any</em> of the ten concerns improved in 1.3%.</li>
        <li>The before/after selfie, with the same 5-point bar, finds a fake improvement in at least one of ten concerns in 66% of those trials.</li>
        <li>A real 8-point improvement is confirmed by day 27 in 96% of trials, typically clear by day 12. A 5-point one, in 74%.</li>
        <li>The 90% ranges contain the true change in 92% of trials.</li>
      </ul>
      <p class="fine">These numbers assume the noise levels in the simulation. Calibration replaces them with your own.</p>

      <h2>What Proof can't do</h2>
      <ul>
        <li>It measures what the camera sees. Lighting is the biggest confounder; that is why it checks it.</li>
        <li>It can't separate the product from anything else that changed that month: season, a new cleanser, stress. Change one thing at a time.</li>
        <li>It is not a diagnosis. Painful, spreading, or persistent skin problems need a dermatologist.</li>
      </ul>
    </article>`);
}

// ---------- router ----------

async function route() {
  cleanup?.();
  cleanup = null;
  const [, view, arg] = (location.hash || '#/').split('/');
  try {
    if (!view) await viewHome();
    else if (view === 'new') viewSetup();
    else if (view === 'calibrate') viewCalibrate();
    else if (view === 'checkin') viewCheckin();
    else if (view === 'report') await viewReport(arg);
    else if (view === 'example') await viewReport('demo');
    else if (view === 'card') await viewCard(arg);
    else if (view === 'method') viewMethod();
    else await viewHome();
  } catch (err) {
    console.error(err);
    shell(`<section><h1>Something broke</h1>${errorBox({ message: String(err?.message || err) })}<a class="btn btn-quiet" href="#/">Home</a></section>`);
  }
}

window.addEventListener('hashchange', route);
// Redraw charts at the new width after a resize or rotation (not on capture screens).
let resizeTimer = null;
let lastWidth = document.documentElement.clientWidth;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(async () => {
    const w = document.documentElement.clientWidth;
    if (Math.abs(w - lastWidth) < 40 || /calibrate|checkin|new/.test(location.hash)) return;
    lastWidth = w;
    const y = window.scrollY;
    await route();
    window.scrollTo(0, y);
  }, 250);
});
await loadConfig();
route();
