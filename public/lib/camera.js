// Selfie capture with a face guide and live quality readout. Falls back to file upload when
// there is no camera (or permission is denied). Output is a portrait 3:4 JPEG sized for
// YouCam (short side at least the documented minimum), plus the quality metrics.

import { analyzePixels, assessQuality } from './quality.js';

const ASPECT = 3 / 4; // width / height, portrait as the docs recommend

function cropToPortrait(srcW, srcH) {
  let w = srcW;
  let h = srcW / ASPECT;
  if (h > srcH) {
    h = srcH;
    w = srcH * ASPECT;
  }
  return { sx: (srcW - w) / 2, sy: (srcH - h) / 2, sw: w, sh: h };
}

function metricsFrom(source, sx, sy, sw, sh) {
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 128;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return analyzePixels(ctx.getImageData(0, 0, c.width, c.height));
}

async function encode(source, crop, minShortSide) {
  const outW = Math.max(minShortSide, Math.min(1080, Math.round(crop.sw)));
  const outH = Math.round(outW / ASPECT);
  const c = document.createElement('canvas');
  c.width = outW;
  c.height = outH;
  const ctx = c.getContext('2d');
  ctx.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, outW, outH);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
  return { blob, width: outW, height: outH, upscaled: crop.sw < minShortSide, previewUrl: URL.createObjectURL(blob) };
}

const chip = (name, state, text) => `<span class="qchip q-${state}" data-q="${name}">${text}</span>`;

function chipsFor(m) {
  const light = m.luma < 60 ? ['bad', 'Too dark'] : m.luma < 85 ? ['warn', 'Dim'] : m.clipHigh > 0.06 ? ['bad', 'Blown out'] : ['ok', 'Light good'];
  const even = m.evenness > 0.22 ? ['warn', 'Light from one side'] : ['ok', 'Even'];
  const sharp = m.sharpness < 18 ? ['warn', 'Soft'] : ['ok', 'Sharp'];
  return chip('light', ...light) + chip('even', ...even) + chip('sharp', ...sharp);
}

export function mountCapture(root, { minShortSide = 480, onShot, shutterLabel = 'Take photo' }) {
  root.innerHTML = `
    <div class="capture">
      <div class="viewfinder">
        <video playsinline muted autoplay></video>
        <svg class="guide" viewBox="0 0 300 400" aria-hidden="true">
          <defs><mask id="oval-cut"><rect width="300" height="400" fill="#fff"/><ellipse cx="150" cy="190" rx="100" ry="138" fill="#000"/></mask></defs>
          <rect width="300" height="400" class="guide-shade" mask="url(#oval-cut)"/>
          <ellipse cx="150" cy="190" rx="100" ry="138" class="guide-oval"/>
        </svg>
        <div class="vf-msg" hidden></div>
      </div>
      <div class="qchips" aria-live="polite"></div>
      <div class="capture-actions">
        <button class="btn btn-primary shutter" type="button" disabled>${shutterLabel}</button>
        <label class="btn btn-quiet upload">Upload a photo<input type="file" accept="image/jpeg,image/png" hidden></label>
      </div>
      <p class="fine capture-tip">Fit your face inside the oval. Forehead visible, no glasses, neutral face.</p>
    </div>`;
  const video = root.querySelector('video');
  const shutter = root.querySelector('.shutter');
  const chips = root.querySelector('.qchips');
  const msg = root.querySelector('.vf-msg');
  const file = root.querySelector('input[type=file]');
  let stream = null;
  let timer = null;
  let stopped = false;

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) return noCamera('This browser has no camera access. Upload a photo instead.');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false });
      if (stopped) return stop();
      video.srcObject = stream;
      await video.play().catch(() => {});
      shutter.disabled = false;
      timer = setInterval(meter, 450);
    } catch (err) {
      noCamera(err?.name === 'NotAllowedError' ? 'Camera permission was declined. You can upload a photo instead.' : 'No camera found. Upload a photo instead.');
    }
  }

  function noCamera(text) {
    msg.hidden = false;
    msg.textContent = text;
    root.querySelector('.viewfinder').classList.add('no-camera');
    shutter.hidden = true;
    root.querySelector('.upload').classList.replace('btn-quiet', 'btn-primary');
  }

  function meter() {
    if (!video.videoWidth) return;
    const crop = cropToPortrait(video.videoWidth, video.videoHeight);
    chips.innerHTML = chipsFor(metricsFrom(video, crop.sx, crop.sy, crop.sw, crop.sh));
  }

  async function finish(source, srcW, srcH, origin) {
    const crop = cropToPortrait(srcW, srcH);
    const metrics = metricsFrom(source, crop.sx, crop.sy, crop.sw, crop.sh);
    const verdict = assessQuality(metrics);
    const shot = await encode(source, crop, minShortSide);
    onShot({ ...shot, metrics, quality: verdict, origin });
  }

  shutter.addEventListener('click', async () => {
    if (!video.videoWidth) return;
    shutter.disabled = true;
    root.querySelector('.viewfinder').classList.add('flash');
    setTimeout(() => root.querySelector('.viewfinder')?.classList.remove('flash'), 300);
    await finish(video, video.videoWidth, video.videoHeight, 'camera');
    shutter.disabled = false;
  });

  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    const img = new Image();
    img.src = URL.createObjectURL(f);
    await img.decode();
    await finish(img, img.naturalWidth, img.naturalHeight, 'upload');
    file.value = '';
  });

  function stop() {
    stopped = true;
    clearInterval(timer);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  start();
  return { stop };
}
