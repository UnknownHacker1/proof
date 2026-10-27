import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createYouCamClient,
  normalizeSkinOutput,
  unitsForSkinAnalysis,
  validateConcerns,
  toDstAction,
  fromDstAction,
  YouCamError,
} from '../server/youcam-client.js';
import { createMockYouCam } from '../server/mock-youcam.js';
import { imageInfo } from '../server/image-info.js';
import { createSubject } from '../public/lib/simulate.js';
import { DEFAULT_CONCERNS } from '../public/lib/concerns.js';
import { fakeJpeg, fakePng } from './helpers.js';

const noSleep = async () => {};

function setup({ subject = createSubject({ seed: 42 }), day = 0, luma = 140, forceError, runningPolls = 2 } = {}) {
  const fetchImpl = createMockYouCam({ apiKey: 'k', subjectFor: () => ({ subject, day, luma, forceError }), runningPolls });
  const client = createYouCamClient({ apiKey: 'k', fetchImpl, sleep: noSleep });
  return { client, fetchImpl, subject };
}

test('image headers are read without decoding', () => {
  assert.deepEqual(imageInfo(fakePng(720, 960)), { type: 'image/png', width: 720, height: 960 });
  assert.deepEqual(imageInfo(fakeJpeg(1080, 1440)), { type: 'image/jpeg', width: 1080, height: 1440 });
  assert.equal(imageInfo(new Uint8Array([1, 2, 3])).type, null);
});

test('unit table matches the documented tiers', () => {
  assert.equal(unitsForSkinAnalysis(1), 9);
  assert.equal(unitsForSkinAnalysis(4), 9);
  assert.equal(unitsForSkinAnalysis(5), 12);
  assert.equal(unitsForSkinAnalysis(10), 14);
  assert.equal(unitsForSkinAnalysis(16), 16);
  assert.equal(unitsForSkinAnalysis(10, 'hd'), 20);
  assert.throws(() => unitsForSkinAnalysis(17));
});

test('concern validation mirrors the API rules', () => {
  assert.equal(validateConcerns(['acne', 'pore']), 'sd');
  assert.equal(validateConcerns(['hd_acne']), 'hd');
  assert.throws(() => validateConcerns(['acne', 'hd_pore']), /cannot mix HD and SD/);
  assert.throws(() => validateConcerns(['abc123']), /Not available dst_action abc123/);
  assert.equal(toDstAction('dark_circle_v2', 'hd'), 'hd_dark_circle');
  assert.equal(fromDstAction('hd_dark_circle'), 'dark_circle_v2');
  assert.equal(fromDstAction('hd_pore'), 'pore');
});

test('full flow: register, upload, start, poll, read results', async () => {
  const { client, fetchImpl } = setup();
  const polled = [];
  const res = await client.analyzeSkin(fakeJpeg(960, 1280), { concerns: DEFAULT_CONCERNS, onPoll: (s) => polled.push(s) });
  assert.deepEqual(polled, ['running', 'running', 'success']);
  assert.equal(res.unitsCharged, 14);
  assert.equal(res.quality, 'sd');
  const calls = fetchImpl.log.map((l) => l.replace(/\/[A-Za-z0-9]+MOCK[a-z0-9]+/, '/<id>'));
  assert.ok(calls[0].startsWith('POST https://yce-api-01.makeupar.com/s2s/v2.0/file'));
  assert.ok(calls[1].startsWith('PUT https://mock-storage'));
  assert.ok(calls[2].startsWith('POST https://yce-api-01.makeupar.com/s2s/v2.0/task/skin-analysis'));
  assert.ok(calls[3].startsWith('GET https://yce-api-01.makeupar.com/s2s/v2.0/task/skin-analysis/'));
  const n = normalizeSkinOutput(res.output);
  assert.deepEqual(Object.keys(n.scores).sort(), [...DEFAULT_CONCERNS].sort());
  for (const c of DEFAULT_CONCERNS) {
    assert.ok(n.scores[c] >= 1 && n.scores[c] <= 100);
    assert.ok(Number.isInteger(n.ui[c]));
  }
  assert.ok(Number.isFinite(n.all) && Number.isFinite(n.skinAge));
});

test('repeat photos of the same simulated face agree within noise', async () => {
  const { client } = setup({ subject: createSubject({ seed: 9 }) });
  const runs = [];
  for (let i = 0; i < 3; i++) runs.push(normalizeSkinOutput((await client.analyzeSkin(fakeJpeg(960, 1280), { concerns: ['redness'] })).output));
  const vals = runs.map((r) => r.scores.redness);
  assert.ok(Math.max(...vals) - Math.min(...vals) < 15);
});

test('falls back to the feature-scoped file path when /s2s/v2.0/file is missing', async () => {
  const inner = createMockYouCam({ apiKey: 'k', subjectFor: () => ({ subject: createSubject({ seed: 1 }) }) });
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(url);
    if (url.endsWith('/s2s/v2.0/file')) return new Response('{"status":404,"error":"Not found"}', { status: 404 });
    return inner(url, init);
  };
  const client = createYouCamClient({ apiKey: 'k', fetchImpl, sleep: noSleep });
  await client.analyzeSkin(fakeJpeg(960, 1280), { concerns: ['acne'] });
  assert.ok(seen.some((u) => u.endsWith('/s2s/v2.0/file/skin-analysis')));
});

