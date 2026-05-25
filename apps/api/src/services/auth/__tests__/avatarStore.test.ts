/**
 * Unit tests for the S3-compatible avatar store helpers.
 *
 * The `uploadAvatar` integration with the real SDK is exercised by the
 * route-level tests against an injected fake client. Here we only cover
 * the deterministic, pure helper `getAvatarPublicUrl` and a smoke test on
 * `createAvatarS3Client` to confirm it accepts the AppConfig shape.
 */

import { describe, expect, it } from 'vitest';

import {
  createAvatarS3Client,
  getAvatarPublicUrl,
} from '../avatarStore.js';

describe('getAvatarPublicUrl', () => {
  it('produces a path-style URL with bucket and key segments', () => {
    expect(
      getAvatarPublicUrl(
        'https://s3.example.com',
        'avatars-bucket',
        'avatars/u1/abc.png',
      ),
    ).toBe('https://s3.example.com/avatars-bucket/avatars/u1/abc.png');
  });

  it('strips trailing slashes from the endpoint', () => {
    expect(
      getAvatarPublicUrl(
        'https://s3.example.com///',
        'b',
        'k',
      ),
    ).toBe('https://s3.example.com/b/k');
  });

  it('strips a leading slash from the key without affecting interior segments', () => {
    expect(
      getAvatarPublicUrl('https://x', 'b', '/avatars/u/k.jpg'),
    ).toBe('https://x/b/avatars/u/k.jpg');
  });

  it('URL-encodes path segments containing reserved characters', () => {
    // The user portion of the key may contain characters that aren't safe
    // in a URL path; encode each segment independently so existing slashes
    // remain meaningful.
    expect(
      getAvatarPublicUrl('https://x', 'bucket', 'avatars/user one/img a.png'),
    ).toBe('https://x/bucket/avatars/user%20one/img%20a.png');
  });

  it('encodes the bucket name', () => {
    expect(
      getAvatarPublicUrl('https://x', 'my bucket', 'k'),
    ).toBe('https://x/my%20bucket/k');
  });
});

describe('createAvatarS3Client', () => {
  it('accepts the AppConfig.s3 shape and returns an S3Client instance', () => {
    const client = createAvatarS3Client({
      endpoint: 'https://s3.example.com',
      bucket: 'avatars',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
    });
    // Sanity: the client exposes the SDK's `send` method. We don't make a
    // network call here.
    expect(typeof (client as { send?: unknown }).send).toBe('function');
  });
});
