import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePixels, assessQuality, compareToBaseline } from '../public/lib/quality.js';
import { verdictText, trialHeadline, tone } from '../public/lib/copy.js';
import { VERDICTS } from '../public/lib/stats.js';
import { mulberry32 } from '../public/lib/stats.js';

function img(width, height, fn) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const [r, g, b] = fn(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  return { data, width, height };
}

const rng = mulberry32(4);
const textured = (base) => () => {
  const v = base + (rng() - 0.5) * 60;
  return [v * 1.05, v, v * 0.9];
};

test('a well-lit, detailed photo passes', () => {
  const m = analyzePixels(img(120, 160, textured(150)));
  assert.ok(m.luma > 130 && m.luma < 170);
  assert.ok(m.sharpness > 100);
  assert.ok(m.evenness < 0.05);
  const q = assessQuality(m);
  assert.equal(q.ok, true);
  assert.equal(q.issues.length, 0);
});

test('dark, blown-out, flat and side-lit photos are caught', () => {
  assert.equal(assessQuality(analyzePixels(img(120, 160, textured(35)))).issues[0].code, 'dark');
  const blown = assessQuality(analyzePixels(img(120, 160, () => [255, 255, 255])));
  assert.equal(blown.ok, false);
  assert.ok(blown.issues.some((i) => i.code === 'overexposed'));
  const flat = assessQuality(analyzePixels(img(120, 160, () => [150, 140, 130])));
  assert.ok(flat.issues.some((i) => i.code === 'blur'));
  const side = assessQuality(analyzePixels(img(120, 160, (x) => (x < 60 ? [200, 190, 180] : [110, 100, 95]))));
  assert.ok(side.issues.some((i) => i.code === 'uneven'));
});

test('check-ins in different light count for less', () => {
  const base = [{ luma: 150, warmth: 1.1 }, { luma: 148, warmth: 1.12 }];
  assert.equal(compareToBaseline({ luma: 152, warmth: 1.1 }, base).weight, 1);
  const dim = compareToBaseline({ luma: 95, warmth: 1.1 }, base);
  assert.ok(dim.weight < 1);
  assert.equal(dim.issues[0].code, 'light-changed');
  const warm = compareToBaseline({ luma: 150, warmth: 1.45 }, base);
  assert.equal(warm.issues[0].code, 'color-changed');
  assert.equal(compareToBaseline({ luma: 10, warmth: 3 }, []).weight, 1);
});

const row = (over) => ({ concern: 'redness', verdict: VERDICTS.improved, delta: 8.44, deltaPct: 13.2, ci: [3.1, 13.7], onset: { onsetDay: 9 }, ...over });

test('verdict sentences say what happened, with numbers', () => {
  const done = { complete: true };
  const good = verdictText(row(), done);
  assert.equal(good.headline, 'Improved since you started');
  assert.ok(good.body.includes("Redness is up 8.4 points (+13%)"));
  assert.ok(good.body.includes("+3.1"));
  assert.match(good.body, /day 9/);
  const flat = verdictText(row({ concern: 'pore', verdict: VERDICTS.noChange, delta: 0.4, ci: [-2.1, 2.9] }), done);
  assert.equal(flat.headline, 'No real change');
  assert.ok(flat.body.includes("−2.1 and +2.9"));
  const unclear = verdictText(row({ verdict: VERDICTS.tooEarly, reason: 'uncertain', delta: 3, ci: [-1, 7] }), done);
  assert.equal(unclear.headline, 'Inconclusive');
  const none = verdictText({ concern: 'acne', verdict: VERDICTS.tooEarly, reason: 'not-enough-checkins', needed: 1 });
  assert.match(none.body, /1 more check-in before/);
  assert.equal(tone(VERDICTS.worse), 'bad');
});

test('before the final check-in there is a trend, never a verdict', () => {
  const mid = verdictText(row(), { complete: false, finalDay: 27 });
  assert.equal(mid.headline, 'Trend so far');
  assert.equal(mid.tone, 'wait');
  assert.match(mid.body, /day 27/);
  assert.doesNotMatch(mid.body, /Improved/);
  const down = verdictText(row({ verdict: VERDICTS.worse, delta: -7, ci: [-11, -3] }), { complete: false });
  assert.match(down.body, /trending down/);
  const rep = { targets: [row({ fit: {} })], rows: [row({ fit: {} })], complete: false, finalDay: 27 };
  assert.equal(trialHeadline(rep).headline, 'Trend so far');
});

test('trial headline reflects the claimed concerns', () => {
  const rep = (targets, others = [], complete = true) => ({ targets, rows: [...targets, ...others], complete });
  assert.equal(trialHeadline(rep([row(), row({ concern: 'pore' })])).headline, 'Improved since you started');
  assert.equal(trialHeadline(rep([row(), row({ concern: 'pore', verdict: VERDICTS.noChange })])).headline, 'Partly improved');
  assert.equal(trialHeadline(rep([row({ verdict: VERDICTS.noChange })])).headline, 'No real change');
  assert.equal(trialHeadline(rep([row()], [row({ concern: 'moisture', verdict: VERDICTS.worse })])).headline, 'Improved, with a side effect');
  assert.equal(trialHeadline(rep([row({ verdict: VERDICTS.tooEarly, fit: null })], [], false)).headline, 'Too early for a trend');
});

test('suggestions skip what the failed product already contains', async () => {
  const { suggestNext } = await import('../public/lib/concerns.js');
  const a = suggestNext('pore', '10% niacinamide serum');
  assert.deepEqual(a.tried, ['Niacinamide']);
  assert.ok(!a.next.includes('Niacinamide') && a.next.includes('Retinoids'));
  const b = suggestNext('wrinkle', 'Retinol 0.3% night cream');
  assert.deepEqual(b.tried, ['Retinoids']);
  assert.deepEqual(suggestNext('moisture', 'Mystery cream').tried, []);
});
