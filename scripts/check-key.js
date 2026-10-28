// Zero-unit check that YOUCAM_API_KEY works, before anything spends units.
//
//   npm run key:check            uses .env
//   node scripts/check-key.js --mock   same flow against the built-in mock (no network)
//
// Calls (both read-only, documented in docs.perfectcorp.com > Unit system, no units used):
//   GET /s2s/v2.0/credit/feature-cost   v2 Bearer auth, same auth as the skin-analysis calls.
//                                        A 200 here proves the key works for Proof.
//   GET /s2s/v1.0/client/credit         remaining units. Documented under a v1 Bearer scheme,
//                                        so it may refuse a v2 key; that is reported, not fatal.
// Exit code 0 = key works, 1 = no key / rejected / unreachable.

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnv, readConfig } from '../server/config.js';
import { createYouCamClient } from '../server/youcam-client.js';
import { createMockYouCam } from '../server/mock-youcam.js';

export async function checkKey({ client, quality = 'sd', concernCount = 10, log = console.log }) {
  const skus = await client.featureCost();
  const bracket = concernCount <= 4 ? '1~4' : concernCount <= 8 ? '5~8' : concernCount <= 12 ? '9~12' : '13~16';
  const want = `AI Skin Analysis for ${quality.toUpperCase()} ${bracket} concerns`;
  const sku = skus.find((s) => s.description === want);
  log(`Key accepted by YouCam (feature-cost, 0 units).`);
  if (sku) log(`Skin analysis, ${concernCount} ${quality.toUpperCase()} concerns: ${sku.amount} units per photo.`);
  let balance = null;
  try {
    const json = await client.request('GET', '/s2s/v1.0/client/credit', undefined, { retries: 1 });
    const list = Array.isArray(json?.results) ? json.results : [];
    balance = list.reduce((a, r) => a + (Number(r.amount_dec ?? r.amount) || 0), 0);
    log(`Units left: ${balance.toFixed(2)}${list.length ? '' : ' (no unit packs found: redeem the hackathon code in the console)'}.`);
  } catch (err) {
    log(`Units left: could not read (${err.code || err.message}); check the API console if unsure.`);
  }
  return { ok: true, unitsPerScan: sku?.amount ?? null, balance };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  loadDotEnv();
  const cfg = readConfig();
  const mock = process.argv.includes('--mock');
  const apiKey = mock ? 'mock-key' : cfg.apiKey;
  if (!apiKey) {
    console.error('No YOUCAM_API_KEY in .env. Run:  .\\setkey.ps1 YOUR_KEY');
    process.exit(1);
  }
  const client = mock
    ? createYouCamClient({ apiKey, fetchImpl: createMockYouCam({ apiKey }), sleep: async () => {} })
    : createYouCamClient({ apiKey, host: cfg.host });
  try {
    if (mock) console.log('MOCK check (no network):');
    await checkKey({ client, quality: cfg.quality, concernCount: cfg.concerns.length });
  } catch (err) {
    const hints = {
      InvalidApiKey: 'YouCam rejected the key. Copy it again from the API console (no spaces), then rerun setkey.ps1.',
      InactiveApiKey: 'The key exists but is not active yet. Activate it in the API console.',
      ExpiredApiKey: 'The key has expired. Create a new one in the API console.',
    };
    console.error(`Key check failed: ${err.code || 'network'}: ${err.message}`);
    console.error(hints[err.code] || (err.code ? 'Paste this error to Claude.' : 'Could not reach YouCam. Check your internet connection.'));
    process.exit(1);
  }
}