test('documented failures become typed errors with a human hint', async () => {
  const small = setup();
  await assert.rejects(small.client.analyzeSkin(fakeJpeg(320, 400), { concerns: ['acne'] }), (e) => {
    assert.ok(e instanceof YouCamError);
    assert.equal(e.code, 'error_below_min_image_size');
    assert.match(e.hint, /too small/);
    return true;
  });
  const dark = setup({ luma: 30 });
  await assert.rejects(dark.client.analyzeSkin(fakeJpeg(960, 1280), { concerns: ['acne'] }), { code: 'error_lighting_dark' });
  const face = setup({ forceError: 'error_src_face_too_small' });
  await assert.rejects(face.client.analyzeSkin(fakeJpeg(960, 1280), { concerns: ['acne'] }), (e) => /Move closer/.test(e.hint));

  const badKey = createYouCamClient({ apiKey: 'wrong', fetchImpl: createMockYouCam({ apiKey: 'k' }), sleep: noSleep });
  await assert.rejects(badKey.analyzeSkin(fakeJpeg(960, 1280), { concerns: ['acne'] }), { code: 'InvalidApiKey', status: 401 });
});

test('skipping the upload fails the task, as the docs warn', async () => {
  const { client } = setup();
  const { fileId } = await client.registerFile({ contentType: 'image/jpeg', fileName: 'x.jpg', fileSize: 1000 });
  const taskId = await client.startSkinAnalysis({ fileId, concerns: ['acne'] });
  await assert.rejects(client.pollSkinAnalysis(taskId), { code: 'unknown_internal_error' });
});

test('unknown task id and mixed SD/HD are rejected by the server too', async () => {
  const { client } = setup();
  await assert.rejects(client.pollSkinAnalysis('nope'), { code: 'InvalidTaskId', status: 400 });
  await assert.rejects(client.request('POST', '/s2s/v2.0/task/skin-analysis', { src_file_id: 'x', dst_actions: ['acne', 'hd_pore'], format: 'json' }), /cannot mix HD and SD/);
});

test('429 is retried with backoff, then succeeds', async () => {
  const inner = createMockYouCam({ apiKey: 'k', subjectFor: () => ({ subject: createSubject({ seed: 2 }) }) });
  let limited = 2;
  const waits = [];
  const fetchImpl = async (url, init) => {
    if (url.includes('/task/skin-analysis') && init.method === 'POST' && limited-- > 0) return new Response('{"status":429,"error":"Too many requests"}', { status: 429 });
    return inner(url, init);
  };
  const client = createYouCamClient({ apiKey: 'k', fetchImpl, sleep: async (ms) => waits.push(ms) });
  const res = await client.analyzeSkin(fakeJpeg(960, 1280), { concerns: ['acne'] });
  assert.ok(res.taskId);
  assert.deepEqual(waits.slice(0, 2), [1000, 2000]);
});

test('polling gives up with TaskTimeout instead of hanging', async () => {
  let t = 0;
  const fetchImpl = createMockYouCam({ apiKey: 'k', subjectFor: () => ({ subject: createSubject({ seed: 2 }) }), runningPolls: 1e9 });
  const client = createYouCamClient({ apiKey: 'k', fetchImpl, sleep: async (ms) => (t += ms), now: () => t, maxPollMs: 20000 });
  await assert.rejects(client.analyzeSkin(fakeJpeg(960, 1280), { concerns: ['acne'] }), { code: 'TaskTimeout' });
});

test('HD results with sub-regions normalize to the whole-face score', () => {
  const output = [
    { type: 'hd_pore', region: 'whole', raw_score: 49.2, ui_score: 67, mask_urls: ['a'] },
    { type: 'hd_pore', region: 'nose', raw_score: 29.1, ui_score: 58, mask_urls: ['b'] },
    { type: 'hd_dark_circle', raw_score: 80.2, ui_score: 76, mask_urls: ['c'] },
    { type: 'skin_age', score: 29 },
    { type: 'all', score: 28.5 },
    { type: 'resize_image', mask_urls: ['r'] },
  ];
  const n = normalizeSkinOutput(output);
  assert.deepEqual(n.scores, { pore: 49.2, dark_circle_v2: 80.2 });
  assert.deepEqual(n.regions, { pore: { nose: 29.1 } });
  assert.equal(n.skinAge, 29);
  assert.equal(n.all, 28.5);
  assert.equal(n.resized, 'r');
  assert.equal(n.masks.pore, 'a');
});

test('task delete and feature cost endpoints', async () => {
  const { client } = setup();
  const res = await client.analyzeSkin(fakeJpeg(960, 1280), { concerns: ['acne'] });
  assert.deepEqual(await client.deleteTask(res.taskId), { status: 200 });
  await assert.rejects(client.deleteTask(res.taskId), { code: 'InvalidTaskId' });
  const skus = await client.featureCost();
  assert.equal(skus.find((s) => s.description.includes('SD 9~12')).amount, 14);
});
