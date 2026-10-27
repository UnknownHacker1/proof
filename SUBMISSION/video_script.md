# Proof: demo video script (2:25)

Target 2:25, hard stop 2:30. Record the screen at phone width (browser devtools device mode at 390 px, or the deployed site on a phone with screen recording). Narration is short on purpose; read it slower than feels natural. Add burned-in captions, since judges often watch muted.

**Plan one day ahead:** Proof allows one photo per day, so do the live calibration (shot 5) on day 1 and the live check-ins (shots 6-7) on day 2 or later. If the dim-light shot comes on another day too, that's fine.

**Before recording:** live key in `.env`, server running in live mode, good light, phone propped at face height. Do the live part twice and keep the cleaner take. If a live call fails on camera, use the backup take or sample mode, and say so in the caption.

| Time | Shot (what's on screen) | Narration |
|---|---|---|
| 0:00-0:08 | Open on the Example report: headline "Improved, with a side effect", then scroll straight to the forest plot. Redness clearly right of the band, hydration left of it. | "Twenty-seven days of selfies, one answer: since starting this serum, redness is better and hydration is worse." |
| 0:08-0:20 | Tap Redness to open the trend chart: dots climbing, the dashed "steady" line at day 18. | "That's Proof. It runs your skincare like a small trial on your own face, with YouCam Skin AI as the measuring instrument." |
| 0:20-0:35 | Home page hero, "Is your skincare actually working?". Cut to a phone selfie of before and after side by side. | "Why not just compare before and after? Because skin scores wobble a few points between two photos taken a minute apart. Track ten concerns and a product that does nothing still looks like it improved something, most of the time." |
| 0:35-0:50 | Setup screen: type "Azelaic acid 10% gel", tap Acne treatment, Breakouts and Redness light up. Pick **Live YouCam**. | "So you start by saying what the product claims to fix. That's your question, decided before you see any results." |
| 0:50-1:15 | **Live.** Calibration: camera view with the oval and the light and blur chips turning green. Take three photos about a minute apart (speed up the waiting 8x). Land on "Your measurement noise" with the bars. | "Day zero: three photos, a minute apart. Your skin can't change in a minute, so any difference between YouCam's scores is pure noise, for your face, your phone, your bathroom light. Here, [read the steadiest and noisiest concern off the screen], so that verdict will take longer." |
| 1:15-1:30 | **Live.** One check-in: the result screen with YouCam's mask overlay and the score table (small changes shown in grey). Then the light warning on a deliberately dim photo ("Light is dimmer than your day-0 photos"). Then the trial home: "Trend so far". | "Every few days you check in. One photo is noisy, so small changes stay grey. Until the last check-in you only see the trend so far: no verdict, because peeking every few days would let luck win." |
| 1:30-1:50 | Back to the Example report (caption: "Synthetic demo trial, clearly labelled in the app"). Show the verdict cards: Redness "Improved since you started", Pores "No real change", Hydration "Worse since you started". Tick "Show the planted true effects": the diamonds land inside the ranges. | "At the final check-in, every concern gets a verdict with a range. 'No real change' is a real answer: the product isn't doing anything you'd notice. This demo trial was simulated with known true effects, and you can check Proof against them." |
| 1:50-2:05 | Method page, the "Does it work?" section. Then a quick frame of the architecture diagram from the README. | "I tested the method on two thousand simulated trials. When the product does nothing, a before-and-after selfie finds an improvement in 66% of them. Proof: under 5%. Under the hood: YouCam's file, task and polling APIs behind a small Node server that keeps the key, caps the units and deletes every task after reading it." |
| 2:05-2:18 | The verdict card, then "Check the scan signatures" showing all scans valid. | "At the end you get a card you can share, a review or a refund request, with a signature on every scan so nobody can quietly edit the numbers." |
| 2:18-2:25 | Home screen with the live URL as a caption. | "Proof. Stop guessing whether your skincare works. Link below." |

## Shot list (to record, in order of convenience)

1. Example report: headline, forest plot, Redness trend, verdict cards, answer-key toggle. (Sample data, record anytime.)
1b. A sample-mode trial at "Trend so far" (skip ahead a few check-ins), for the 1:15 beat if the live trial is too new.
2. Home hero.
3. Before/after selfie pair (any two of your own photos, or skip this and keep the hero on screen).
4. Setup screen with Live YouCam picked.
5. **Live** calibration, three shots plus the noise screen. Real face, real YouCam.
6. **Live** check-in, normal light, mask overlay visible.
7. **Live** check-in with the lamp off, showing the light warning. The warning appears before anything is sent, so tap Retake and it costs nothing. (One check-in per day, so show the warning and retake rather than using it, or record it on a third day.)
8. Method page, "Does it work?".
9. README architecture block (zoom so the text is readable).
10. Verdict card and signature check.

Live shots 5-7 use about 5 scans = 70 units.

## Captions to burn in

- 0:00 "Proof: is your skincare actually working?"
- 0:50 "Live: YouCam AI Skin Analysis"
- 1:30 "Synthetic demo trial (labelled in the app)"
- 1:50 "2,000 simulated trials, product does nothing: before/after finds a win 66% of the time, Proof 4.7%"
- 2:18 "[[LIVE_DEMO_URL]]"

## Checks before uploading

- Length under 2:30. Audio clear with no music under the voice (or quiet, royalty-free music only).
- No API key, `.env` file, or terminal with secrets visible in any frame.
- Upload to YouTube as Public or Unlisted (not Private), then paste the link into Devpost and the README.
