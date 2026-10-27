# Proof

**For anyone who has bought a skincare product and still can't tell if it works, Proof runs it like a small clinical trial on your own face: YouCam Skin AI measures, Proof learns how noisy those measurements are for you, and after 28 days you get a verdict with a range instead of a guess.**

<p>
  <img src="SUBMISSION/screens/02-report-headline.jpg" width="24%" alt="Report headline: Working, with a side effect">
  <img src="SUBMISSION/screens/03-forest-plot.jpg" width="24%" alt="Change since day 0 for ten concerns, with 90% ranges">
  <img src="SUBMISSION/screens/04-verdict-trend.jpg" width="24%" alt="Redness verdict with trend chart and numbers">
  <img src="SUBMISSION/screens/13-calibration-noise.jpg" width="24%" alt="Calibration: measurement noise per concern">
</p>

- **Live demo:** `LIVE_DEMO_URL` (placeholder, see `SUBMISSION/MORNING_STEPS.md`)
- **Video (2:30):** `VIDEO_URL` (placeholder)
- **Devpost write-up:** [`SUBMISSION/devpost.md`](SUBMISSION/devpost.md)

## Why this exists

A before/after selfie compares two noisy numbers. Skin scores move a few points between two photos taken a minute apart (light, angle, expression), so with ten concerns tracked, a product that does nothing still "improves" something most of the time. In Proof's simulation, a before/after comparison finds a fake win in at least one of ten concerns in **66%** of trials where the product does nothing. Proof does it in **1.3%**.

## What it does

1. **Set up.** Name the product and pick up to three things it claims to fix. Those are the pre-registered question.
2. **Calibrate.** Three selfies on day 0, a minute apart. Skin can't change in a minute, so the spread is pure measurement noise for *your* face, camera and room. Proof blends it with typical noise so three photos can't fool it.
3. **Check in** every 2-4 days. Live camera with an oval guide and quality chips (light, glare, blur, evenness), or a file upload. A check-in in different light from day 0 is flagged and counted less.
4. **Verdict per concern:** Working, Real but small, No real change, Slightly worse, Getting worse, or Too early (with how many more check-ins it needs). "No real change" is a real answer: the whole 90% range sits inside ±5 points.
5. **Share** a 1080x1350 verdict card, with a server signature on every scan so an edited result is detectable. "What to try next" lists ingredient classes for anything the product didn't fix, skipping what it already contains. Not medical advice.

A seeded synthetic trial ("Maya", a 10% niacinamide serum) is in the app under **Example**, clearly labelled. It was generated through the real pipeline against the simulated API, and its answer key (the planted true effects) can be shown on the chart.

## Built with YouCam

YouCam Skin AI is the measuring instrument. Every photo is one `skin-analysis` task with 10 SD concerns.

| What | Where |
|---|---|
| File registration, signed upload, task start, polling with backoff, 429 retry, task delete, feature-cost | [`server/youcam-client.js`](server/youcam-client.js) |
| `POST /s2s/v2.0/file` (falls back to the older `/file/skin-analysis` path on 404), `PUT` to the returned URL | `registerFile`, `uploadBytes` |
| `POST /s2s/v2.0/task/skin-analysis` with `dst_actions`, `enable_mask_overlay`, `format: "json"` | `startSkinAnalysis` |
| `GET /s2s/v2.0/task/skin-analysis/{task_id}` until `success` / `error`, engine errors mapped to plain hints | `pollSkinAnalysis`, `ENGINE_HINTS` |
| `POST /s2s/v2.0/task/delete` right after results are read (masks are inlined first) | `deleteTask`, [`server/app.js`](server/app.js) |
| `results.output[]` parsed into `raw_score`, `ui_score`, regions, masks, `skin_age`, `all` | `normalizeSkinOutput` |
| Image rules checked before spending units (short side, type, size) | [`server/app.js`](server/app.js), [`server/image-info.js`](server/image-info.js) |
| Mock YouCam that replies in the exact documented shapes and errors | [`server/mock-youcam.js`](server/mock-youcam.js) |
| Contract notes collected from the official docs | [`docs/youcam-api-notes.md`](docs/youcam-api-notes.md) |

Proof does its statistics on `raw_score` only. The docs say `ui_score` is adjusted upward on purpose as a motivator, which is fine for an app screen but would compress real changes in a trial.

## Quickstart

Node 18.17 or newer. No dependencies to install.

```bash
git clone <repo-url> proof && cd proof
npm start            # http://localhost:3000, sample mode
npm test             # 42 tests
```

To go live, copy `.env.example` to `.env` and set `YOUCAM_API_KEY`. That is the only change. Restart and the badge in the corner says **Live YouCam**.

## Sample mode vs live

| | Sample mode (no key) | Live (`YOUCAM_API_KEY` set) |
|---|---|---|
| Scores | Simulated face with hidden real effects, through the same client code and the documented JSON shapes | YouCam Skin AI |
| Units | 0 | 14 per photo, charged only on success |
| Masks | Placeholder overlays, labelled "sample overlay" | YouCam's masks |
| Skip ahead | Yes, run a 28-day trial in minutes | No |

