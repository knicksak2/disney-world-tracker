# User Photos Operations & Launch Runbook

This runbook covers operational procedures, security configurations, monitoring, launch gates, and disaster recovery for the photo uploads pipeline in Disney World Tracker.

---

## 1. Cloudflare R2 Object Storage Setup

User photos are stored in a private Cloudflare R2 bucket accessed exclusively via S3-compatible APIs using presigned URLs. The bucket is never public.

### Bucket Creation & Scoped Credentials
1. **Create Bucket**:
   - Log into the Cloudflare Dashboard and navigate to **R2** -> **Create bucket**.
   - Name the bucket (e.g. `dwt-photos-prod`).
   - Leave public access **disabled** (no public bucket domain, no `r2.dev` subdomain).
2. **Create Bucket-Scoped API Token**:
   - In Cloudflare Dashboard -> **R2** -> **Manage R2 API Tokens** -> **Create API Token**.
   - Permission: **Object Read & Write**.
   - Scope: Specify the photos bucket only (**Apply to specific buckets only** -> select `dwt-photos-prod`).
   - TTL: Permanent or set an operational rotation calendar.
   - Record the `Access Key ID`, `Secret Access Key`, and Account Endpoint (`https://<account-id>.r2.cloudflarestorage.com`).
3. **Configure Environment**:
   - Set `PHOTO_STORE_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`
   - Set `PHOTO_STORE_BUCKET=dwt-photos-prod`
   - Set `PHOTO_STORE_ACCESS_KEY_ID=<access-key-id>`
   - Set `PHOTO_STORE_SECRET_ACCESS_KEY=<secret-access-key>`
   - Set `PHOTO_STORE_REGION=auto`

### Bucket CORS Policy
Clients upload directly to R2 using presigned PUT URLs. Configure CORS in bucket settings (**Settings** -> **CORS Policy**):
```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["PUT", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

### Lifecycle Rules & Incomplete Multipart Abort
In Cloudflare Dashboard -> Bucket -> **Settings** -> **Object Lifecycle**:
1. **Abort Incomplete Multipart Uploads**:
   - Add rule to abort incomplete multipart uploads after 7 days (or minimum supported interval).
2. **Temporary Upload Prefix Expiry (`u/`)**:
   - Add rule to expire objects under prefix `u/` after 7 days (`PHOTOS_UPLOAD_PREFIX_EXPIRY_DAYS=7`).
   - **Important**: Verify the Cloudflare R2 dashboard supports prefix-based lifecycle rules. If prefix rules are not supported in your tier or dashboard, note that there is no object-storage backstop for stray unmoderated upload writes, and the API sweep worker (`cleanApprovedUploads` and orphan sweep) serves as the primary and only cleanup mechanism.
   - **Invariant Rule (Requirement 8.18 / Property 23)**: `PHOTOS_NEEDS_REVIEW_MAX_AGE_HOURS` (default 120 hours / 5 days) + 24 hours must stay at or below `PHOTOS_UPLOAD_PREFIX_EXPIRY_DAYS * 24` (168 hours / 7 days). 120 + 24 = 144 <= 168. If either variable is tuned, adjust both in tandem.

---

## 2. External AI Moderation Providers

All photos are screened before publication.

### OpenAI Moderation (`omni-moderation-latest`)
- **Key**: Obtain an API key from OpenAI Platform and set `PHOTO_HARM_API_KEY`.
- **Purpose**: Screens all uploaded images (full image and thumbnail) for harmful, illegal, or abusive content.
- **Handling**: Flagged photos are immediately rejected (`harm`).
- **Codes Allow-List (`PHOTO_HARM_INVALID_IMAGE_CODES`)**:
  - Populated strictly from the observed live probe in task 14.5.
  - If empty (default), every HTTP 400 from OpenAI is treated as retryable `harm_bad_request`.
  - When populated from probe observations with stable error codes (e.g. unparseable image bytes), matching 400s result in `invalid_image` rejection rather than endless retries.

### Google Gemini Vision (`gemini-3.5-flash-lite`)
- **Key**: Obtain an API key from Google AI Studio / Google Cloud Console and set `PHOTO_VISION_API_KEY`.
- **Purpose**: Screens food photos to ensure they represent food/drinks, detect prominent faces, and calculate text fraction.
- **Tier Requirement**: **Free tier is for development only; a paid tier is required before public release.** Verify the provider's current data terms and pricing before launch, as user photos are third-party personal data.
- **Model Fallback**: If the primary model `PHOTO_VISION_MODEL` (`gemini-3.5-flash-lite`) returns HTTP 404 (retired model), the system logs `vision_model_unavailable` and falls back once to `PHOTO_VISION_FALLBACK_MODEL` (`gemini-3.1-flash-lite`).

---

## 3. Dedicated Sweep Cron (Photo_Cron)

Housekeeping is driven by an external authenticated cron job on cron-job.org:
- **Endpoint**: `HEAD https://<render-host>/internal/photos/sweep/run` (or `POST`). `HEAD` returns an empty body, avoiding cron-job.org's 8 KB response truncation failure.
- **Authentication**: `x-cron-secret: <PHOTOS_CRON_SECRET>` header. Must be a dedicated secret distinct from all other cron secrets.
- **Crontab**: `5 7,13,19,0 * * *` in timezone `America/New_York` (at most 4 passes per day).
- **Keep-Alive Separation**: The keep-alive pinger (`GET /health`) must **never** call `/internal/photos/sweep/run`. Calling the sweep on a 10-minute cadence would exhaust Neon compute budgets and contend for the single-flight sweep runner.

