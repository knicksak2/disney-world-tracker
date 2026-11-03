/**
 * Structural guard ensuring KeyboardAvoidingView on Android never uses "height" behavior,
 * which causes infinite soft-keyboard layout oscillation (jitter/freakout) under adjustResize.
 *
 * Validates: Android soft keyboard stability across all app modals and screens.
 */

import fs from 'fs';
import path from 'path';

const SRC_ROOT = path.resolve(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') walk(abs, out);
    } else if (
      /\.(tsx|ts)$/.test(entry.name) &&
      !entry.name.includes('.test.') &&
      !entry.name.includes('.spec.')
    ) {
      out.push(abs);
    }
  }
  return out;
}

describe('KeyboardAvoidingView Android Behavior Guard', () => {
  const allFiles = walk(SRC_ROOT);

  test('no source file in apps/mobile/src sets KeyboardAvoidingView behavior to "height" on Android', () => {
    const violations: { file: string; line: number; text: string }[] = [];

    for (const file of allFiles) {
      // Exclude documentation in the inset hook itself
      if (file.endsWith('useKeyboardBottomInset.ts')) continue;
      const content = fs.readFileSync(file, 'utf8');
      if (!content.includes('KeyboardAvoidingView')) continue;

      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (
          line.includes('behavior=') &&
          (line.includes("'height'") || line.includes('"height"'))
        ) {
          violations.push({
            file: path.relative(SRC_ROOT, file).split(path.sep).join('/'),
            line: i + 1,
            text: line.trim(),
          });
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

