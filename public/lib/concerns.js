// What Proof knows about each YouCam skin concern.
//
// `noise` is the prior centre for measurement noise (SD of raw_score across back-to-back
// selfies, in points on YouCam's 1-100 raw scale). These are starting assumptions until
// scripts/measure-noise.js is run against the live API; calibration then updates them per user.
//
// `next` lists ingredient classes commonly used for the concern. This is general cosmetic
// information, not medical advice, and Proof never names brands.

export const CONCERNS = {
  acne: {
    label: 'Breakouts',
    youcam: 'acne',
    noise: 2.5,
    blurb: 'Active spots and blemishes.',
    next: ['Salicylic acid (BHA)', 'Benzoyl peroxide', 'Adapalene (an over-the-counter retinoid)', 'Azelaic acid'],
  },
  redness: {
    label: 'Redness',
    youcam: 'redness',
    noise: 2.0,
    blurb: 'Overall flushing and irritation.',
    next: ['Azelaic acid', 'Niacinamide', 'Centella asiatica', 'Ceramide barrier creams'],
  },
  pore: {
    label: 'Pores',
    youcam: 'pore',
    noise: 2.0,
    blurb: 'How visible pores are.',
    next: ['Niacinamide', 'Salicylic acid (BHA)', 'Retinoids'],
  },
  texture: {
    label: 'Texture',
    youcam: 'texture',
    noise: 2.5,
    blurb: 'Smoothness and unevenness.',
    next: ['Glycolic or lactic acid (AHA)', 'Retinoids', 'Gentle chemical exfoliation'],
  },
  wrinkle: {
    label: 'Fine lines',
    youcam: 'wrinkle',
    noise: 3.5,
    blurb: 'Lines and wrinkles across the face.',
    next: ['Retinoids', 'Daily broad-spectrum SPF', 'Peptides'],
  },
  moisture: {
    label: 'Hydration',
    youcam: 'moisture',
    noise: 3.0,
    blurb: 'How hydrated the skin looks.',
    next: ['Hyaluronic acid or glycerin', 'Ceramides', 'An occlusive night cream'],
  },
  oiliness: {
    label: 'Oiliness',
    youcam: 'oiliness',
    noise: 3.0,
    blurb: 'Shine and oil.',
    next: ['Niacinamide', 'Salicylic acid (BHA)', 'Clay masks'],
  },
  radiance: {
    label: 'Radiance',
    youcam: 'radiance',
    noise: 2.5,
    blurb: 'Brightness and glow.',
    next: ['Vitamin C (ascorbic acid)', 'AHAs', 'Daily SPF'],
  },
  age_spot: {
    label: 'Dark spots',
    youcam: 'age_spot',
    noise: 2.5,
    blurb: 'Spots and uneven pigment.',
    next: ['Vitamin C', 'Azelaic acid', 'Tranexamic acid', 'Daily SPF'],
  },
  dark_circle_v2: {
    label: 'Dark circles',
    youcam: 'dark_circle_v2',
    noise: 3.0,
    blurb: 'Shadows under the eyes.',
    next: ['Caffeine eye products (short-term)', 'Retinoid eye creams', 'Daily SPF'],
  },
};

export const DEFAULT_CONCERNS = Object.keys(CONCERNS);

export function noisePrior(concerns = DEFAULT_CONCERNS) {
  const out = {};
  for (const c of concerns) out[c] = CONCERNS[c]?.noise ?? 2.5;
  return out;
}

export function label(concern) {
  return CONCERNS[concern]?.label ?? concern.replace(/_/g, ' ');
}

// Product categories offered on the setup screen and the concerns they usually claim.
export const PRODUCT_TYPES = [
  { id: 'serum', name: 'Serum', claims: ['redness', 'pore'] },
  { id: 'moisturizer', name: 'Moisturizer', claims: ['moisture', 'texture'] },
  { id: 'acne', name: 'Acne treatment', claims: ['acne', 'redness'] },
  { id: 'retinoid', name: 'Retinoid', claims: ['wrinkle', 'texture'] },
  { id: 'vitc', name: 'Vitamin C', claims: ['radiance', 'age_spot'] },
  { id: 'eye', name: 'Eye cream', claims: ['dark_circle_v2'] },
  { id: 'other', name: 'Something else', claims: [] },
];