Each trial is live or sample for its whole life, because mixing them would break the statistics. On a public deploy, set `LIVE_ACCESS_CODE` and only trials started with that code spend units; everyone else gets sample mode. There is also a daily unit ceiling and a per-visitor scan cap (`DAILY_UNIT_BUDGET`, `PER_IP_DAILY_SCANS`).

## Architecture

```
 phone browser (vanilla JS, no build step)
 ├─ camera.js    getUserMedia + oval guide + quality checks, file upload fallback
 ├─ quality.js   light / glare / blur / evenness, compare to day-0 photo
 ├─ stats.js     noise model, robust trend, verdicts, multiple-testing control
 ├─ charts.js    SVG forest plot, trend chart, noise bars
 ├─ card.js      1080x1350 verdict card on canvas
 └─ store.js     trial data in localStorage (photos never leave except to YouCam)
        │  POST /api/analyze  (JPEG bytes, trial mode, day, light level)
        ▼
 node:http server (zero dependencies)
 ├─ image checks before any unit is spent
 ├─ budget guard: daily units, scans per visitor, optional access code
 ├─ youcam-client.js ──► YouCam API  file → PUT → task → poll → delete
 │        or mock-youcam.js (same shapes) in sample mode
 └─ receipts.js  HMAC signature over every set of scores
```

The key never reaches the browser. Photos go browser → server → YouCam and are deleted from YouCam right after the scores come back (`YOUCAM_DELETE_AFTER=1`, the default). Proof itself stores no photos on the server.

## YouCam units

Cost per skin-analysis task depends on how many concerns it asks for (documented brackets: 1-4, 5-8, 9-12, 13-16 concerns cost 9 / 12 / 14 / 16 units in SD and 12 / 16 / 20 / 22 in HD). Proof asks for 10 SD concerns.

| Action | Photos | Units |
|---|---|---|
| One check-in | 1 | 14 |
| Calibration (day 0) | 3 | 42 |
| Full 28-day trial, check-in every 3 days | 12 | 168 |
| Repeatability study (`npm run noise:measure`) | 5 + 1 repeat | 84 |
| Recording the demo video (calibration + one check-in) | 4 | 56 |
| Failed tasks (dark photo, face too small, etc.) | | 0 |

The plan for the hackathon's 1,000 units: about 170 for the study, video and smoke tests, the rest for judges, behind the access code and a 112-unit daily cap.

## How Proof decides

- **Noise:** per concern, from the three calibration photos, shrunk toward a typical value (a scaled inverse chi-square prior, 4 degrees of freedom). It never trusts a noise level below 1 point.
- **Trend, not before/after:** weighted least squares over every check-in, with a day-to-day variance term, Huber weights for outliers, and lighting-based weights.
- **Verdict:** 90% range from a t-distribution. Working if the range clears zero after the multiple-testing correction and the change clears 5 points. No real change if the range sits inside ±5. A hinge change-point (kept only when BIC improves by more than 2) estimates when it started.
- **No fishing:** Holm correction across the claimed concerns, Benjamini-Hochberg across the other ones.

Checked by simulation (`npm run simulate`, 2,000 trials per scenario):

| Scenario | Result |
|---|---|
| Product does nothing: claimed concern called improved | 3.8% |
| Product does nothing: any of 10 concerns called Working | 1.3% (before/after selfie: 65.7%) |
| Real 5-point improvement confirmed by day 27 | 74.2%, median day 18 |
| Real 8-point improvement confirmed by day 27 | 95.5%, median day 12 |
| 90% range contains the true change | 92.0% to 95.3% |

These assume the simulated noise levels. `npm run noise:measure` measures the real ones against the live API and prints new priors for `public/lib/concerns.js`.

## What works, what's mocked, what's next

**Works and is tested:** the full trial flow in the browser at phone width (photos via the upload path; the live camera view is built but untested on a real phone), the statistics engine, the YouCam client against a mock that enforces the documented contract (auth, upload-before-task, mixed SD/HD, unknown concerns, image size, dark light, 429), scan signatures, the budget guard, the verdict card.

**Not yet run against the live API:** no key was available while building. The client follows the docs field by field, and going live is one environment variable, but the first live call is still to come. Noise priors are educated guesses until the repeatability study runs. Mock masks are placeholders.

**Next:** webhooks instead of polling, the JS Camera Kit for guided capture, HD mode for close-up concerns, and a retailer view ("verified results" badges built from signed, opted-in trials).

## Tests

```bash
npm test
```

42 tests: statistics (calibration coverage, false positive control, power, change-point, Holm and BH), the YouCam client (upload flow, polling, retries, error mapping, 404 fallback), the server (mock and live paths, budget, access code, receipts, path traversal), capture quality checks and verdict wording.

## Privacy and safety

Trials live in the browser's localStorage. The server keeps nothing but in-memory counters. Proof is not a medical device and says so on every report and card.

## License

MIT, see [LICENSE](LICENSE).
