import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { calibrationSessions, pooledNoise, readScanLog } from '../server/scan-log.js';
import { createApp } from '../server/app.js';
import { readConfig } from '../server/config.js';
import { createMockYouCam } from '../server/mock-youcam.js';
import { createSubject } from '../public/lib/simulate.js';
import { checkKey } from '../scripts/check-key.js';
import { createYouCamClient } from '../server/youcam-client.js';
import { fakeJpeg } from './helpers.js';

const at = (min) => new Date(Date.UTC(2026, 9, 31, 10, 0) + min * 60e3).toISOString();

test('scan log: day-0 scans split into calibration sessions by subject and time gap', () => {
  const e = [
    { at: at(0), day: 0, subject: 'a', scores: { acne: 70 } },
    { at: at(1), day: 0, subject: 'a', scores: { acne: 72 } },
    { at: at(2), day: 0, subject: 'a', scores: { acne: 74 } },
    { at: at(3), day: 3, subject: 'a', scores: { acne: 99 } }, // a check-in, never noise
    { at: at(600), day: 0, subject: 'a', scores: { acne: 60 } }, // next calibration, hours later
    { at: at(601), day: 0, subject: 'a', scores: { acne: 64 } },
    { at: at(1), day: 0, subject: 'b', scores: { acne: 50 } }, // someone else
  ];
  const s = calibrationSessions(e);
  assert.deepEqual(s.map((x) => x.scans.length), [3, 1, 2]);
  // Pooled within session: (4+0+4) + (4+4) = 16 over (2 + 1) df -> sd = sqrt(16/3).
  const [row] = pooledNoise(s, ['acne']);
  assert.equal(row.df, 3);
  assert.equal(row.photos, 5);
  assert.ok(Math.abs(row.sd - Math.sqrt(16 / 3)) < 1e-9);
});

test('scan log: live scans are logged with scores only when SCAN_LOG is set', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'proof-scanlog-'));
  const log = join(dir, 'live-scans.jsonl');
  const subject = createSubject({ seed: 9 });
  const upstream = createMockYouCam({ apiKey: 'live-key', subjectFor: () => ({ subject }), runningPolls: 0 });
  const cfg = readConfig({ YOUCAM_API_KEY: 'live-key', MOCK_LATENCY_MS: '0', RECEIPT_SECRET: 't', SCAN_LOG: log });
  const server = createServer(createApp(cfg, { fetchImpl: upstream, log: { warn() {}, error() {}, info() {} } }));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (let i = 0; i < 2; i++) {
      const r = await fetch(base + '/api/analyze', { method: 'POST', body: fakeJpeg(960, 1280), headers: { 'x-proof-day': '0', 'x-proof-subject': 's1', 'x-proof-mode': 'live' } });
      assert.equal(r.status, 200);
    }
    const rows = readScanLog(log);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].day, 0);
    assert.equal(rows[0].subject, 's1');
    assert.equal(typeof rows[0].scores.acne, 'number');
    assert.ok(!readFileSync(log, 'utf8').includes('live-key'), 'no key in the log');
    assert.ok(existsSync(join(dir, 'raw-output.json')), 'first live reply kept for the shape check');
    assert.equal(calibrationSessions(rows)[0].scans.length, 2);
  } finally {
    await new Promise((r) => server.close(r));
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(readConfig({}).scanLog, '', 'off by default');
});

test('key check: feature-cost proves the key for free, a bad key fails', async () => {
  const lines = [];
  const good = createYouCamClient({ apiKey: 'k', fetchImpl: createMockYouCam({ apiKey: 'k' }), sleep: async () => {} });
  const r = await checkKey({ client: good, log: (l) => lines.push(l) });
  assert.equal(r.unitsPerScan, 14);
  assert.match(lines.join('\n'), /Units left: could not read/);
  const bad = createYouCamClient({ apiKey: 'wrong', fetchImpl: createMockYouCam({ apiKey: 'k' }), sleep: async () => {} });
  await assert.rejects(checkKey({ client: bad, log: () => {} }), (err) => err.code === 'InvalidApiKey');
});
