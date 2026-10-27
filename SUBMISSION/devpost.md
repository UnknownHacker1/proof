# Devpost submission: Proof

Paste section by section into the Devpost form. Items in `[[double brackets]]` get filled in on submission morning (see MORNING_STEPS.md). Delete this line.

---

## Project name

Proof

## Tagline (Devpost "elevator pitch", 200 chars max)

Is your skincare actually working? Proof runs it like a small trial on your own face, with YouCam Skin AI as the instrument and real statistics as the judge.

## Thumbnail

`SUBMISSION/screens/08-verdict-card.png` (crop to 3:2 if Devpost asks)

---

## Description (the main write-up, about 450 words)

**Four weeks into a new serum, most people still can't tell if it works. Proof measures your skin with YouCam Skin AI, learns how noisy those measurements are for your face and light, and gives a verdict with a range. With a product that does nothing, a before/after selfie finds a fake improvement 66% of the time. Proof: 4.7%.**

Video: [[VIDEO_URL]] · Live demo: [[LIVE_DEMO_URL]] · Code: [[REPO_URL]]

### YouCam APIs used

- **AI Skin Analysis (v2) is the instrument.** Every photo is one `skin-analysis` task with 10 SD concerns, through the full file, upload, task, poll and delete flow.
- **`raw_score`, not `ui_score`.** The docs say `ui_score` is lifted on purpose as a motivator, which would squash real changes in a trial.
- **Masks** show where a concern sits. **Units:** 14 per photo, 168 per trial, with image checks before anything is spent.
- [[After the live study: "Measured YouCam's real photo-to-photo noise: ±X to ±Y raw points depending on the concern."]]

### What it does

1. **Set up:** name the product and pick up to three things it claims to fix.
2. **Calibrate:** three selfies a minute apart. Skin can't change in a minute, so the spread is measurement noise for *your* face and room.
3. **Check in** every few days with a camera that checks light, glare and blur. Photos in different light count less.
4. **Trend so far** until the final check-in, then one verdict per concern: *Improved since you started*, *Small improvement*, *No real change*, *Slightly worse*, *Worse since you started* or *Inconclusive*. "No real change" is a real answer.
5. **Share** a verdict card with signed scans. If the product didn't deliver, Proof suggests ingredient classes it doesn't already contain. Not medical advice.

### Why trust the verdict

2,000 simulated trials per scenario, verdict at the final check-in:

| | Proof | Before/after |
|---|---|---|
| Product does nothing: any of 10 concerns "improved" | 4.7% | 65.7% |
| Real 8-point improvement caught | 95.5% | |
| Real 5-point improvement caught | 74.2% | |
| Range contains the true change | 92-95% | |

Three things make it work: noise measured per person, a trend over every check-in instead of two photos, and multiple-testing correction with ranges widened to match. Waiting for the final check-in matters too: a verdict at every check-in would more than double the false alarms. The honest limits: there is no control group, so Proof shows change since you started, not its cause, and steady lighting drift can still fake a "worse" (8% in simulation).

### How I built it

- Zero-dependency Node server and vanilla JS front end. The server holds the key, caps units, signs results, deletes each YouCam task after reading it, and fails loudly if a result is missing a concern instead of guessing.
- The hardest part was letting the app say "no": a ±5-point equivalence band turns "not proven" into "No real change".

### What's next

"Verified results" for brands and retailers built from signed, opted-in trials; HD mode for close-up concerns; webhooks instead of polling.

---

## Built with (Devpost tags)

javascript, node.js, html5, css3, svg, canvas, getusermedia, youcam-api, perfect-corp, ai-skin-analysis, statistics, render

## "Testing instructions" field (if the form has one)

Open [[LIVE_DEMO_URL]]. Tap **Example** for a finished, clearly labelled synthetic trial, or **Start a 28-day trial** to run one in sample mode (use **Sample mode: skip ahead** to move through days in seconds; photos can be uploaded instead of taken). For live YouCam scans, choose **Live YouCam** on the setup screen and enter [[LIVE_ACCESS_CODE]]. The free host sleeps when idle, so the first load can take about 30 seconds.