---

## 4. Operator Queue & Moderation Runbook

### Working the `needs_review` Queue
1. Log into `/admin/photos/review` with `ADMIN_PANEL_USERNAME` / `ADMIN_PANEL_PASSWORD`.
2. Inspect photos escalated due to transient provider timeouts, ambiguous visual scores, or consecutive provider retries.
3. **Time Limit**: An operator must review pending items within **120 hours** (`PHOTOS_NEEDS_REVIEW_MAX_AGE_HOURS`). Any photo remaining in `needs_review` past 120 hours is automatically hard-deleted by the sweep for data hygiene and user privacy.
4. **Decisions**:
   - **Approve**: Promotes upload objects to serving keys (`p/<id>/full.jpg`, `p/<id>/thumb.jpg`) and sets status to `approved`.
   - **Reject**: Promotes nothing, sets status to `rejected`, and schedules upload object cleanup.

### Operator Strike Count & Banning Users
- The system durably records operator removal actions in `photo_upload_strikes` keyed by `user_id`.
- When an operator removes a photo from the admin queue, the removal confirmation modal displays the uploader's strike count.
- The operator can select **Ban uploader** directly from the confirmation modal. Banning sets `users.banned_at`, preventing all subsequent photo initiate requests (`403 photo_uploads_banned`).
- Strike history survives background sweeps: even if the photo row itself is later hard-deleted by the sweep, the uploader's strike count remains intact.

---

## 5. Budget Alerts & Capacity Ceilings

### Budget Alerts
- **Cloudflare**: Set a billing notification in Cloudflare Dashboard for R2 storage usage and Class A/B operations.
- **Google Cloud Platform**: Set a billing budget alert on the GCP billing account associated with the Gemini API project.
- **OpenAI**: Monitor usage and set spend limits in the OpenAI platform dashboard.

### Automatic Upload Ceiling (`PHOTOS_GLOBAL_DAILY_CAP`)
- Default: `2000` uploads per day across all users in America/New_York.
- If daily uploads reach this threshold, `initiate` requests return `503 photo_uploads_disabled` with reason `global_cap`.
- **To raise the ceiling**: Update `PHOTOS_GLOBAL_DAILY_CAP` in Render environment variables and trigger a redeploy/restart.

---

## 6. Monitoring, Logs, and Alerting

Configure log alerting for the following structured events:
1. `photos.harm.bad_request_streak`:
   - **Trigger**: Fired when OpenAI Moderation returns HTTP 400 `PHOTO_HARM_BAD_REQUEST_ALERT_COUNT` (5) times consecutively in a single process.
   - **Action**: Check if OpenAI changed its request schema, image size limits, or format requirements. Check if `PHOTO_HARM_INVALID_IMAGE_CODES` needs updating.
2. `vision_model_unavailable`:
   - **Trigger**: Google Gemini returned HTTP 404 (model retired).
   - **Action**: Update `PHOTO_VISION_MODEL` and `PHOTO_VISION_FALLBACK_MODEL` in Render env to active Gemini flash-lite models.
3. `harm_auth_error`:
   - **Trigger**: OpenAI returned HTTP 401 or 403.
   - **Action**: Rotate or re-enable the OpenAI API key immediately. Moderation is stalled until fixed.
4. `photos.job.crashed`:
   - **Trigger**: An unhandled exception escaped during async moderation or sweep processing (caught by containment wrapper).
   - **Action**: Inspect the error code and stack trace in Render logs; the photo remains in `pending` and will be retried when its lease expires.

---

## 7. Emergency Controls & Kill Switches

In case of abuse, cost spikes, or upstream provider outages, use the environment variables in Render:
- **Total Kill Switch**: `PHOTOS_ENABLED=false`
  - Shuts down all photo endpoints except `GET /photos/config`. Existing images cannot be viewed, and new uploads are refused.
- **Food Upload Kill Switch**: `PHOTOS_FOOD_ENABLED=false`
  - Refuses new food photo uploads while keeping existing food photos viewable and trip photos fully active.
- **Trip Upload Kill Switch**: `PHOTOS_TRIP_ENABLED=false`
  - Refuses new trip photo uploads while keeping food photos active.

