import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';
import { readConfig } from '../server/config.js';
import { createMockYouCam } from '../server/mock-youcam.js';
import { verifyReceipt, signReceipt, canonical } from '../server/receipts.js';
import { createBudget } from '../server/budget.js';
import { createSubject } from '../public/lib/simulate.js';
import { fakeJpeg } from './helpers.js';

async function start(env, opts) {
  const cfg = readConfig({ MOCK_LATENCY_MS: '0', RECEIPT_SECRET: 'test-secret', ...env });
  const server = createServer(createApp(cfg, { log: { warn() {}, error() {} }, ...opts }));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { cfg, base, close: () => new Promise((r) => server.close(r)) };
}

const post = (base, path, body, headers = {}) => fetch(base + path, { method: 'POST', body, headers });

test('config: no key means mock mode, key means live', () => {
  assert.equal(readConfig({}).mode, 'mock');
  assert.equal(readConfig({ YOUCAM_API_KEY: 'abc' }).mode, 'live');
  assert.equal(readConfig({ YOUCAM_API_KEY: 'abc', PROOF_MODE: 'mock' }).mode, 'mock');
  const hd = readConfig({ YOUCAM_QUALITY: 'hd' });
  assert.ok(hd.dstActions.includes('hd_dark_circle'));
  assert.equal(hd.unitsPerScan, 20);
  assert.equal(readConfig({}).unitsPerScan, 14);
});

test('mock mode: analyze returns scores and a verifiable receipt', async () => {
  const s = await start({});
  try {
    const cfg = await (await fetch(s.base + '/api/config')).json();
    assert.equal(cfg.mode, 'mock');
    assert.equal(cfg.concerns.length, 10);
    const r = await post(s.base, '/api/analyze', fakeJpeg(960, 1280), { 'Content-Type': 'image/jpeg', 'x-proof-subject': 'test-subject', 'x-proof-luma': '140' });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.ok, true);
    assert.equal(j.mode, 'mock');
    assert.equal(j.unitsCharged, 0);
    assert.equal(j.unitsIfLive, 14);
    assert.equal(Object.keys(j.scores).length, 10);
    assert.ok(j.masks.redness.startsWith('/mock-mask/'));
    const v = await (await post(s.base, '/api/verify', JSON.stringify({ receipts: [j.receipt] }))).json();
    assert.equal(v.valid, 1);
    const tampered = structuredClone(j.receipt);
    tampered.payload.scores.redness += 10;
    const v2 = await (await post(s.base, '/api/verify', JSON.stringify({ receipts: [j.receipt, tampered] }))).json();
    assert.equal(v2.valid, 1);
    assert.equal(v2.total, 2);
    assert.match(v2.code, /^[0-9A-F]{10}$/);
  } finally {
    await s.close();
  }
});

test('mock mode: same subject gives consistent scores, small photos are refused for free', async () => {
  const s = await start({});
  try {
    const a = await (await post(s.base, '/api/analyze', fakeJpeg(960, 1280), { 'x-proof-subject': 'same' })).json();
    const b = await (await post(s.base, '/api/analyze', fakeJpeg(960, 1280), { 'x-proof-subject': 'same' })).json();
    assert.ok(Math.abs(a.scores.pore - b.scores.pore) < 15);
    const small = await post(s.base, '/api/analyze', fakeJpeg(300, 400));
    assert.equal(small.status, 422);
    const sj = await small.json();
    assert.equal(sj.code, 'error_below_min_image_size');
    assert.equal(sj.unitsCharged, 0);
    const notImage = await post(s.base, '/api/analyze', new Uint8Array([1, 2, 3, 4]));
    assert.equal(notImage.status, 415);
    const dark = await post(s.base, '/api/analyze', fakeJpeg(960, 1280), { 'x-proof-luma': '20' });
    assert.equal(dark.status, 422);
    assert.equal((await dark.json()).code, 'error_lighting_dark');
  } finally {
    await s.close();
  }
});

test('live mode: key stays server-side, units are budgeted, tasks are deleted', async () => {
  const subject = createSubject({ seed: 5 });
  const upstream = createMockYouCam({ apiKey: 'live-key', subjectFor: () => ({ subject }) , runningPolls: 1 });
  const s = await start({ YOUCAM_API_KEY: 'live-key', DAILY_UNIT_BUDGET: '28', PER_IP_DAILY_SCANS: '10' }, { fetchImpl: upstream });
  try {
    const cfg = await (await fetch(s.base + '/api/config')).json();
    assert.equal(cfg.mode, 'live');
    assert.equal(JSON.stringify(cfg).includes('live-key'), false);
    const one = await (await post(s.base, '/api/analyze', fakeJpeg(960, 1280))).json();
    assert.equal(one.unitsCharged, 14);
    assert.equal(upstream.tasks.size, 0, 'task deleted after reading results');
    await post(s.base, '/api/analyze', fakeJpeg(960, 1280));
    const third = await post(s.base, '/api/analyze', fakeJpeg(960, 1280));
    assert.equal(third.status, 429);
    assert.equal((await third.json()).code, 'budget_exhausted');
    const after = await (await fetch(s.base + '/api/config')).json();
    assert.equal(after.budget.usedUnits, 28);
  } finally {
    await s.close();
  }
});

test('live mode: a rejected key is reported without leaking details', async () => {
  const upstream = createMockYouCam({ apiKey: 'other' });
  const s = await start({ YOUCAM_API_KEY: 'wrong' }, { fetchImpl: upstream });
  try {
    const r = await post(s.base, '/api/analyze', fakeJpeg(960, 1280));
    assert.equal(r.status, 502);
    const j = await r.json();
    assert.equal(j.code, 'InvalidApiKey');
    assert.equal(j.unitsCharged, 0);
  } finally {
    await s.close();
  }
});

test('static files cannot escape the public folder', async () => {
  const s = await start({});
  try {
    const r = await fetch(s.base + '/..%2f..%2fpackage.json');
    assert.ok([403, 404].includes(r.status));
    const mask = await fetch(s.base + '/mock-mask/redness.svg');
    assert.equal(mask.headers.get('content-type'), 'image/svg+xml');
  } finally {
    await s.close();
  }
});

test('receipts: canonical form ignores key order, budget caps per visitor', () => {
  assert.equal(canonical({ b: 1, a: { d: 2, c: 3 } }), canonical({ a: { c: 3, d: 2 }, b: 1 }));
  const r = signReceipt({ scores: { acne: 61.23456 } }, 's');
  assert.ok(verifyReceipt(r, 's'));
  assert.ok(!verifyReceipt(r, 'other'));
  const b = createBudget({ dailyUnits: 1000, perIpScans: 2 });
  b.charge('1.1.1.1', 14);
  b.charge('1.1.1.1', 14);
  assert.equal(b.check('1.1.1.1', 14).reason, 'ip_limit');
  assert.ok(b.check('2.2.2.2', 14).ok);
});
