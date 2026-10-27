# Proof demo video (sample mode)

| File | What it is |
|---|---|
| `proof-demo.mp4` | 1920x1080, 2:13. The phone screen sits in the middle. Script captions are on the left, narration captions on the right, with an AI scratch voice (Microsoft Edge TTS "Andrew"). |
| `proof-demo-novoice.mp4` | The same picture with the left captions only, no voice. Record your own narration over it. |
| `clips/NN_*.mp4` | One clip per script beat (no audio, no captions), each with its narration as `.narration.mp3`. Use these to splice in your live footage. |
| `proof-demo.srt`, `narration_cues.txt` | Captions for YouTube, and each line with its start time. |

Everything here was recorded in sample mode on the Oct 27 build, after the review fixes: "Improved, with a side effect", "Improved since you started", "steady", "Trend so far", and 66% vs 4.7%.

## Your live shots

Two beats are gold "LIVE SHOT: user records" slates, shaped like the phone so your footage drops into the same spot:
- `04_LIVE-calibration`: day-0 calibration, three photos plus "Your measurement noise". The narration is generic ("some concerns stay steady to a couple of points; others wobble more"). Re-record that line with the real numbers off your screen.
- `05_LIVE-checkin-then-trend`: the first half is a slate for one check-in plus the dim-light warning. The second half is the "Trend so far" screen (from `SUBMISSION/screens/15-trend-so-far.jpg`).

Also: the setup beat (`03`) has no "Live YouCam" chip, because that only appears when the server runs in live mode. The signature check (`08`) says the demo data is unsigned, because Maya is synthetic. On your live trial it will show valid signatures, so that is a good beat to re-shoot with your own trial.

## Swapping a slate for your footage

Trim your phone recording to the slate's length (`narration_cues.txt` has it). Scale it to 572x960 and place it at x=674, y=60, or simply lay it over the slate in any editor. If you'd rather not edit, ask Claude: give it your phone clips and it can re-cut the video. The sources are in `C:\Dev\AI Automation\hackathons\_capture\proof`, and re-cutting takes about 3 minutes.

## Before you upload

Watch it once; no human has yet. The close says "link below". To put the live URL on screen, re-cut with `--live <url>`.
