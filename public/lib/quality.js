// Capture quality, measured in the browser before a photo is sent (and before any units are
// spent). YouCam rejects truly bad photos itself, but a photo can pass and still be a bad
// measurement: a warmer lamp or light from one side moves the scores. Proof checks the photo
// against the documented guidance and against the user's own calibration photos.
//
// All functions take { data: RGBA Uint8ClampedArray, width, height }, so they run in Node tests.

export function analyzePixels({ data, width, height }) {
  const n = width * height;
  const gray = new Float32Array(n);
  let sum = 0;
  let hi = 0;
  let lo = 0;
  let rSum = 0;
  let bSum = 0;
  let left = 0;
  let right = 0;
  let leftN = 0;
  let rightN = 0;
  // Face region: the central oval-ish box where the guide asks the face to be.
  const x0 = Math.floor(width * 0.2);
  const x1 = Math.ceil(width * 0.8);
  const y0 = Math.floor(height * 0.15);
  const y1 = Math.ceil(height * 0.85);
  const mid = width / 2;
  let faceSum = 0;
  let faceN = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      gray[i] = l;
      sum += l;
      if (l >= 250) hi++;
      if (l <= 8) lo++;
      if (x >= x0 && x < x1 && y >= y0 && y < y1) {
        faceSum += l;
        faceN++;
        rSum += r;
        bSum += b;
        if (x < mid) {
          left += l;
          leftN++;
        } else {
          right += l;
          rightN++;
        }
      }
    }
  }
  // Sharpness: variance of the Laplacian over the face region.
  let lapSum = 0;
  let lapSq = 0;
  let lapN = 0;
  for (let y = Math.max(1, y0); y < Math.min(height - 1, y1); y++) {
    for (let x = Math.max(1, x0); x < Math.min(width - 1, x1); x++) {
      const i = y * width + x;
      const lap = gray[i - width] + gray[i + width] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      lapSum += lap;
      lapSq += lap * lap;
      lapN++;
    }
  }
  const lapMean = lapN ? lapSum / lapN : 0;
  const faceLuma = faceN ? faceSum / faceN : sum / n;
  const lm = leftN ? left / leftN : 0;
  const rm = rightN ? right / rightN : 0;
  return {
    luma: faceLuma,
    clipHigh: hi / n,
    clipLow: lo / n,
    sharpness: lapN ? lapSq / lapN - lapMean ** 2 : 0,
    evenness: faceLuma > 0 ? Math.abs(lm - rm) / faceLuma : 0,
    warmth: bSum > 0 ? rSum / bSum : 1,
  };
}

export const LIMITS = {
  darkBlock: 60,
  darkWarn: 85,
  clipBlock: 0.06,
  blurWarn: 18,
  unevenWarn: 0.22,
};

export function assessQuality(m) {
  const issues = [];
  if (m.luma < LIMITS.darkBlock) issues.push({ level: 'block', code: 'dark', message: 'Too dark to measure. Face a window or a bright lamp.' });
  else if (m.luma < LIMITS.darkWarn) issues.push({ level: 'warn', code: 'dim', message: 'A bit dim. More light gives steadier scores.' });
  if (m.clipHigh > LIMITS.clipBlock) issues.push({ level: 'block', code: 'overexposed', message: 'Parts of the photo are blown out. Step back from direct light.' });
  if (m.sharpness < LIMITS.blurWarn) issues.push({ level: 'warn', code: 'blur', message: 'Looks soft. Hold still, or wipe the lens.' });
  if (m.evenness > LIMITS.unevenWarn) issues.push({ level: 'warn', code: 'uneven', message: 'Light is coming from one side. Turn to face it.' });
  return { ok: !issues.some((i) => i.level === 'block'), issues };
}

// Compares a check-in photo with the calibration photos. Returns a weight (1 = same
// conditions) that the trend fit uses, so an off-condition photo counts for less.
export function compareToBaseline(m, baseline) {
  if (!baseline?.length) return { weight: 1, issues: [] };
  const avg = (k) => baseline.reduce((a, b) => a + b[k], 0) / baseline.length;
  const issues = [];
  let weight = 1;
  const bl = avg('luma');
  const lumaShift = (m.luma - bl) / bl;
  if (Math.abs(lumaShift) > 0.25) {
    issues.push({ level: 'warn', code: 'light-changed', message: `Light is ${lumaShift > 0 ? 'brighter' : 'dimmer'} than your day-0 photos. Same spot, same time of day works best.` });
    weight *= 0.6;
  }
  const warmShift = m.warmth - avg('warmth');
  if (Math.abs(warmShift) > 0.15) {
    issues.push({ level: 'warn', code: 'color-changed', message: `The light looks ${warmShift > 0 ? 'warmer' : 'cooler'} than on day 0 (a different lamp?).` });
    weight *= 0.8;
  }
  return { weight, issues, lumaShift, warmShift };
}
