# Privacy Policy

**Effective Date:** October 18, 2026  
**Last Updated:** October 18, 2026

Welcome to **Disney World Tracker** ("the App"). We respect your privacy and are committed to protecting the personal information you share with us. This Privacy Policy explains what data we collect, how it is processed and stored, who it is shared with, and your rights regarding your photos and account data.

---

## 1. Information We Collect

### Account & Profile Data
When you create an account, we collect your email address, display name, and your chosen avatar preset. Your password is cryptographically hashed using Argon2id before storage; we never store plain-text passwords.

### Activity & Trip Data
We store records of experiences you rate, mark completed, or add to your itineraries, along with your friend connections and trip plans.

### User Photos
When you choose to upload photos (food logs, dish photos, or trip album photos), we process and store image files and associated metadata (such as timestamps, dish references, and captions).

---

## 2. Third-Party Service Providers & Processing Disclosures

To operate photo uploads safely and securely, we utilize trusted third-party infrastructure and AI service providers:

1. **Harm Moderation via OpenAI**:
   Every uploaded photo (both full-resolution and thumbnail representations) is automatically transmitted to **OpenAI** (`omni-moderation-latest`) for automated safety and content moderation screening to detect harmful, illicit, or abusive material.
2. **Food Identification & Content Screening via Google**:
   Every food photo uploaded to dish galleries or food logs is additionally transmitted to **Google** (`gemini-3.5-flash-lite` or fallback models) for automated vision evaluation to confirm food/beverage subjects, screen for prominent faces, and detect excessive text.
3. **Encrypted Object Storage via Cloudflare**:
   All user photos are stored in private, access-controlled **Cloudflare** R2 object storage buckets. Images are never publicly accessible; access is granted strictly through temporary, cryptographically signed, short-lived URLs.
4. **Human Operator Review**:
   Photos that are reported by community members or flagged for review by automated filters (including private, members-only Trip photos) may be viewed by the app operator to ensure safety, policy compliance, and community integrity.

---

## 3. Metadata & EXIF / GPS Stripping

Your privacy is protected before photos leave your device:
- The mobile app automatically strips all EXIF metadata (including GPS coordinates, device models, and camera parameters) during local JPEG re-encoding before upload.
- Our backend servers perform automated scans of uploaded image headers to verify that EXIF segments have been removed.

---

## 4. Retention & Deletion Schedules

We retain data only as long as necessary to provide our services and maintain community standards:

- **Approved Photos**: Remain stored until deleted by the user or an organizer of the associated trip.
- **Rejected Photos**: Photos rejected by automated moderation are retained for **24 hours** (`PHOTOS_REJECTED_RETENTION_HOURS`) for audit consistency before automated permanent deletion.
- **Photos Under Review**: Photos escalated to human operator review are retained for a maximum of **120 hours** (`PHOTOS_NEEDS_REVIEW_MAX_AGE_HOURS`). If not approved within this window, they are automatically deleted by the system sweep.
- **Deleted Photos**: When you delete a photo, its database row is marked deleted immediately, preventing further reads. Temporary serving URLs expire within 1 hour (`PHOTOS_GET_URL_TTL_SECONDS`), and underlying storage objects are hard-deleted on the next automated background sweep.
- **Deleted Accounts**: When you delete your account, it is hidden immediately and then permanently erased when a grace period ends (see section 5 for the steps and exactly what is erased and what is kept). The grace period is **30 days** (`ACCOUNT_DELETION_GRACE_DAYS`, default 30). Erasure runs as a background job that works in small batches, so it can finish a few hours after the grace period ends rather than at the exact moment.
- **Database Backups**: Our database host may keep backups of the database for its own recovery purposes. Copies of your data inside those backups are not edited when you delete your account; they age out on the hosting provider's own schedule. We do not state a backup retention period here because it depends on the provider's plan and has not been verified.

---

## 5. Your Controls: Deletion, Reporting, and Blocking

- **Delete Your Photos**: You can delete your own photos at any time from your food log history, the dish gallery viewer, or the trip album. Trip organizers may also remove photos from their trips.
- **Report Content**: If you encounter inappropriate, infringing, or objectionable content, you can tap the **Report** button in the photo viewer. Reports are queued for operator review.
- **Block Users**: You can block any photo uploader directly from the photo viewer without revealing your identity or learning theirs. Blocking immediately hides all present and future photos from that uploader across all galleries, strips, and albums. You can review and unblock users in **You & Crew** -> **Blocked Users**.
- **Delete Your Account**: You can delete your account yourself, without contacting us. In the app, open **You & Crew** -> **Delete account**. If you have uninstalled the app or prefer to use a browser, you can also request deletion on the web at `/account-deletion`. You review what will happen, enter your password, and type `DELETE` to confirm. Sign-in is by email address and password only; the App does not use any third-party sign-in provider (such as Apple or Google), so there is no external sign-in token to revoke.
  - **Grace period**: After you confirm, every device is signed out and your account is hidden from friends and trip members. It is permanently deleted after the grace period (**30 days** by default, the number of days is shown on the confirmation step). **Signing in again with your email and password during the grace period cancels the deletion** and restores your account. Resetting your password during that time also restores it. After the grace period the account cannot be restored.
  - **What is deleted**: your sign-in and profile (email, display name, avatar), your ratings, completions, notes, favorites, pins, friend connections, saved and shared lists, push notification registrations, and your photos. Trips you own are handed to another trip member, or deleted together with their photos if you are the only member. You are removed from trips you only joined.
  - **What is kept, anonymized**: content that other people can see and rely on is kept but shown as "Deleted user", with nothing linking it back to you. This covers comments and captions on shared trips, trip history entries, shares you sent to other people, and shared expense records (so that everyone else's balances stay correct). Reports you filed about photos are also kept without your identity.
  - **After deletion**: the email address becomes available to register again.

---

## 6. User-Generated Content & Code of Conduct

Disney World Tracker is a community dedicated to celebrating visits to Walt Disney World.

### Objectionable Content Policy
Objectionable content is strictly prohibited. You may not upload photos or content that is:
- Defamatory, obscene, pornographic, sexually explicit, or suggestive;
- Violent, threatening, abusive, or promoting hate speech or harassment;
- Infringing upon any third party's intellectual property or privacy rights;
- Deceptive, promotional spam, or unauthorized advertising.

Any content violating these standards will be removed immediately without prior notice. App operators may issue strikes and permanently ban repeat offenders or severe violators from uploading content or using the application.

### Support Contact Information
If you have questions about this Privacy Policy, wish to appeal a content decision, or need to report an urgent safety concern, please contact our support team at:
- **Email:** the support email address configured for this deployment (the SUPPORT_EMAIL setting). The hosted privacy page shows that address as a clickable mail link.

*(Operator note: SUPPORT_EMAIL is required, and the API will not start without a valid, monitored address. No address is written into this document.)*
