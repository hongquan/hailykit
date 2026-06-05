import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertTrustedDownloadUrl } from '../installer/github';

// ---------------------------------------------------------------------------
// assertTrustedDownloadUrl — only HTTPS GitHub-controlled hosts may be fetched
// ---------------------------------------------------------------------------

test('assertTrustedDownloadUrl accepts github.com and its asset CDNs', () => {
  // Real shapes of browser_download_url and its redirect targets.
  assert.doesNotThrow(() =>
    assertTrustedDownloadUrl('https://github.com/dxsl-org/hailykit/releases/download/v1.0.0/hailykit.zip'));
  assert.doesNotThrow(() =>
    assertTrustedDownloadUrl('https://objects.githubusercontent.com/github-production-release-asset/x'));
  assert.doesNotThrow(() =>
    assertTrustedDownloadUrl('https://release-assets.githubusercontent.com/y'));
});

test('assertTrustedDownloadUrl rejects non-HTTPS', () => {
  assert.throws(() => assertTrustedDownloadUrl('http://github.com/x/y/z.zip'), /untrusted URL host/);
});

test('assertTrustedDownloadUrl rejects foreign hosts', () => {
  assert.throws(() => assertTrustedDownloadUrl('https://evil.example.com/hailykit.zip'), /untrusted URL host/);
  // Look-alike host that merely contains the trusted name as a substring must fail.
  assert.throws(() => assertTrustedDownloadUrl('https://github.com.evil.com/x.zip'), /untrusted URL host/);
  assert.throws(() => assertTrustedDownloadUrl('https://notgithub.com/x.zip'), /untrusted URL host/);
});

test('assertTrustedDownloadUrl rejects malformed URLs', () => {
  assert.throws(() => assertTrustedDownloadUrl('not a url'), /Invalid download URL/);
});
