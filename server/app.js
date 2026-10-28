// HTTP layer. Zero dependencies: node:http plus a small router. The browser never sees the
// YouCam key; every analysis goes through POST /api/analyze.

import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, sep } from 'node:path';
import { createYouCamClient, YouCamError, MIN_SHORT_SIDE, ENGINE_HINTS } from './youcam-client.js';
import { createMockYouCam } from './mock-youcam.js';
import { imageInfo } from './image-info.js';
import { signReceipt, verifyReceipt, trialCode } from './receipts.js';
import { createBudget } from './budget.js';
import { createScanLog } from './scan-log.js';
import { ROOT } from './config.js';
import { timingSafeEqual, createHash } from 'node:crypto';
import { createSubject } from '../public/lib/simulate.js';

const PUBLIC = join(ROOT, 'public');
const MAX_UPLOAD = 10 * 1024 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body) || body instanceof Uint8Array;
  const data = isBuf || typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': isBuf || typeof body === 'string' ? headers['Content-Type'] || 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...headers,
  });
  res.end(data);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('Upload too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (typeof fwd === 'string' && fwd.split(',')[0].trim()) || req.socket.remoteAddress || 'unknown';
}

// Mock mode: one simulated face per browser (x-proof-subject), with a hidden real effect on
// redness and texture so a mock trial ends with something worth reading.
const MOCK_EFFECTS = { redness: { delta: 9, onset: 3, ramp: 12 }, texture: { delta: 6, onset: 6, ramp: 14 } };

function sameSecret(a, b) {
  const h = (s) => createHash('sha256').update(String(s)).digest();
  return timingSafeEqual(h(a), h(b));
}

