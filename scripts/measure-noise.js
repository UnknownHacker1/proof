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

loadDotEnv();
const cfg = readConfig();
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
