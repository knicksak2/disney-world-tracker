import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

describe('TicketPrices noRedis guard', () => {
  it('no file under services/ticketPrices or its transitive local imports imports ioredis or references Redis client', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const ticketPricesDir = resolve(here, '..');

    const entryFiles = readdirSync(ticketPricesDir)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.d.ts'))
      .map((name) => resolve(ticketPricesDir, name));

    expect(entryFiles.length).toBeGreaterThan(5);

    const visited = new Set<string>();
    const queue = [...entryFiles];

    function resolveImport(sourceFile: string, specifier: string): string | null {
      if (!specifier.startsWith('.')) {
        return null; // External package
      }
      const dir = dirname(sourceFile);
      // Strip .js extension and try .ts
      const cleaned = specifier.replace(/\.js$/, '');
      const candidateTs = resolve(dir, `${cleaned}.ts`);
      if (existsSync(candidateTs)) return candidateTs;
      const candidateIndex = resolve(dir, cleaned, 'index.ts');
      if (existsSync(candidateIndex)) return candidateIndex;
      return null;
    }

    while (queue.length > 0) {
      const currentPath = queue.pop()!;
      if (visited.has(currentPath)) continue;
      visited.add(currentPath);

      const content = readFileSync(currentPath, 'utf8');
      expect(content, `File ${currentPath} must not import ioredis`).not.toMatch(/from\s+['"]ioredis['"]/);
      expect(content, `File ${currentPath} must not import a redis module`).not.toMatch(/from\s+['"][^'"]*redis[^'"]*['"]/i);
      expect(content, `File ${currentPath} must not construct Redis`).not.toMatch(/new\s+Redis\(/);

      const sf = ts.createSourceFile(currentPath, content, ts.ScriptTarget.Latest, true);

      function visit(node: ts.Node) {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
          const moduleSpecifier = node.moduleSpecifier;
          if (moduleSpecifier && ts.isStringLiteral(moduleSpecifier)) {
            const spec = moduleSpecifier.text;
            expect(spec.toLowerCase(), `Import in ${currentPath} contains redis`).not.toContain('redis');
            expect(spec, `Import in ${currentPath} imports ioredis`).not.toBe('ioredis');

            const resolved = resolveImport(currentPath, spec);
            if (resolved && !visited.has(resolved)) {
              queue.push(resolved);
            }
          }
        }
        ts.forEachChild(node, visit);
      }

      visit(sf);
    }

    // Proves we visited more than just the immediate files
    expect(visited.size).toBeGreaterThan(entryFiles.length);
  });
});

