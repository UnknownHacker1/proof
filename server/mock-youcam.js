// MOCK MODE. A simulated YouCam API server, implemented as a drop-in `fetch`.
//
// It answers the documented endpoints with the documented JSON shapes (see
// docs/youcam-api-notes.md): file registration with a pre-signed PUT URL, the upload itself,
// task creation, a few `running` polls, then `success` with results.output[] items carrying
// type / raw_score / ui_score / mask_urls plus skin_age, all and resize_image. It also enforces
// the documented failure modes: bad or missing key, unknown concern, mixed SD/HD, upload
// skipped, image below minimum size, too dark, unknown task id.
//
// Scores come from a simulated person (public/lib/simulate.js), so repeated photos of the same
// "face" give consistent numbers with realistic noise. Nothing here talks to the network.

import { imageInfo } from './image-info.js';
import { ALL_SD_CONCERNS, ALL_HD_CONCERNS, fromDstAction } from './youcam-client.js';

const MOCK_STORAGE = 'https://mock-storage.proof.invalid/upload/';
const SD = new Set(ALL_SD_CONCERNS);
const HD = new Set(ALL_HD_CONCERNS);

let counter = 0;
const fakeId = (prefix) => `${prefix}${Date.now().toString(36)}${(++counter).toString(36)}MOCK${Math.random().toString(36).slice(2, 10)}`;

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Documented ui_score behaviour: raw scores are lifted toward a friendlier number.
export function uiFromRaw(raw) {
  return Math.max(1, Math.min(100, Math.round(50 + 0.55 * raw - 0.0015 * (raw - 60) ** 2 + (raw > 85 ? 3 : 0))));
}

