// YouCam API client for AI Skin Analysis (v2.0), written against the documented contract in
// docs/youcam-api-notes.md. The same code runs in live mode (real fetch) and mock mode
// (fetch replaced by the simulated YouCam server in mock-youcam.js), so the mock exercises
// every step: register file, PUT bytes, start task, poll, read results, delete.

export const YOUCAM_HOST = 'https://yce-api-01.makeupar.com';

const SD_CONCERNS = new Set([
  'wrinkle', 'droopy_upper_eyelid', 'droopy_lower_eyelid', 'firmness', 'acne', 'moisture', 'eye_bag',
  'dark_circle_v2', 'age_spot', 'radiance', 'redness', 'oiliness', 'pore', 'texture', 'tear_trough', 'skin_type',
]);
const HD_CONCERNS = new Set([
  'hd_redness', 'hd_oiliness', 'hd_age_spot', 'hd_radiance', 'hd_moisture', 'hd_dark_circle', 'hd_eye_bag',
  'hd_droopy_upper_eyelid', 'hd_droopy_lower_eyelid', 'hd_firmness', 'hd_texture', 'hd_acne', 'hd_pore',
  'hd_wrinkle', 'hd_tear_trough', 'hd_skin_type',
]);
export const ALL_SD_CONCERNS = [...SD_CONCERNS];
export const ALL_HD_CONCERNS = [...HD_CONCERNS];

// Proof stores everything under the SD names; HD requests are translated on the way out.
export function toDstAction(concern, quality = 'sd') {
  if (quality !== 'hd') return concern;
  if (concern === 'dark_circle_v2') return 'hd_dark_circle';
  return 'hd_' + concern;
}

export function fromDstAction(type) {
  if (type === 'hd_dark_circle') return 'dark_circle_v2';
  return type.startsWith('hd_') ? type.slice(3) : type;
}

// Documented unit table: charged per successful task by number of concerns.
export function unitsForSkinAnalysis(count, quality = 'sd') {
  const tiers = quality === 'hd' ? [12, 16, 20, 22] : [9, 12, 14, 16];
  if (count < 1) return 0;
  if (count > 16) throw new Error('At most 16 concerns per task');
  return tiers[Math.ceil(count / 4) - 1];
}

export const MIN_SHORT_SIDE = { sd: 480, hd: 1080 };

// What the engine error codes mean for the person holding the phone.
export const ENGINE_HINTS = {
  error_below_min_image_size: 'The photo is too small. Use the camera at full resolution.',
  error_exceed_max_image_size: 'The photo is too large. Proof resizes before sending, so retake it.',
  BadResultShape: 'YouCam answered, but not in the shape Proof expects, so nothing was saved. Retrying would spend units on the same result; the server log has the raw reply.',
  TaskTimeout: 'YouCam is taking unusually long. Nothing was saved; try again in a minute.',
  error_src_face_too_small: 'Move closer: your face should fill the oval, about two thirds of the frame width.',
  error_src_face_out_of_bound: 'Part of your face is outside the frame. Center it in the oval.',
  error_lighting_dark: 'Too dark. Face a window or a bright lamp and try again.',
  error_no_face: 'No face found. Face the camera straight on, with your forehead visible.',
  error_pose: 'Face the camera straight on and keep your head level.',
  error_face_parsing: 'Your face was hard to read. Remove glasses, push hair back, and retake.',
  exceed_max_filesize: 'The photo file is over 10 MB.',
  error_decode_image: 'The image could not be read. Try a JPG or PNG.',
  unknown_internal_error: 'YouCam had an internal error. Try again in a moment.',
};

