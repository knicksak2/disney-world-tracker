/**
 * Avatar object-storage adapter.
 *
 * Encapsulates every interaction with the S3-compatible bucket that holds
 * Profile avatar bytes. The rest of the API talks to this module by way of
 * three exported functions — `createAvatarS3Client`, `uploadAvatar`, and
 * `getAvatarPublicUrl` — so the AWS SDK surface area is contained to a
 * single file.
 *
 * Two important design properties:
 *
 *   1. **Hosting agnostic.** No provider name appears in this code: the
 *      bucket is described by a configurable `endpoint` URL, an
 *      `accessKeyId`, and a `secretAccessKey` drawn from `AppConfig`. Any
 *      S3-compatible store (Cloudflare R2, MinIO, Backblaze B2, Wasabi,
 *      etc.) will work without code changes; only the env vars consumed by
 *      `loadConfig()` change.
 *   2. **Path-style addressing.** `forcePathStyle: true` is set so the SDK
 *      issues `<endpoint>/<bucket>/<key>` requests instead of
 *      `<bucket>.<host>/...`. Path-style is the lowest common denominator
 *      across S3-compatible providers and avoids DNS-routing issues with
 *      bucket names that are not valid hostname labels.
 *
 * Validates: Requirements R7.3 (PNG/JPEG storage), R7.7 (size cap), and the
 *            hosting-agnostic constraint from design.md "Key Design
 *            Decisions" (S3-compatible bucket, no provider name in code).
 */

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import type { AppConfig } from '../../config.js';
import type { AvatarMimeType } from './avatarValidation.js';

/**
 * Construct an S3 client configured for the application's avatar bucket.
 *
 * The `region` field is required by the SDK but is meaningless for many
 * S3-compatible providers (R2, MinIO, etc.). We supply `auto` per the
 * convention adopted by Cloudflare R2 and most generic S3 clones; the
 * endpoint URL itself carries the routing information.
 *
 * The returned client is safe to share across the lifetime of the process:
 * the SDK manages its own connection pool, and the credentials object is
 * frozen to avoid accidental in-place mutation by tests or middleware.
 */
export function createAvatarS3Client(s3Config: AppConfig['s3']): S3Client {
  return new S3Client({
    endpoint: s3Config.endpoint,
    region: 'auto',
    credentials: Object.freeze({
      accessKeyId: s3Config.accessKeyId,
      secretAccessKey: s3Config.secretAccessKey,
    }),
    // See module header note (2). Path-style is the lowest common
    // denominator for S3-compatible endpoints.
    forcePathStyle: true,
  });
}

/**
 * Upload `body` to the configured bucket under `key` with the supplied
 * `contentType`. Returns when the underlying PUT completes successfully.
 *
 * The body is a `Uint8Array` because the route handler buffers the multipart
 * file in memory after enforcing the 5 MB cap (R7.7) and after sniffing
 * magic bytes (R7.3). Streaming uploads are intentionally not supported here:
 * we must see the full body to validate the magic-byte signature, so the
 * cost is paid before this function runs.
 *
 * Throws whatever the underlying SDK throws on transport or 4xx/5xx errors;
 * the caller is responsible for translating those into the right
 * `AppError` (typically `internal_error`, since by the time we reach this
 * function the input has already been validated).
 */
export async function uploadAvatar(
  client: S3Client,
  bucket: string,
  key: string,
  body: Uint8Array,
  contentType: AvatarMimeType,
): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      // Cache headers and ACLs are intentionally omitted: hosting-specific
      // bucket policies and CDN configuration handle public access. Adding
      // them here would couple this module to a particular provider.
    }),
  );
}

/**
 * Build the public (or signed-URL-base) URL for an object stored at `key`.
 *
 * Per design.md the avatar URL is published on `ProfileDTO.avatarUrl`, so
 * the client can fetch the image directly without going through the API.
 * The URL format is `<endpoint>/<bucket>/<key>` using the same path-style
 * addressing the upload uses; this matches what every S3-compatible store
 * exposes when the bucket has public-read or signed-URL access. Signed
 * URLs (when needed) are produced by a separate signer using the same
 * client; this helper produces the canonical URL used as the storage key
 * embedded in `profiles.avatar_url`.
 *
 * The `endpoint` is treated as an opaque base URL: trailing slashes are
 * stripped before the bucket and key segments are appended so the result
 * never contains `//` in the path.
 *
 * @param endpoint - The S3-compatible bucket endpoint, e.g.
 *                   `https://example.r2.cloudflarestorage.com`.
 * @param bucket   - The bucket name.
 * @param key      - The object key (typically `avatars/<userId>/<uuid>`).
 * @returns        - A canonical URL pointing at the stored object.
 */
export function getAvatarPublicUrl(
  endpoint: string,
  bucket: string,
  key: string,
): string {
  const normalizedEndpoint = endpoint.replace(/\/+$/u, '');
  const normalizedKey = key.replace(/^\/+/u, '');
  return `${normalizedEndpoint}/${encodeURIComponent(bucket)}/${normalizedKey
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`;
}