// subjectFor(): returns { subject, day, luma } for the current request. `luma` is the mean
// brightness (0-255) the browser measured; dim photos score lower, like the real thing.
export function createMockYouCam({ apiKey = 'mock-key', subjectFor, runningPolls = 2, maskBase = '/mock-mask/' } = {}) {
  const files = new Map();
  const tasks = new Map();
  const log = [];

  async function handle(url, init = {}) {
    const method = (init.method || 'GET').toUpperCase();
    log.push(`${method} ${url}`);

    if (url.startsWith(MOCK_STORAGE)) {
      const id = decodeURIComponent(url.slice(MOCK_STORAGE.length));
      const f = files.get(id);
      if (!f || method !== 'PUT') return new Response('NoSuchUpload', { status: 404 });
      const bytes = init.body instanceof Uint8Array ? init.body : new Uint8Array(await new Response(init.body).arrayBuffer());
      f.uploaded = true;
      f.info = imageInfo(bytes);
      f.size = bytes.byteLength;
      return new Response('', { status: 200 });
    }

    const u = new URL(url);
    const auth = init.headers?.Authorization || init.headers?.authorization;
    if (auth !== `Bearer ${apiKey}`) return json(401, { status: 401, error: 'Invalid API key', error_code: 'InvalidApiKey' });
    const body = init.body ? JSON.parse(init.body) : null;
    const path = u.pathname;

    if (method === 'POST' && (path === '/s2s/v2.0/file' || path === '/s2s/v2.0/file/skin-analysis')) {
      const f = body?.files?.[0];
      if (!f?.content_type || !f?.file_name || !Number.isFinite(f?.file_size)) {
        return json(400, { status: 400, error: 'files[0] needs content_type, file_name, file_size', error_code: 'InvalidParameters' });
      }
      if (f.file_size > 10 * 1024 * 1024) return json(400, { status: 400, error: 'File too large', error_code: 'InvalidParameters' });
      const fileId = fakeId('F');
      files.set(fileId, { meta: f, uploaded: false });
      return json(200, {
        status: 200,
        data: {
          files: [
            {
              content_type: f.content_type,
              file_name: f.file_name,
              file_id: fileId,
              requests: [{ method: 'PUT', url: MOCK_STORAGE + encodeURIComponent(fileId), headers: { 'Content-Length': String(f.file_size), 'Content-Type': f.content_type } }],
            },
          ],
        },
      });
    }

    if (method === 'POST' && path === '/s2s/v2.0/task/skin-analysis') {
      const actions = body?.dst_actions;
      if (!Array.isArray(actions) || !actions.length) return json(400, { status: 400, error: 'dst_actions is required', error_code: 'InvalidParameters' });
      const unknown = actions.find((a) => !SD.has(a) && !HD.has(a));
      if (unknown) return json(400, { status: 400, error: `Not available dst_action ${unknown}`, error_code: 'InvalidParameters' });
      const isHd = actions.some((a) => HD.has(a));
      if (isHd && actions.some((a) => SD.has(a))) return json(400, { status: 400, error: 'cannot mix HD and SD dst_actions', error_code: 'InvalidParameters' });
      const taskId = fakeId('T');
      const file = files.get(body.src_file_id);
      const ctx = subjectFor ? subjectFor() : null;
      let error = null;
      if (!file || !file.uploaded) error = 'unknown_internal_error'; // documented: forgot the PUT
      else if (file.info?.width && Math.min(file.info.width, file.info.height) < (isHd ? 1080 : 480)) error = 'error_below_min_image_size';
      else if (ctx?.luma != null && ctx.luma < 45) error = 'error_lighting_dark';
      else if (ctx?.forceError) error = ctx.forceError;
      tasks.set(taskId, { actions, isHd, polls: 0, error, ctx, overlay: !!body?.miniserver_args?.enable_mask_overlay });
      return json(200, { status: 200, data: { task_id: taskId } });
    }

    const pollMatch = path.match(/^\/s2s\/v2\.0\/task\/skin-analysis\/(.+)$/);
    if (method === 'GET' && pollMatch) {
      const t = tasks.get(decodeURIComponent(pollMatch[1]));
      if (!t) return json(400, { status: 400, error: 'Invalid task ID', error_code: 'InvalidTaskId' });
      t.polls++;
      if (t.polls <= runningPolls) return json(200, { status: 200, data: { task_status: 'running' } });
      if (t.error) return json(200, { status: 200, data: { task_status: 'error', error: t.error, error_message: t.error } });
      return json(200, { status: 200, data: { task_status: 'success', results: { output: buildOutput(t) } } });
    }

    if (method === 'POST' && path === '/s2s/v2.0/task/delete') {
      const existed = tasks.delete(body?.task_id);
      if (!existed) return json(400, { status: 400, error: 'Invalid task ID', error_code: 'InvalidTaskId' });
      return json(200, { status: 200 });
    }

    if (method === 'GET' && path === '/s2s/v2.0/credit/feature-cost') {
      const sku = (d, amount) => ({ description: d, amount, unit: 'result_image', proc_unit: 1, run_task_url: 'https://yce-api-01.makeupar.com/s2s/v2.0/task/skin-analysis' });
      return json(200, {
        status: 200,
        result: {
          next_token: null,
          skus: [
            sku('AI Skin Analysis for SD 1~4 concerns', 9), sku('AI Skin Analysis for SD 5~8 concerns', 12),
            sku('AI Skin Analysis for SD 9~12 concerns', 14), sku('AI Skin Analysis for SD 13~16 concerns', 16),
            sku('AI Skin Analysis for HD 1~4 concerns', 12), sku('AI Skin Analysis for HD 5~8 concerns', 16),
            sku('AI Skin Analysis for HD 9~12 concerns', 20), sku('AI Skin Analysis for HD 13~16 concerns', 22),
          ],
        },
      });
    }

    return json(404, { status: 404, error: `Mock has no route for ${method} ${path}` });
  }

  function buildOutput(t) {
    const { subject, day = 0, luma } = t.ctx || {};
    // Dim light reads as duller, rougher skin: penalty grows below a comfortable 110/255.
    const lightingPenalty = luma != null && luma < 110 ? (110 - luma) / 12 : 0;
    const out = [];
    let sum = 0;
    let n = 0;
    for (const action of t.actions) {
      const concern = fromDstAction(action);
      if (concern === 'skin_type') continue;
      const raw = subject?.concerns?.includes(concern) ? subject.observe(concern, day, { lightingPenalty }) : 40 + Math.random() * 50;
      const rounded = Math.round(raw * 1e4) / 1e4;
      sum += rounded;
      n++;
      const base = { type: action, raw_score: rounded, ui_score: uiFromRaw(rounded), mask_urls: [`${maskBase}${concern}.svg`] };
      if (t.isHd && ['hd_pore', 'hd_wrinkle', 'hd_texture', 'hd_acne'].includes(action)) {
        out.push({ ...base, region: 'whole' });
        const sub = action === 'hd_pore' ? ['forehead', 'nose', 'cheek'] : action === 'hd_wrinkle' ? ['forehead', 'glabellar', 'crowfeet', 'periocular', 'nasolabial', 'marionette'] : [];
        for (const region of sub) {
          const r = Math.max(1, Math.min(99, rounded + (Math.random() - 0.5) * 20));
          out.push({ type: action, region, raw_score: r, ui_score: uiFromRaw(r), mask_urls: [`${maskBase}${concern}.svg`] });
        }
      } else out.push(base);
    }
    const allScore = n ? sum / n : 50;
    out.push({ type: 'skin_age', score: Math.round(18 + (100 - allScore) * 0.55) });
    out.push({ type: 'all', score: allScore });
    out.push({ type: 'resize_image', mask_urls: [`${maskBase}resize.svg`] });
    return out;
  }

  handle.log = log;
  handle.files = files;
  handle.tasks = tasks;
  return handle;
}
