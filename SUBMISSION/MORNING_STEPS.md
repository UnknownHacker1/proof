# Morning steps

Deadline: **Mon Nov 2, 2026, 11:45 AM EST**. Aim to submit by Sunday night. Total hands-on time is about 3.5 hours, spread over two days because of the video (step 8).

| # | Step | Time |
|---|---|---|
| 1 | **Register for the hackathon on Devpost.** Use your USM .edu email if the Rising Star student prize asks for proof of enrollment. | 5 min |
| 2 | **Get the YouCam credit code** from the hackathon page (Resources or the welcome email). | 5 min |
| 3 | **YouCam API console:** sign up, redeem the code, check you have the units (about 1,000), create an API key. | 10 min |
| 4 | **Go live locally.** In the project folder: `cp .env.example .env`, paste the key after `YOUCAM_API_KEY=`, then `npm start`. The corner badge should say *Live YouCam*. Start a trial with **Live YouCam**, take one calibration photo, check it gets scores. If anything fails, the error box shows YouCam's code; paste it to me. | 10 min, 14 units |
| 5 | **Repeatability study.** Take 5 selfies about a minute apart (same spot, same light, step out of frame between shots), put them in `noise-study/` (gitignored), run `npm run noise:measure`. Paste the printed priors into `public/lib/concerns.js`, run `npm test`, commit `docs/noise-study.md` and the priors. Fill the `[[After the live study ...]]` line in `devpost.md` with the real numbers. | 20 min, 84 units |
| 6 | **Public repo.** Create an empty public GitHub repo named `proof`, then `git remote add origin <url>` and `git push -u origin main`. Check on GitHub that there is no `.env` file. | 10 min |
| 7 | **Deploy on Render (free).** render.com, New, Blueprint, pick the repo (it reads `render.yaml`). Set `YOUCAM_API_KEY` and `LIVE_ACCESS_CODE` (make up a short code for judges). Wait for the deploy, open `<url>/healthz`, then try one sample trial and one live scan on your phone. | 15 min, 14 units |
| 8 | **Record the video** with `SUBMISSION/video_script.md`. Live calibration on day 1, live check-ins on day 2 (Proof allows one photo per day). Edit to under 2:30, add captions, upload to YouTube as Public or Unlisted. | 90 min, about 70 units |
| 9 | **Fill the placeholders:** `LIVE_DEMO_URL`, `VIDEO_URL`, `REPO_URL`, `LIVE_ACCESS_CODE` in `README.md` and `SUBMISSION/devpost.md`. Optional true sentence in Inspiration. Commit and push. | 10 min |
| 10 | **Submit on Devpost:** paste `devpost.md` section by section, upload screenshots from `SUBMISSION/screens/` (02, 03, 04, 13, 08 are the strongest), add the video link, the Built-with tags and the testing instructions. Opt in to Rising Star if it's a checkbox. Submit, then open the public page logged out to check it. | 20 min |

Units used by the end: about 180 of 1,000. The deployed demo then spends at most 112 a day, and only for trials started with the access code.

## If something goes wrong

- **401 / InvalidApiKey:** the key was copied with a space, or it's not activated yet in the console.
- **404 on the file endpoint:** the client already falls back to the older path; if it still fails, send me the error text.
- **error_src_face_too_small / lighting errors:** move closer or turn on a light. These cost nothing.
- **Render deploy is slow or asleep:** free instances sleep after 15 minutes idle; the first request takes about 30-50 seconds. Open the site a minute before recording or judging windows.
