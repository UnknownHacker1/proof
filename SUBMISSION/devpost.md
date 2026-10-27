# Devpost submission: Proof

Paste section by section into the Devpost form. Items in `[[double brackets]]` get filled in on submission morning (see MORNING_STEPS.md). Delete this line.

---

## Project name

Proof

## Tagline (Devpost "elevator pitch", 200 chars max)

Is your skincare actually working? Proof runs it like a small clinical trial on your own face, with YouCam Skin AI as the instrument and real statistics as the judge.

## Thumbnail

`SUBMISSION/screens/08-verdict-card.png` (crop to 3:2 if Devpost asks)

---

## Description (the main write-up)

**For anyone who has bought a skincare product and still can't tell if it works, Proof measures your skin with YouCam Skin AI, learns how noisy those measurements are for your face and your bathroom light, and after 28 days gives a verdict with a range instead of a guess.**

- Video: [[VIDEO_URL]]
- Live demo: [[LIVE_DEMO_URL]]
- Code: [[REPO_URL]]

### YouCam APIs used

- **AI Skin Analysis (v2), the core of the product.** Every photo Proof takes is one `skin-analysis` task with 10 SD concerns (acne, redness, pores, texture, wrinkles, moisture, oiliness, radiance, age spots, dark circles). Proof turns those scores into a trial: noise calibration, trend, verdict.
- **Endpoints:** `POST /s2s/v2.0/file` and the signed `PUT` upload, `POST /s2s/v2.0/task/skin-analysis` (with `enable_mask_overlay`), `GET /s2s/v2.0/task/skin-analysis/{task_id}` polling, `POST /s2s/v2.0/task/delete`, `GET /s2s/v2.0/credit/feature-cost`.
- **Fields that matter:** `raw_score` drives every statistic. `ui_score` is stored but never tested, because the docs say it is adjusted upward on purpose. Masks show *where* a concern sits on the check-in screen.
- **Cost:** 14 units per photo, 168 for a full 28-day trial. Failed tasks are free, and Proof checks image size and light before spending anything.

### Inspiration

[[Optional: one true sentence about a product you or someone you know couldn't judge. Delete this if there isn't one.]] Most people who buy a serum can't tell a month later whether it did anything. The mirror compares today with a fuzzy memory. Before/after selfies feel scientific but compare two noisy numbers. YouCam's skin scores are good enough to measure with, which made me ask the obvious next question: good enough to *decide* with? Only if you know how much a score moves when nothing changed.

### What it does

1. **Set up.** Name the product and pick up to three things it claims to fix. That is the pre-registered question.
2. **Calibrate.** Three selfies, a minute apart. Skin can't change in a minute, so the spread between scores is measurement noise for *your* face, camera and light. Proof shows it per concern ("Steadiest: pores, ±1.9 points per photo").
3. **Check in** every 2-4 days with a camera view that checks light, glare, blur and evenness live. A photo in different light from day 0 is flagged and counted less, not thrown away.
4. **Get a verdict per concern:** *Working*, *No real change*, *Getting worse*, or *Too early* with how many more check-ins it needs. "No real change" is a real answer: the whole 90% range sits inside ±5 points, so the product is not doing anything you would see.
5. **Share** a verdict card, with a server signature on every scan so edited numbers are detectable. If the product didn't deliver, Proof lists ingredient classes often used for that concern, skipping the ones it already contains. Not medical advice, and it says so.

### How I built it

- **Frontend:** vanilla JavaScript modules, no build step, hand-drawn SVG charts, a canvas verdict card, `getUserMedia` capture with a file-upload fallback. Mobile-first.
- **Server:** zero-dependency Node (`node:http`). It holds the YouCam key, checks images before spending units, enforces a daily unit ceiling, a per-visitor cap and an optional live access code, signs results with HMAC, and deletes the YouCam task as soon as the scores are read.
- **Statistics, written from scratch:** per-concern noise from the calibration photos shrunk toward a typical value; a weighted, outlier-resistant trend over all check-ins with a day-to-day variance term; 90% t-intervals; an equivalence band for "no real change"; a change-point model for when an effect started; Holm correction on the claimed concerns and Benjamini-Hochberg on the rest so a lucky wobble can't count as a win.
- **A mock YouCam** that replies in the exact documented JSON and error shapes, so the whole pipeline ran end to end before I had a key. Going live is one environment variable.