export class YouCamError extends Error {
  constructor(message, { code = 'unknown', status = 0, retryable = false, hint, body, spent = 0, taskId = null } = {}) {
    super(message);
    this.name = 'YouCamError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.hint = hint ?? ENGINE_HINTS[code];
    this.body = body;
    // Units YouCam has billed (or may still bill) even though Proof got no usable result.
    this.spent = spent;
    this.taskId = taskId;
  }
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function validateConcerns(concerns) {
  if (!Array.isArray(concerns) || !concerns.length) throw new YouCamError('Pick at least one concern', { code: 'InvalidParameters', status: 400 });
  const hd = concerns.filter((c) => HD_CONCERNS.has(c));
  const sd = concerns.filter((c) => SD_CONCERNS.has(c));
  const unknown = concerns.filter((c) => !HD_CONCERNS.has(c) && !SD_CONCERNS.has(c));
  if (unknown.length) throw new YouCamError(`Not available dst_action ${unknown[0]}`, { code: 'InvalidParameters', status: 400 });
  if (hd.length && sd.length) throw new YouCamError('cannot mix HD and SD dst_actions', { code: 'InvalidParameters', status: 400 });
  if (concerns.length > 16) throw new YouCamError('At most 16 concerns per task', { code: 'InvalidParameters', status: 400 });
  return hd.length ? 'hd' : 'sd';
}

export function createYouCamClient({
  apiKey,
  host = YOUCAM_HOST,
  fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
  pollIntervalMs = 1500,
  maxPollIntervalMs = 4000,
  maxPollMs = 120000,
  maxRetries = 3,
  filePath = '/s2s/v2.0/file',
  legacyFilePath = '/s2s/v2.0/file/skin-analysis',
  now = () => Date.now(),
} = {}) {
  if (!apiKey) throw new Error('YouCam client needs an API key');

  async function request(method, path, body, { retries = maxRetries } = {}) {
    const url = path.startsWith('http') ? path : host + path;
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(url, {
        method,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let json = null;
      const text = await res.text();
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { error: text };
      }
      if (res.status === 429 && attempt < retries) {
        await sleep(1000 * 2 ** attempt); // documented limit is ~5 QPS; back off and retry
        continue;
      }
      if (!res.ok) {
        const code = json?.error_code || (res.status === 401 ? 'InvalidApiKey' : res.status === 429 ? 'TooManyRequests' : `http_${res.status}`);
        throw new YouCamError(json?.error || `YouCam returned HTTP ${res.status}`, {
          code,
          status: res.status,
          retryable: res.status === 429 || res.status >= 500,
          body: json,
        });
      }
      return json;
    }
  }

  async function registerFile({ contentType, fileName, fileSize }) {
    const body = { files: [{ content_type: contentType, file_name: fileName, file_size: fileSize }] };
    let json;
    try {
      json = await request('POST', filePath, body);
    } catch (err) {
      // Older reference pages scope the file endpoint per feature. Same body, same response.
      if (err.status === 404 && legacyFilePath) json = await request('POST', legacyFilePath, body);
      else throw err;
    }
    const file = json?.data?.files?.[0];
    const upload = file?.requests?.[0];
    if (!file?.file_id || !upload?.url) throw new YouCamError('File API response had no file_id or upload URL', { code: 'BadFileResponse', body: json });
    return { fileId: file.file_id, upload };
  }

  async function uploadBytes(upload, bytes, contentType) {
    const headers = { ...(upload.headers || {}) };
    if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) headers['Content-Type'] = contentType;
    // fetch sets Content-Length itself from the body; passing it explicitly is rejected by undici.
    for (const h of Object.keys(headers)) if (h.toLowerCase() === 'content-length') delete headers[h];
    const res = await fetchImpl(upload.url, { method: upload.method || 'PUT', headers, body: bytes });
    if (!res.ok) throw new YouCamError(`Upload to storage failed (HTTP ${res.status})`, { code: 'UploadFailed', status: res.status, retryable: true });
  }

  async function startSkinAnalysis({ fileId, fileUrl, concerns, overlay = true }) {
    validateConcerns(concerns);
    const body = {
      ...(fileId ? { src_file_id: fileId } : { src_file_url: fileUrl }),
      dst_actions: concerns,
      miniserver_args: { enable_mask_overlay: overlay },
      format: 'json',
    };
    const json = await request('POST', '/s2s/v2.0/task/skin-analysis', body);
    const taskId = json?.data?.task_id;
    if (!taskId) throw new YouCamError('Task API response had no task_id', { code: 'BadTaskResponse', body: json });
    return taskId;
  }

  async function pollSkinAnalysis(taskId, { onPoll } = {}) {
    const started = now();
    let interval = pollIntervalMs;
    let polls = 0;
    for (;;) {
      const json = await request('GET', `/s2s/v2.0/task/skin-analysis/${encodeURIComponent(taskId)}`);
      polls++;
      const data = json?.data || {};
      onPoll?.(data.task_status, polls);
      if (data.task_status === 'success') return { data, polls };
      if (data.task_status === 'error') {
        const code = data.error || 'unknown_internal_error';
        throw new YouCamError(data.error_message || code, { code, status: 200, retryable: code === 'unknown_internal_error', body: json });
      }
      if (now() - started > maxPollMs) throw new YouCamError('Skin analysis took too long', { code: 'TaskTimeout', retryable: true });
      await sleep(interval);
      interval = Math.min(maxPollIntervalMs, Math.round(interval * 1.3));
    }
  }

