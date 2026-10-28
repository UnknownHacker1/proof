// Repeatability study against the LIVE YouCam API: how much do Skin Analysis scores move
// between photos taken a minute apart, when the skin cannot have changed?
//
// 1. Take 5 selfies, about a minute apart, same spot and light, stepping out of frame
//    between shots. Put the JPGs in ./noise-study/ (gitignored; photos never get committed).
// 2. YOUCAM_API_KEY in .env, then:  npm run noise:measure
//
// Cost: one task per photo plus one repeat of the first photo (is the model deterministic on
// identical input?). With the default 10 SD concerns that is 6 x 14 = 84 units.
// Output: per-concern SD table on screen and in docs/noise-study.md, plus a snippet for the
// `noise` priors in public/lib/concerns.js.

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadDotEnv, readConfig, ROOT } from '../server/config.js';
import { createYouCamClient, normalizeSkinOutput } from '../server/youcam-client.js';
import { createMockYouCam } from '../server/mock-youcam.js';
import { imageInfo } from '../server/image-info.js';
import { createSubject } from '../public/lib/simulate.js';
import { mean, sd } from '../public/lib/stats.js';
import { label } from '../public/lib/concerns.js';
import { readScanLog, calibrationSessions, pooledNoise } from '../server/scan-log.js';

loadDotEnv();
const cfg = readConfig();
if (process.argv.includes('--from-scans')) {
  fromScans(process.argv.includes('--log') ? process.argv[process.argv.indexOf('--log') + 1] : join(ROOT, 'noise-study', 'live-scans.jsonl'));
  process.exit(0);
}
const dir = join(ROOT, 'noise-study');
if (!existsSync(dir)) {
  console.error('Put 3-8 selfies (JPG/PNG) in ./noise-study/ first.');
  process.exit(1);
}
const files = readdirSync(dir).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort();
if (files.length < 3) {
  console.error(`Found ${files.length} photos in ./noise-study/; need at least 3.`);
  process.exit(1);
}

const live = cfg.mode === 'live';
const subject = createSubject({ seed: 'noise-study', concerns: cfg.concerns });
const client = live
  ? createYouCamClient({ apiKey: cfg.apiKey, host: cfg.host })
  : createYouCamClient({ apiKey: 'mock', fetchImpl: createMockYouCam({ apiKey: 'mock', subjectFor: () => ({ subject, day: 0 }) }), sleep: async () => {} });

console.log(`${live ? 'LIVE YouCam' : 'MOCK (no key set)'}: ${files.length} photos + 1 repeat, ${cfg.concerns.length} concerns, ~${(files.length + 1) * cfg.unitsPerScan} units${live ? '' : ' if live'}.\n`);

const runs = [];
let units = 0;
for (const f of [...files, files[0]]) {
  const bytes = readFileSync(join(dir, f));
  const info = imageInfo(bytes);
  process.stdout.write(`${f} (${info.width}x${info.height}) ... `);
  try {
    const r = await client.analyzeSkin(bytes, { contentType: info.type, fileName: f, concerns: cfg.dstActions });
    units += live ? r.unitsCharged : 0;
    const n = normalizeSkinOutput(r.output);
    runs.push({ file: f, ...n, ms: r.timings.totalMs });
    console.log(`ok in ${(r.timings.totalMs / 1000).toFixed(1)}s, ${r.polls} polls`);
    if (live && runs.length === 1) writeFileSync(join(dir, "raw-output.json"), JSON.stringify(r.output, null, 1)); // first live reply, kept for checking the shape
    if (live) client.deleteTask(r.taskId).catch(() => {});
  } catch (err) {
    console.log(`failed: ${err.code} ${err.hint || err.message}`);
  }
}

const photoRuns = runs.slice(0, -1);
const repeat = runs[runs.length - 1];
const rows = cfg.concerns.map((c) => {
  const raw = photoRuns.map((r) => r.scores[c]).filter(Number.isFinite);
  const ui = photoRuns.map((r) => r.ui[c]).filter(Number.isFinite);
  const same = repeat && runs[0] ? Math.abs(repeat.scores[c] - runs[0].scores[c]) : null;
  return { concern: c, n: raw.length, mean: mean(raw), sdRaw: sd(raw), sdUi: sd(ui), repeatDiff: same };
});

