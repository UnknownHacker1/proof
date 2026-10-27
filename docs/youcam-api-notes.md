# YouCam API notes (what Proof relies on)

Collected 2026-10-27 from the official docs at docs.perfectcorp.com (AI Skin Analysis
reference, File Management reference, Rate Limit, Error Codes, Webhook, FAQ) and the older
single-page reference at yce.perfectcorp.com/document (marked deprecated after v1.9, still
useful for full JSON samples). Everything below is the documented contract; the mock
YouCam server in `server/mock-youcam.js` replies in exactly these shapes.

## Host and auth

- Host: `https://yce-api-01.makeupar.com`
- V2 auth: `Authorization: Bearer <API key>`. No token exchange and no secret key needed for
  v2 calls. (The secret key only matters for the legacy v1 `client/auth` flow.)
- Rate limit: 250 requests / 300 s per IP and per key, about 5 QPS. Over the limit: HTTP 429.

## Skin analysis flow (v2.0)

1. **Register the upload.** `POST /s2s/v2.0/file`
   ```json
   { "files": [ { "content_type": "image/jpeg", "file_name": "selfie.jpg", "file_size": 183422 } ] }
   ```
   Response: `data.files[0].file_id` plus `data.files[0].requests[0]` = `{ method: "PUT", url, headers }`.
   The older reference used the feature-scoped path `POST /s2s/v2.0/file/skin-analysis` with the
   same body and response. Proof uses `/s2s/v2.0/file` and falls back to the scoped path on 404.
2. **Upload the bytes.** `PUT <requests[0].url>` with the returned headers (`Content-Type`,
   `Content-Length`). Skipping this makes the task fail with `unknown_internal_error` or 404.
3. **Start the task.** `POST /s2s/v2.0/task/skin-analysis`
   ```json
   { "src_file_id": "<file_id>", "dst_actions": ["acne", "redness", "pore"], "format": "json",
     "miniserver_args": { "enable_mask_overlay": true } }
   ```
   Response: `{ "status": 200, "data": { "task_id": "..." } }`. `src_file_url` (public URL) can be
   used instead of `src_file_id`.
4. **Poll.** `GET /s2s/v2.0/task/skin-analysis/{task_id}` until `data.task_status` is `success` or
   `error` (`running` before that). The docs warn that a task you stop polling times out, later
   lookups return `InvalidTaskId`, and the units are still consumed. Proof polls every 1.5-3 s.
5. **Clean up (optional).** `POST /s2s/v2.0/task/delete` with `{ "task_id": "..." }` deletes the
   task and its files. Otherwise results are kept 24 h.

## Result shape (`format: "json"`)

```json
{ "status": 200, "data": { "task_status": "success", "results": { "output": [
  { "type": "redness", "raw_score": 72.01, "ui_score": 77, "mask_urls": ["https://..."] },
  { "type": "hd_pore", "region": "nose", "raw_score": 29.1, "ui_score": 58, "mask_urls": ["..."] },
  { "type": "skin_age", "score": 29 },
  { "type": "all", "score": 75.7 },
  { "type": "resize_image", "mask_urls": ["https://..."] }
] } } }
```

- `raw_score`: float 1-100, straight from the model. Higher = healthier.
- `ui_score`: integer 1-100, deliberately adjusted upward "as a psychological motivator".
  **Proof does its statistics on `raw_score` only**, because a motivational transform is not a
  measurement and would compress real changes. `ui_score` is stored but never tested.
- HD concerns with sub-regions (`hd_pore`, `hd_wrinkle`, `hd_texture`, `hd_acne`, `hd_skin_type`)
  come back as one item per `region`; Proof uses `region: "whole"` for the trial and keeps the rest.

## Concerns (`dst_actions`)

- SD: wrinkle, droopy_upper_eyelid, droopy_lower_eyelid, firmness, acne, moisture, eye_bag,
  dark_circle_v2, age_spot, radiance, redness, oiliness, pore, texture, tear_trough, skin_type
- HD: the same list with an `hd_` prefix (`hd_dark_circle` instead of `dark_circle_v2`).
- SD and HD cannot be mixed: `400 { "error": "cannot mix HD and SD dst_actions", "error_code": "InvalidParameters" }`.
- Unknown concern: `400 { "error": "Not available dst_action abc123", "error_code": "InvalidParameters" }`.

Proof's default set (SD, 10 concerns): acne, redness, pore, texture, wrinkle, moisture,
oiliness, radiance, age_spot, dark_circle_v2.

## Image rules

| | SD | HD |
|---|---|---|
| Short side | >= 480 px | >= 1080 px |
| Long side | <= 4096 px (newer page says 2560, auto-resized) | same |
| File | < 10 MB, jpg/jpeg/png | same |

Face width should be over 60% of image width (60-80% recommended), frontal, neutral, eyes
open, mouth closed, forehead visible, even bright light, no glasses or makeup ideally.
Task errors that cost nothing: `error_below_min_image_size`, `error_exceed_max_image_size`,
`error_src_face_too_small`, `error_src_face_out_of_bound`, `error_lighting_dark`,
`error_no_face`, `error_pose`, `error_face_parsing`, `unknown_internal_error`, ...

## Units (cost per skin analysis task, charged only on `success`)

| Concerns in one task | SD | HD |
|---|---|---|
| 1-4 | 9 | 12 |
| 5-8 | 12 | 16 |
| 9-12 | 14 | 20 |
| 13-16 | 16 | 22 |

Live costs can be read from `GET /s2s/v2.0/credit/feature-cost` (Bearer v2).

## Errors at the HTTP layer

- 400 `InvalidParameters`, `CreditInsufficiency`, `BadRequest`; 400 `InvalidTaskId` on poll
- 401 `InvalidApiKey`, `InactiveApiKey`, `ExpiredApiKey`
- 429 too many requests
- 500 `TaskTimeout` on poll