export function createApp(cfg, { fetchImpl = globalThis.fetch, log = console } = {}) {
  const budget = createBudget({ dailyUnits: cfg.dailyUnitBudget, perIpScans: cfg.perIpDailyScans });
  const subjects = new Map();
  const live = cfg.mode === 'live' ? createYouCamClient({ apiKey: cfg.apiKey, host: cfg.host, fetchImpl }) : null;
  let costCache = null;
  let loggedLiveShape = false;
  const scanLog = createScanLog(cfg.scanLog);

  function subjectFor(id) {
    const key = String(id || 'anon').slice(0, 64);
    if (!subjects.has(key)) {
      if (subjects.size > 500) subjects.delete(subjects.keys().next().value);
      subjects.set(key, createSubject({ seed: key, concerns: cfg.concerns, effects: MOCK_EFFECTS }));
    }
    return subjects.get(key);
  }

  async function inlineMasks(masks, wanted) {
    const out = {};
    for (const c of wanted.slice(0, 3)) {
      const url = masks[c];
      if (!url || !/^https:\/\//.test(url)) continue;
      try {
        const r = await fetchImpl(url);
        if (!r.ok) continue;
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > 1.5 * 1024 * 1024) continue;
        const type = r.headers.get('content-type') || (url.endsWith('.png') ? 'image/png' : 'image/jpeg');
        out[c] = `data:${type};base64,${buf.toString('base64')}`;
      } catch (err) {
        log.warn?.('mask fetch failed', err.message);
      }
    }
    return out;
  }

  async function analyze(req, res) {
    const bytes = await readBody(req, MAX_UPLOAD);
    const info = imageInfo(bytes);
    if (!info.type) return send(res, 415, { ok: false, code: 'unsupported_type', message: 'Send a JPG or PNG photo.' });
    const minSide = MIN_SHORT_SIDE[cfg.quality];
    if (info.width && Math.min(info.width, info.height) < minSide) {
      return send(res, 422, { ok: false, code: 'error_below_min_image_size', message: `Photo is ${info.width}x${info.height}; YouCam needs at least ${minSide}px on the short side.`, hint: ENGINE_HINTS.error_below_min_image_size, unitsCharged: 0 });
    }
    const ip = clientIp(req);
    // Each trial is either live or sample for its whole life (mixing would break the stats).
    // A sample trial on a live server stays simulated; a gated server needs the access code.
    const mode = live && req.headers['x-proof-mode'] !== 'mock' ? 'live' : 'mock';
    if (mode === 'live' && cfg.liveAccessCode && !sameSecret(req.headers['x-proof-access'] || '', cfg.liveAccessCode)) {
      return send(res, 403, { ok: false, code: 'access_code', message: 'That live access code is not right.', hint: 'Check the code on the submission page, or start a new trial in Sample mode (free, no code).' });
    }
    if (mode === 'live') {
      const ok = budget.check(ip, cfg.unitsPerScan);
      if (!ok.ok) return send(res, 429, { ok: false, code: 'budget_exhausted', reason: ok.reason, message: ok.message, hint: 'Switch to sample mode to keep exploring without using units.' });
    }
    const luma = Number(req.headers['x-proof-luma']);
    const day = Math.max(0, Math.min(365, Number(req.headers['x-proof-day']) || 0));
    const wantedMasks = String(req.headers['x-proof-masks'] || '').split(',').map((s) => s.trim()).filter((c) => cfg.concerns.includes(c));

    let client = mode === 'live' ? live : null;
    if (!client) {
      const subject = subjectFor(req.headers['x-proof-subject']);
      const mockFetch = createMockYouCam({ apiKey: 'mock', subjectFor: () => ({ subject, day, luma: Number.isFinite(luma) ? luma : null }) });
      const sleep = (ms) => new Promise((r) => setTimeout(r, Math.min(ms, cfg.mockLatencyMs)));
      client = createYouCamClient({ apiKey: 'mock', fetchImpl: mockFetch, sleep, pollIntervalMs: cfg.mockLatencyMs });
    }

    try {
      const result = await client.analyzeSkin(bytes, { contentType: info.type, fileName: info.type === 'image/png' ? 'selfie.png' : 'selfie.jpg', concerns: cfg.dstActions, overlay: true });
      const norm = result;
      let masks = norm.masks;
      if (mode === 'live') {
        if (!loggedLiveShape) {
          // First live result of this process: keep the raw shape in the log for checking.
          loggedLiveShape = true;
          log.info?.('first live YouCam output:', JSON.stringify(result.output).slice(0, 4000));
          scanLog?.saveRaw(result.output);
        }
        scanLog?.append({ at: new Date().toISOString(), day, subject: String(req.headers['x-proof-subject'] || 'anon').slice(0, 64), units: result.unitsCharged, scores: norm.scores, ui: norm.ui });
        budget.charge(ip, result.unitsCharged);
        if (cfg.deleteAfter) {
          masks = await inlineMasks(norm.masks, wantedMasks);
          client.deleteTask(result.taskId).catch((err) => log.warn?.('task delete failed', err.message));
        }
      }
      const payload = { v: 1, mode, task: result.taskId, at: new Date().toISOString(), scores: norm.scores, quality: result.quality };
      return send(res, 200, {
        ok: true,
        mode,
        taskId: result.taskId,
        scores: norm.scores,
        ui: norm.ui,
        regions: norm.regions,
        masks,
        unitsCharged: mode === 'live' ? result.unitsCharged : 0,
        unitsIfLive: result.unitsCharged,
        polls: result.polls,
        timings: result.timings,
        image: { width: info.width, height: info.height },
        receipt: signReceipt(payload, cfg.receiptSecret),
      });
    } catch (err) {
      if (err instanceof YouCamError) {
        if (err.spent && mode === 'live') {
          // Billed (or may be) by YouCam but unusable: count it, return no scores and no receipt.
          budget.charge(ip, err.spent);
          log.error?.('YouCam result unusable', err.code, err.message, JSON.stringify(err.body ?? null).slice(0, 4000));
          if (err.taskId && cfg.deleteAfter && err.code !== 'TaskTimeout') live.deleteTask(err.taskId).catch(() => {});
          return send(res, 502, { ok: false, code: err.code, message: err.message, hint: err.hint, retryable: err.code === 'TaskTimeout', unitsCharged: err.spent });
        }
        const engine = err.status === 200; // task finished with task_status=error: no units used
        return send(res, engine ? 422 : err.status === 401 ? 502 : err.status >= 400 && err.status < 500 ? 400 : 502, {
          ok: false,
          code: err.code,
          message: err.status === 401 ? 'The server\'s YouCam API key was rejected.' : err.message,
          hint: err.hint,
          retryable: err.retryable,
          unitsCharged: 0,
        });
      }
      throw err;
    }
  }

  async function serveStatic(req, res, pathname) {
    let rel = decodeURIComponent(pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = normalize(join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC + sep) && file !== PUBLIC) return send(res, 403, 'Forbidden');
    try {
      const s = await stat(file);
      if (!s.isFile()) throw new Error('not a file');
      const body = await readFile(file);
      const ext = extname(file);
      return send(res, 200, body, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.json' || ext === '.svg' ? 'public, max-age=300' : 'no-cache' });
    } catch {
      if (!extname(rel)) {
        const body = await readFile(join(PUBLIC, 'index.html'));
        return send(res, 200, body, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
      }
      return send(res, 404, 'Not found');
    }
  }

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://local');
    const { pathname } = url;
    try {
      if (req.method === 'GET' && pathname === '/healthz') return send(res, 200, { ok: true });
      if (req.method === 'GET' && pathname === '/api/config') {
        return send(res, 200, {
          mode: cfg.mode,
          quality: cfg.quality,
          concerns: cfg.concerns,
          unitsPerScan: cfg.unitsPerScan,
          minShortSide: MIN_SHORT_SIDE[cfg.quality],
          budget: cfg.mode === 'live' ? budget.status() : null,
          liveGated: cfg.mode === 'live' && !!cfg.liveAccessCode,
          receiptsEphemeral: cfg.receiptSecretIsEphemeral,
        });
      }
      if (req.method === 'POST' && pathname === '/api/analyze') return await analyze(req, res);
      if (req.method === 'POST' && pathname === '/api/verify') {
        const body = JSON.parse((await readBody(req, 2 * 1024 * 1024)).toString('utf8') || '{}');
        const receipts = Array.isArray(body.receipts) ? body.receipts.slice(0, 200) : [];
        const valid = receipts.filter((r) => verifyReceipt(r, cfg.receiptSecret)).length;
        return send(res, 200, { total: receipts.length, valid, code: trialCode(receipts), live: receipts.filter((r) => r?.payload?.mode === 'live').length });
      }
      if (req.method === 'GET' && pathname === '/api/costs') {
        if (!live) return send(res, 200, { source: 'documented', skus: null });
        if (!costCache || Date.now() - costCache.at > 3600e3) costCache = { at: Date.now(), skus: await live.featureCost() };
        return send(res, 200, { source: 'live', skus: costCache.skus });
      }
      const mask = pathname.match(/^\/mock-mask\/([a-z0-9_]+)\.svg$/);
      if (req.method === 'GET' && mask) return send(res, 200, mockMaskSvg(mask[1]), { 'Content-Type': MIME['.svg'], 'Cache-Control': 'public, max-age=86400' });
      if (req.method === 'GET' || req.method === 'HEAD') return await serveStatic(req, res, pathname);
      return send(res, 405, { ok: false, message: 'Method not allowed' });
    } catch (err) {
      log.error?.(err);
      return send(res, err.status || 500, { ok: false, code: 'server_error', message: err.status === 413 ? 'Photo is over 10 MB.' : 'Something went wrong on the server.' });
    }
  };
}

// Sample overlays for mock mode, shaped roughly like YouCam's per-concern masks on a
// portrait selfie (forehead, cheeks, nose, under-eye). Live mode shows YouCam's real masks.
const MASK_SPOTS = {
  acne: [[38, 62, 4], [62, 64, 3.5], [44, 30, 3], [58, 72, 3]],
  redness: [[34, 60, 11], [66, 60, 11], [50, 58, 6]],
  pore: [[50, 56, 7], [38, 62, 6], [62, 62, 6]],
  texture: [[36, 63, 10], [64, 63, 10], [50, 30, 12]],
  wrinkle: [[50, 27, 14], [28, 47, 4], [72, 47, 4]],
  moisture: [[36, 64, 12], [64, 64, 12]],
  oiliness: [[50, 28, 12], [50, 56, 6], [50, 78, 6]],
  radiance: [[50, 45, 26]],
  age_spot: [[34, 55, 3], [67, 58, 3], [56, 33, 2.5]],
  dark_circle_v2: [[38, 49, 7], [62, 49, 7]],
};

export function mockMaskSvg(concern) {
  const spots = MASK_SPOTS[concern] || [];
  const blobs = spots.map(([x, y, r]) => `<ellipse cx="${x}" cy="${y * 1.333}" rx="${r}" ry="${r * 0.8}" fill="url(#g)"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 133.3" preserveAspectRatio="xMidYMid slice"><defs><radialGradient id="g"><stop offset="0" stop-color="#ff3d7f" stop-opacity=".75"/><stop offset="1" stop-color="#ff3d7f" stop-opacity="0"/></radialGradient></defs>${blobs}</svg>`;
}