  async function deleteTask(taskId) {
    return request('POST', '/s2s/v2.0/task/delete', { task_id: taskId }, { retries: 1 });
  }

  async function featureCost() {
    const json = await request('GET', '/s2s/v2.0/credit/feature-cost?page_size=20');
    return json?.result?.skus ?? [];
  }

  // The whole flow for one selfie.
  async function analyzeSkin(bytes, { contentType = 'image/jpeg', fileName = 'selfie.jpg', concerns, overlay = true, onPoll } = {}) {
    const quality = validateConcerns(concerns);
    const t0 = now();
    const { fileId, upload } = await registerFile({ contentType, fileName, fileSize: bytes.byteLength ?? bytes.length });
    await uploadBytes(upload, bytes, contentType);
    const t1 = now();
    const taskId = await startSkinAnalysis({ fileId, concerns, overlay });
    const unitsIfDone = unitsForSkinAnalysis(concerns.length, quality);
    let data, polls;
    try {
      ({ data, polls } = await pollSkinAnalysis(taskId, { onPoll }));
    } catch (err) {
      // A task we stopped watching can still finish and be billed, so count it as spent.
      if (err.code === 'TaskTimeout') Object.assign(err, { spent: unitsIfDone, taskId });
      throw err;
    }
    const t2 = now();
    const output = data?.results?.output;
    const unitsCharged = unitsIfDone;
    const norm = normalizeSkinOutput(output);
    const missing = concerns.map(fromDstAction).filter((c) => c !== 'skin_type' && !Number.isFinite(norm.scores[c]));
    if (missing.length) {
      // The task succeeded, so YouCam has billed it, but Proof can't use a partial result.
      throw new YouCamError(`YouCam's result had no score for: ${missing.join(', ')}`, {
        code: 'BadResultShape',
        status: 200,
        spent: unitsCharged,
        taskId,
        body: data,
      });
    }
    return {
      taskId,
      fileId,
      output,
      ...norm,
      polls,
      quality,
      unitsCharged,
      timings: { uploadMs: t1 - t0, analysisMs: t2 - t1, totalMs: t2 - t0 },
    };
  }

  return { request, registerFile, uploadBytes, startSkinAnalysis, pollSkinAnalysis, deleteTask, featureCost, analyzeSkin };
}

// Turns YouCam's result into Proof's per-concern record. raw_score is what Proof tests;
// ui_score is kept for display only because YouCam documents it as adjusted to feel positive.
//
// The documented format:"json" output is a flat array: { type, ui_score, raw_score, mask_urls }.
// The docs show HD sub-regions only inside the ZIP's score_info.json, nested by region name
// ({ "hd_pore": { "whole": {...}, "nose": {...} } }), so that nesting is accepted too, whether it
// arrives as array items or as an object keyed by concern. Anything else is ignored, and
// analyzeSkin fails loudly if a requested concern ends up without a score.
const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
const isScore = (o) => o && typeof o === 'object' && Number.isFinite(num(o.raw_score));

export function normalizeSkinOutput(output) {
  const scores = {};
  const ui = {};
  const masks = {};
  const regions = {};
  const items = Array.isArray(output)
    ? output
    : output && typeof output === 'object'
      ? Object.entries(output).map(([type, v]) => ({ type, ...(v && typeof v === 'object' ? v : {}) }))
      : [];
  for (const item of items) {
    if (!item || typeof item.type !== 'string') continue;
    const concern = fromDstAction(item.type);
    let whole = null;
    if (isScore(item) && (!item.region || item.region === 'whole')) whole = item;
    else if (isScore(item) && item.region) (regions[concern] ||= {})[item.region] = num(item.raw_score);
    if (isScore(item.whole)) whole = { ...item.whole, mask_urls: item.whole.mask_urls || item.mask_urls };
    for (const [k, v] of Object.entries(item)) {
      if (k !== 'whole' && isScore(v)) (regions[concern] ||= {})[k] = num(v.raw_score);
    }
    if (!whole) continue;
    scores[concern] = num(whole.raw_score);
    if (Number.isFinite(num(whole.ui_score))) ui[concern] = num(whole.ui_score);
    const mask = Array.isArray(whole.mask_urls) ? whole.mask_urls[0] : null;
    if (mask) masks[concern] = mask;
  }
  return { scores, ui, masks, regions };
}