const table = [
  '| Concern | Photos | Mean raw | SD raw (photo to photo) | SD ui | Same file twice: diff |',
  '|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${label(r.concern)} (\`${r.concern}\`) | ${r.n} | ${r.mean.toFixed(1)} | ${r.sdRaw.toFixed(2)} | ${r.sdUi.toFixed(2)} | ${r.repeatDiff == null ? 'n/a' : r.repeatDiff.toFixed(3)} |`),
].join('\n');
console.log('\n' + table);
const snippet = rows.map((r) => `  ${r.concern}: ${Math.max(0.8, r.sdRaw).toFixed(1)},`).join('\n');
console.log(`\nPaste into public/lib/concerns.js as the noise priors:\n${snippet}\n`);
console.log(`Units used: ${units}. Median latency: ${(runs.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(runs.length / 2)] / 1000).toFixed(1)}s.`);

if (live) {
  const md = `# YouCam Skin Analysis repeatability study

Run ${new Date().toISOString().slice(0, 10)} with \`npm run noise:measure\` against the live API: ${photoRuns.length} selfies of
the same person taken about a minute apart (stepping out of frame between shots), plus the
first file sent twice. ${cfg.quality.toUpperCase()} concerns, ${units} units total. Photos are not in the repo.

${table}

"SD raw" is the measurement noise Proof calibrates for. "Same file twice" shows whether the
model itself is deterministic; if it is near zero, all the noise comes from the capture
(light, angle, expression), which is exactly what Proof's capture checks target.
`;
  writeFileSync(join(ROOT, 'docs', 'noise-study.md'), md);
  console.log('Wrote docs/noise-study.md');
}

// ---- npm run noise:from-scans ----
// Zero extra units: pool the live day-0 calibration sessions the server logged (SCAN_LOG=1,
// set by golive.ps1). Each trial's 3 calibration photos are taken a minute apart with the
// user leaving the frame in between, the same protocol as the 5-photo study above, so the
// within-session spread is the same measurement noise. Two calibrations (6 photos) give 4
// degrees of freedom per concern, as many as 5 photos in one session. What this mode cannot
// do is the "same file twice" determinism check.
function fromScans(logPath) {
  const entries = readScanLog(logPath);
  const sessions = calibrationSessions(entries).filter((s) => s.scans.length >= 2);
  if (!sessions.length) {
    console.error(`No calibration sessions with 2+ live photos in ${logPath}.`);
    console.error('Run the server with SCAN_LOG=1 (golive.ps1 does this) and finish a live calibration first.');
    process.exit(1);
  }
  const rows = pooledNoise(sessions, cfg.concerns);
  const uiRows = pooledNoise(sessions, cfg.concerns, 'ui');
  const df = Math.min(...rows.map((r) => r.df));
  const photos = sessions.reduce((a, s) => a + s.scans.length, 0);
  console.log(`From the server's scan log: ${sessions.length} calibration session(s), ${photos} live photos, ${df} degrees of freedom per concern.\n`);
  const table = [
    '| Concern | Sessions | Photos | Mean raw | SD raw (pooled within session) | SD ui |',
    '|---|---|---|---|---|---|',
    ...rows.map((r, i) => `| ${label(r.concern)} (\`${r.concern}\`) | ${r.sessions} | ${r.photos} | ${Number.isFinite(r.mean) ? r.mean.toFixed(1) : 'n/a'} | ${Number.isFinite(r.sd) ? r.sd.toFixed(2) : 'n/a'} | ${Number.isFinite(uiRows[i].sd) ? uiRows[i].sd.toFixed(2) : 'n/a'} |`),
  ].join('\n');
  console.log(table);
  const snippet = rows.map((r) => `  ${r.concern}: ${Math.max(0.8, Number.isFinite(r.sd) ? r.sd : 0).toFixed(1)},`).join('\n');
  console.log(`\nPaste into public/lib/concerns.js as the noise priors:\n${snippet}\n`);
  if (df < 4) console.log(`Only ${df} degrees of freedom: finish one more live calibration (3 photos) before trusting these. 4 or more matches the 5-photo study.\n`);
  const md = `# YouCam Skin Analysis repeatability study

Run ${new Date().toISOString().slice(0, 10)} with \`npm run noise:from-scans\`: the live day-0 calibration photos
the server logged (${sessions.length} session(s), ${photos} photos of the same person, taken about a minute
apart, leaving the frame between shots). Noise is the SD pooled within each session (each session
is centred on its own mean), ${df} degrees of freedom per concern. ${cfg.quality.toUpperCase()} concerns. No extra
units were spent: these are the calibrations of real trials. Photos are not in the repo.

${table}

"SD raw" is the measurement noise Proof calibrates for. This mode has no "same file twice" check,
so it does not separate model randomness from capture noise; Proof only needs their sum.
`;
  writeFileSync(join(ROOT, 'docs', 'noise-study.md'), md);
  console.log('Wrote docs/noise-study.md');
}
