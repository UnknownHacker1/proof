# Morning steps

Deadline: **Mon Nov 2, 2026, 11:45 AM EST**. Aim to submit by Sunday night. Total hands-on time is about 3.5 hours, spread over two days because of the video (step 8).

| # | Step | Time |
|---|---|---|
| 1 | **Register for the hackathon on Devpost.** Use your USM .edu email if the Rising Star student prize asks for proof of enrollment. | 5 min |
| 2 | **Get the YouCam credit code** from the hackathon page (Resources or the welcome email). | 5 min |
| 3 | **YouCam API console:** sign up, redeem the code, check you have the units (about 1,000), create an API key. | 10 min |
| 4 | **Go live locally.** In PowerShell: `cd "C:\Dev\AI Automation\hackathons\youcam"`, then `.\setkey.ps1 YOUR_KEY` (writes `.env`, checks the key with a free call), then `.\golive.ps1` (free key check, tests, starts in live mode, opens the browser, prints what to do). Start a trial with **Live YouCam** and take **all 3** calibration photos: they double as the noise study (step 5). The server prints YouCam's first reply once and saves it to `noise-study/raw-output.json`; check it is a list of `{type, ui_score, raw_score, mask_urls}`. If the app says the result was missing a concern (`BadResultShape`), copy that terminal output to me: the parser needs a fix before anything else. Any other failure shows YouCam's code in the error box; paste it to me. | 10 min, 42 units |
| 5 | **Noise study (no extra photos).** `golive.ps1` logs every live scan's scores (no photos) to `noise-study/live-scans.jsonl`. After a second live calibration (the video trial in step 8 counts), run `npm run noise:from-scans`: it pools the two calibrations (6 photos, 4 degrees of freedom per concern, the same as the 5-photo study) and writes `docs/noise-study.md`. Then do points 4-6 of the section below. The separate 5-photo study (`npm run noise:measure`) is now only a fallback. | 5 min, 0 extra units |
| 6 | **Public repo.** `.\publish.ps1` creates `UnknownHacker1/proof` (public), pushes `main`, refuses if `.env` or photos are tracked, and prints the Render link. | 2 min |
| 7 | **Deploy on Render (free).** Open the link `publish.ps1` printed (`https://render.com/deploy?repo=https://github.com/UnknownHacker1/proof`). Set `YOUCAM_API_KEY` and `LIVE_ACCESS_CODE` (make up a short code for judges). Wait for the deploy, open `<url>/healthz`, then try one sample trial and one live scan on your phone. | 15 min, 14 units |
| 8 | **Record the video** with `SUBMISSION/video_script.md`. Live calibration on day 1, live check-ins on day 2 (Proof allows one photo per day). Edit to under 2:30, add captions, upload to YouTube as Public or Unlisted. | 90 min, about 70 units |
| 9 | **Fill the placeholders:** `.inish.ps1 -Live <render url> -Video <youtube url> -Code <access code>` fills `README.md`, `SUBMISSION/devpost.md` and `video_script.md`, commits and pushes. Optional true sentence in Inspiration, and the noise line (point 6 below), by hand. | 2 min |
| 10 | **Submit on Devpost:** paste `devpost.md` section by section, upload screenshots from `SUBMISSION/screens/` (02, 03, 04, 15, 13, 08 are the strongest), add the video link, the Built-with tags and the testing instructions. Opt in to Rising Star if it's a checkbox. Submit, then open the public page logged out to check it. | 20 min |

Units used by the end: about 140 of 1,000 (the noise study now reuses the calibration photos). The deployed demo then spends at most 112 a day, and only for trials started with the access code.

## Step 5 in detail: the noise study

**Now the default:** `npm run noise:from-scans` after two live calibrations (see step 5 in the table), then points 4-6 below. Points 1-3 are the old 5-photo fallback.