### Challenges I ran into

- **Ten concerns is ten chances to be fooled.** My first version happily reported wins on products that did nothing. Pre-registering the claimed concerns and correcting for the rest fixed it: with no real effect, Proof calls any of ten concerns *Working* in **1.3%** of simulated trials. A before/after selfie does it in **66%**.
- **Being able to say "no".** A plain significance test can only say "not proven yet", never "it doesn't work". The ±5-point equivalence band lets Proof give a real negative answer.
- **Three photos is not much data.** Raw calibration noise from three shots is itself noisy, so Proof blends it with a prior and never trusts a noise level below 1 point.
- **Building against an API I couldn't call yet.** I wrote the client from the docs field by field, then a mock that enforces the same rules (upload before task, no mixing SD and HD, minimum image size, dark-light errors, 429s), and tested the client against it.

### Accomplishments that I'm proud of

- **Measured, not claimed:** 2,000 simulated trials per scenario. False "improved" on the claimed concern when nothing works: **3.8%**. A real 8-point improvement is confirmed by day 27 in **95.5%** of trials (median: clear by day 12). The 90% ranges contain the true change in **92-95%** of trials.
- **42 automated tests** covering the statistics, the YouCam client, the server, capture checks and verdict wording.
- A demo trial generated through the real pipeline with a planted answer key you can reveal on the chart, so you can check Proof against the truth yourself.
- [[After the live study: "Measured YouCam's real photo-to-photo noise: ±X to ±Y raw points depending on the concern, and the same file sent twice gives a difference of Z."]]

### What I learned

The AI score is half of a measurement. The other half is knowing its error bars, and almost nobody computes them. I also learned how much the wording matters: "p = 0.03" means nothing to a user, "even the cautious end of the range is +7.5, so this is not noise" does.

### What's next for Proof

- **Verified results for brands and retailers.** Opted-in, signed trials can roll up into a line like "worked for most people who tested it, here is the range", which is more honest than a star rating and a natural fit for YouCam's eCommerce partners.
- Webhooks instead of polling, the YouCam Camera Kit for guided capture, and HD mode for close-up concerns.
- I left out apparel try-on on purpose: it doesn't help answer "is this working?", and depth on Skin AI mattered more than breadth.

### How it maps to the judging criteria

| Criterion | Where to look |
|---|---|
| Technological implementation | Full YouCam v2 flow with retries, fallbacks and task cleanup; a statistics engine written from scratch; 42 tests; simulation numbers above |
| Design | Mobile-first, one verdict per concern in plain words, charts that show ranges instead of single numbers, a shareable card |
| Potential impact | Every skincare buyer has this question; brands and retailers get a credible "verified results" signal |
| Quality of the idea | Not a wrapper: YouCam is the instrument, the product is the trial design around it |

### Try it out

- Live demo: [[LIVE_DEMO_URL]] (opens in sample mode, no login; **Example** shows a finished 28-day trial)
- Live YouCam scans for judges: start a trial, pick **Live YouCam**, code **[[LIVE_ACCESS_CODE]]**
- Code: [[REPO_URL]]

---

## Built with (Devpost tags)

javascript, node.js, html5, css3, svg, canvas, getusermedia, youcam-api, perfect-corp, ai-skin-analysis, statistics, render

## "Testing instructions" field (if the form has one)

Open [[LIVE_DEMO_URL]]. Tap **Example** for a finished trial, or **Start a 28-day trial** to run one in sample mode (use **Skip ahead** to move through days in seconds; photos can be uploaded instead of taken). For live YouCam scans, choose **Live YouCam** on the setup screen and enter [[LIVE_ACCESS_CODE]]. The free host sleeps when idle, so the first load can take about 30 seconds.