---

## 8. Presigned URL Residual Access Window

Per Requirement 15.11, presigned read URLs minted for photos have a fixed lifetime (`PHOTOS_GET_URL_TTL_SECONDS=3600` / 1 hour).
- **Operational Reality**: When a user soft-deletes a photo, unfriends a recap sender, deletes a recap share, or leaves a trip, no new read URLs can be minted. However, URLs already issued to client devices remain cryptographically valid at Cloudflare edge until their 1-hour TTL expires.
- Operators and users must understand this residual window: immediate revocation of already-minted presigned URLs is not possible without invalidating all active presigned URLs via key rotation.

---

## 9. EXIF Policy Flip Procedure

1. Default setting: `PHOTOS_EXIF_POLICY=log` (scans up to `PHOTOS_EXIF_SCAN_BYTES` / 64 KB; logs presence without rejecting).
2. During physical device launch testing (Task 13.10), verify if iOS and Android client-side re-encoders successfully strip EXIF/GPS metadata.
3. If any client platform fails to strip EXIF, do not launch in `log` mode.
4. **Procedure**:
   - Change `PHOTOS_EXIF_POLICY=reject` in Render environment variables.
   - Save and redeploy.
   - Any uploaded photo that retains an APP1 Exif segment will be rejected immediately with `invalid_image`.

---

## 10. Privacy Policy & App Store Compliance Checklist

### Privacy Policy Content
The privacy policy (`docs/privacy-policy.md`) must explicitly disclose:
- Every uploaded photo is transmitted to **OpenAI** for harm moderation.
- Every food photo is additionally transmitted to **Google** for food identification and content screening.
- Photos are stored in a private **Cloudflare R2** bucket.
- Photos that are flagged or reported (including private Trip photos) may be reviewed by human app operators.
- Users can delete their photos at any time and report or block other users.
- Objectionable content is strictly prohibited, and violators will be banned.

### Launch Gate: Public Hosting
- `docs/privacy-policy.md` must be hosted at a publicly reachable URL.
- Set `EXPO_PUBLIC_PRIVACY_POLICY_URL` in the mobile build environment (EAS build) before generating store release builds.
- Fill in the `[Support Contact Email]` placeholder in `docs/privacy-policy.md` with an active support inbox.

### App Store Submission Checklist
- [ ] Published support contact email verified.
- [ ] Statement against objectionable user-generated content present in privacy policy.
- [ ] In-app reporting and blocking mechanisms functional on all public dish photos and shared trip photos.
- [ ] Terms of Service / EULA and Privacy Policy links active in App Store Connect / Google Play Console.

---

## 11. "Verify Before Launch" Verification List

Before public release, the owner must verify the following external parameters (Requirement 21.5):
1. **Cloudflare R2 Free-Tier Limits**: Verify current free-tier terms (10 GB storage, 1M Class A, 10M Class B operations/month).
2. **OpenAI Moderation Pricing & Limits**: Verify endpoint pricing (documented as free at time of writing; verify current terms), rate limits (requests per minute), and image size limits.
3. **Google Gemini Vision Pricing & Data Terms**: Verify Gemini paid-tier pricing, request quotas, and that data terms confirm user-submitted imagery is not used for model training.
4. **Active Model Availability**: Confirm `PHOTO_VISION_MODEL` (`gemini-3.5-flash-lite`) and `PHOTO_VISION_FALLBACK_MODEL` (`gemini-3.1-flash-lite`) remain active and served by Google API.

---

## 12. Key Rotation Procedures

### Rotating Cloudflare R2 Credentials
1. In Cloudflare Dashboard -> **R2** -> **Manage R2 API Tokens**, create a new token scoped to the photos bucket.
2. In Render Dashboard, update `PHOTO_STORE_ACCESS_KEY_ID` and `PHOTO_STORE_SECRET_ACCESS_KEY`.
3. Save changes. Render restarts the API service with the new credentials (zero downtime).
4. Verify photo uploads and reads via test script or admin panel.
5. In Cloudflare Dashboard, revoke the old R2 API token.

### Rotating OpenAI / Gemini API Keys
1. Create a new API key in the provider console (OpenAI Platform or Google AI Studio).
2. Update `PHOTO_HARM_API_KEY` or `PHOTO_VISION_API_KEY` in Render environment variables.
3. Save changes and trigger deploy.
4. Verify by submitting a test upload.
5. Delete/deactivate the old key in the provider console.

### Rotating `PHOTOS_CRON_SECRET`
1. Generate a new high-entropy secret (32+ characters).
2. In cron-job.org, update the `x-cron-secret` header in the Photo_Cron job.
3. In Render Dashboard, update `PHOTOS_CRON_SECRET`.
4. Trigger manual execution from cron-job.org and confirm `202 Accepted` response.