Proof's error rates (4.7% false improvements, 95.5% power and so on) come from simulations that use the built-in noise priors in `public/lib/concerns.js`. Those are educated guesses. If real noise is 1.5x the guess, the false-improvement rate goes to about 5.8%; at 2x, about 7.3%. This step replaces the guesses with measurements.

1. Take 5 selfies about a minute apart: same spot, same light, step out of frame between shots. Put them in `noise-study/` (gitignored, photos are never committed).
2. Run `npm run noise:measure`. It scans each photo once plus the first one again (84 units), prints a per-concern table, writes `docs/noise-study.md`, and saves YouCam's first raw reply to `noise-study/raw-output.json`.
3. Open `noise-study/raw-output.json` and check the shape matches the docs (a list of `{type, ui_score, raw_score, mask_urls}`). If any photo printed `failed: BadResultShape`, stop and send me that file.
4. Copy each concern's printed value into its `noise:` field in `public/lib/concerns.js`. Only new trials use the new priors; existing trials and the Maya example keep the priors frozen into them, so their verdicts do not shift.
5. Run `npm test`, then `npm run simulate`. If the numbers move, update them in `README.md` (How Proof decides), `SUBMISSION/devpost.md` (hook and table) and the method page in `public/app.js` ("Does it work?"). I can do this part if you paste me the simulate output.
6. Fill the `[[After the live study ...]]` line in `devpost.md` with the measured range, for example "±1.8 to ±4.2 raw points depending on the concern". Commit `docs/noise-study.md`, the priors and the doc changes.

## If something goes wrong

- **401 / InvalidApiKey:** the key was copied with a space, or it's not activated yet in the console.
- **404 on the file endpoint:** the client already falls back to the older path; if it still fails, send me the error text.
- **error_src_face_too_small / lighting errors:** move closer or turn on a light. These cost nothing.
- **Render deploy is slow or asleep:** free instances sleep after 15 minutes idle; the first request takes about 30-50 seconds. Open the site a minute before recording or judging windows.

## Screens and video beats that changed (2026-10-27 review pass)

All files in `SUBMISSION/screens/` were regenerated at 375 px on Oct 27 and match the current app. Two are new: `15-trend-so-far.jpg` (trial home before the final check-in) and `16-sample-trend-card.png` (sample-mode card mid-trial).

If any video was already recorded (Agent 2's sample-mode capture in `demo/` included), retake these beats:

| Beat | What changed |
|---|---|
| 0:00 headline | "Working, with a side effect" is now "Improved, with a side effect". The narration no longer says the serum is "fixing" redness. |
| 0:08 Redness trend | Badge reads "Improved since you started"; the chart marker says "steady", not "proven". Range is the corrected one (+6.9 to +13.5) and the label reads "Range (95%)". |
| 0:08 forest plot | Ranges are wider (corrected for ten concerns). Texture, fine lines, radiance, dark spots and dark circles now read Inconclusive. |
| 1:15 check-in result | Single-photo changes within noise are grey, with a line under the table explaining it. |
| 1:15 trial home | Before the final check-in it says "Trend so far" with no verdicts and neutral colours. The "Sample mode: skip ahead" button moved to the bottom, under the trend. |
| 1:30 verdict cards | Names: Improved since you started, No real change, Worse since you started. A "Proof shows what changed, not why" note sits under the verdicts. |
| 1:50 method page | New numbers: 66% vs 4.7%, "1 in 10 vs 1 in 26" peeking note, noise-prior caveat, "What Proof can't do" section. |
| 2:05 verdict card | Bigger text, footer "Synthetic demo: 12 simulated scans" (sample trials say "Sample mode ... not YouCam"), last line "Shows change since day 0, not its cause". |
| 0:20 home hero | The intro text now ends "runs the product like a small, honest trial" (no "clinical trial"). |
| Any frame of the header | Nav links are taller (44 px tap targets) and wrap to a second line at phone width. |
| Calibration with the camera blocked | The disabled "Take photo" button is gone; only "Upload a photo" shows, above the fold. |
