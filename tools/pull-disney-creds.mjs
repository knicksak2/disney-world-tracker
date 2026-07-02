// Local one-off: pull Disney Sync Gateway Basic-auth credentials out of the
// mousetools `environments.bin` blob and write them into apps/api/.env.
//
// - Never prints the credential values.
// - Only rewrites the two DISNEY_SYNC_GATEWAY_USERNAME / _PASSWORD lines.
// - .env is gitignored, so values never enter version control.
//
// Re-run this if Disney rotates the credentials.
//
//   node tools/pull-disney-creds.mjs

import crypto from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ENV_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'apps',
  'api',
  '.env',
);
const BIN_URL =
  'https://gitlab.com/caratozzoloxyz/public/MouseTools/-/raw/master/mousetools/resources/environments.bin';

// Key/nonce derivation, ported from mousetools/auth.py (_e/_b).
function deriveKey() {
  const pi = String(Math.PI); // "3.141592653589793"
  let s = '';
  for (let i = 1; i <= 16; i++) {
    if (i % 2 !== 0 || i >= 16) s += String.fromCharCode(i + 65);
    else s += pi[i];
  }
  return Buffer.from(s, 'utf-8'); // 16 bytes -> AES-128
}

async function loadEnvironments() {
  const key = deriveKey();
  const nonce = Buffer.from([...key].reverse());
  const resp = await fetch(BIN_URL, { signal: AbortSignal.timeout(20000) });
  if (!resp.ok) throw new Error(`Failed to fetch environments.bin: HTTP ${resp.status}`);
  const enc = Buffer.from(await resp.arrayBuffer());

  // GCM decrypt without tag verification (mirrors PyCryptodome .decrypt()+[:-16]).
  const decipher = crypto.createDecipheriv('aes-128-gcm', key, nonce);
  decipher.setAutoPadding(false);
  const out = decipher.update(enc);
  let text = out.subarray(0, out.length - 16).toString('latin1');
  text = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  const parsed = JSON.parse(text);
  return parsed.production ?? parsed;
}

// Quote + escape a value for a dotenv double-quoted string.
function toEnvValue(v) {
  return `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function upsertLine(content, keyName, value) {
  const line = `${keyName}=${toEnvValue(value)}`;
  const re = new RegExp(`^${keyName}=.*$`, 'm');
  if (re.test(content)) return content.replace(re, line);
  return content.replace(/\s*$/, `\n${line}\n`);
}

async function main() {
  const env = await loadEnvironments();
  const user = env.syncGatewayUser;
  const pass = env.syncGatewayPass;
  if (!user || !pass) {
    throw new Error('environments.bin did not contain syncGatewayUser / syncGatewayPass');
  }

  let content = await readFile(ENV_PATH, 'utf-8');
  content = upsertLine(content, 'DISNEY_SYNC_GATEWAY_USERNAME', user);
  content = upsertLine(content, 'DISNEY_SYNC_GATEWAY_PASSWORD', pass);
  await writeFile(ENV_PATH, content, 'utf-8');

  // Confirmation only — never echo the secret values.
  console.log(`Updated ${ENV_PATH}`);
  console.log(`  DISNEY_SYNC_GATEWAY_USERNAME: set (${user.length} chars)`);
  console.log(`  DISNEY_SYNC_GATEWAY_PASSWORD: set (${pass.length} chars)`);
}

main().catch((e) => {
  console.error('FAILED:', e.name, e.message);
  process.exitCode = 1;
});
