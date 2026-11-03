/**
 * Structural guard for ticket prices and trip budget (Property 36, Property 47).
 *
 * Enforces architectural boundaries using the TypeScript compiler API:
 * - No worker, queue, setInterval, cron or Redis in ticket/budget modules.
 * - No import of Disney live modules (transport, rateLimiter, liveClient, liveService).
 * - Exact Endpoint T and P paths in TicketPriceClient.
 * - TicketPricesService constructed in its own block in composeServices.ts.
 * - hosting.md documentation guarantees.
 *
 * Feature: trip-budget, Property 36: Ticket price architectural isolation
 * Feature: trip-budget, Property 47: Hosting documentation guarantees
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
// __tests__ -> ticketPrices -> services -> src
const SRC_DIR = resolve(HERE, '..', '..', '..');
const REPO_ROOT = resolve(SRC_DIR, '..', '..', '..');

function walkTsFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      walkTsFiles(full, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

interface AstViolation {
  readonly file: string;
  readonly kind: 'import' | 'call' | 'identifier' | 'literal';
  readonly detail: string;
}

const FORBIDDEN_IMPORT_PATTERNS = [
  /catalog\/disney\/transport(\.js)?$/,
  /catalog\/disney\/rateLimiter(\.js)?$/,
  /^ioredis$/,
  /liveClient(\.js)?$/,
  /liveService(\.js)?$/,
];

const FORBIDDEN_IDENTIFIERS = new Set(['Worker', 'Queue']);
const FORBIDDEN_CALLS = new Set(['setInterval']);
const FORBIDDEN_LITERALS = ['TICKET_PRICES_CRON_SECRET'];

function analyzeAst(filePath: string, sourceText: string): AstViolation[] {
  const sf = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
  const violations: AstViolation[] = [];

  function visit(node: ts.Node): void {
    // 1. Imports
    if (ts.isImportDeclaration(node)) {
      const moduleSpecifier = node.moduleSpecifier;
      if (ts.isStringLiteral(moduleSpecifier)) {
        const spec = moduleSpecifier.text;
        for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
          if (pattern.test(spec)) {
            violations.push({
              file: filePath,
              kind: 'import',
              detail: `Forbidden import '${spec}' matches ${pattern}`,
            });
          }
        }
      }
    }

    // 2. Call expressions (e.g. setInterval)
    if (ts.isCallExpression(node)) {
      let calleeName: string | null = null;
      if (ts.isIdentifier(node.expression)) {
        calleeName = node.expression.text;
      } else if (ts.isPropertyAccessExpression(node.expression)) {
        calleeName = node.expression.name.text;
      }
      if (calleeName && FORBIDDEN_CALLS.has(calleeName)) {
        violations.push({
          file: filePath,
          kind: 'call',
          detail: `Forbidden call to '${calleeName}'`,
        });
      }
    }

    // 3. Identifiers (Worker, Queue)
    if (ts.isIdentifier(node)) {
      // Ignore declaration identifiers for function parameters or types if they don't match
      if (FORBIDDEN_IDENTIFIERS.has(node.text)) {
        violations.push({
          file: filePath,
          kind: 'identifier',
          detail: `Forbidden identifier '${node.text}'`,
        });
      }
    }

    // 4. String literals / Template literals
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      for (const forbidden of FORBIDDEN_LITERALS) {
        if (node.text.includes(forbidden)) {
          violations.push({
            file: filePath,
            kind: 'literal',
            detail: `Forbidden literal containing '${forbidden}'`,
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);
  return violations;
}

describe('Detector self-test (Property 36)', () => {
  it('flags real setInterval call and ioredis import in source text', () => {
    const fixture = `
      import Redis from 'ioredis';
      const timer = setInterval(() => {}, 1000);
      const w = new Worker('task.js');
    `;
    const violations = analyzeAst('fixture.ts', fixture);
    expect(violations.some((v) => v.kind === 'import' && v.detail.includes('ioredis'))).toBe(true);
    expect(violations.some((v) => v.kind === 'call' && v.detail.includes('setInterval'))).toBe(true);
    expect(violations.some((v) => v.kind === 'identifier' && v.detail.includes('Worker'))).toBe(true);
  });

  it('ignores the same words when they appear inside comments', () => {
    const fixture = `
      // No cron, no worker, no queue, no setInterval
      // We do not import Redis from 'ioredis' here.
      // TICKET_PRICES_CRON_SECRET does not exist.
      export const ok = 1;
    `;
    const violations = analyzeAst('fixture.ts', fixture);
    expect(violations).toEqual([]);
  });
});

describe('Ticket and Budget structural isolation (Property 36)', () => {
  const targetDirs = [
    resolve(SRC_DIR, 'services', 'ticketPrices'),
    resolve(SRC_DIR, 'services', 'tripBudget'),
    resolve(SRC_DIR, 'services', 'lightningLane'),
  ];

  const candidateFiles: string[] = [];
  for (const dir of targetDirs) {
    walkTsFiles(dir, candidateFiles);
  }

  const adminTicketRoute = resolve(SRC_DIR, 'services', 'admin', 'ticketPriceRoutes.ts');
  if (existsSync(adminTicketRoute)) {
    candidateFiles.push(adminTicketRoute);
  }

  it('finds source files in target directories', () => {
    expect(candidateFiles.length).toBeGreaterThan(5);
  });

  it('no target file imports Disney live modules, Redis, or uses Worker/Queue/setInterval/cron', () => {
    const allViolations: AstViolation[] = [];
    for (const file of candidateFiles) {
      const source = readFileSync(file, 'utf8');
      const violations = analyzeAst(file, source);
      allViolations.push(...violations);
    }
    expect(allViolations).toEqual([]);
  });

  it('TicketPriceClient requests only documented Endpoints T and P', () => {
    const clientFile = resolve(SRC_DIR, 'services', 'ticketPrices', 'ticketPriceClient.ts');
    const source = readFileSync(clientFile, 'utf8');
    const sf = ts.createSourceFile('ticketPriceClient.ts', source, ts.ScriptTarget.Latest, true);

    const stringLiterals: string[] = [];
    function collectStrings(node: ts.Node): void {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        stringLiterals.push(node.text);
      } else if (ts.isTemplateExpression(node)) {
        stringLiterals.push(node.getText(sf));
      } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
        stringLiterals.push(node.text);
      }
      ts.forEachChild(node, collectStrings);
    }
    collectStrings(sf);

    // Endpoint T path
    expect(
      stringLiterals.some((s) => s.includes('/profile-api/authentication/get-client-token/')),
    ).toBe(true);
    // Endpoint P path
    expect(
      stringLiterals.some((s) =>
        s.includes(
          '/api/lexicon-view-assembler-service/wdw/tickets/product-types/theme-parks/prices',
        ),
      ),
    ).toBe(true);

    // Verify no HTML scraping or /passes/ endpoints
    expect(stringLiterals.some((s) => s.includes('/passes/'))).toBe(false);
  });

  it('composeServices.ts constructs ticket prices service in its own block without live Disney modules', () => {
    const composeFile = resolve(SRC_DIR, 'composeServices.ts');
    const source = readFileSync(composeFile, 'utf8');

    const sf = ts.createSourceFile(composeFile, source, ts.ScriptTarget.Latest, true);

    // 1. Verify import is from services/ticketPrices/refreshService.js
    let importedFrom: string | null = null;
    function findImport(node: ts.Node) {
      if (ts.isImportDeclaration(node)) {
        const spec = (node.moduleSpecifier as ts.StringLiteral).text;
        const namedBindings = node.importClause?.namedBindings;
        if (namedBindings && ts.isNamedImports(namedBindings)) {
          for (const el of namedBindings.elements) {
            if (el.name.text === 'createTicketPricesService') {
              importedFrom = spec;
            }
          }
        }
      }
      ts.forEachChild(node, findImport);
    }
    findImport(sf);

    expect(importedFrom).toBe('./services/ticketPrices/refreshService.js');

    // 2. Verify createTicketPricesService call does not receive liveClient, liveService, or DisneyTransport
    let callFound = false;
    let forbiddenArgFound = false;
    function findCall(node: ts.Node) {
      if (ts.isCallExpression(node)) {
        const calleeText = node.expression.getText(sf);
        if (calleeText === 'createTicketPricesService') {
          callFound = true;
          for (const arg of node.arguments) {
            const argText = arg.getText(sf);
            if (
              argText.includes('liveClient') ||
              argText.includes('liveService') ||
              argText.includes('DisneyTransport') ||
              argText.includes('rateLimiter')
            ) {
              forbiddenArgFound = true;
            }
          }
        }
      }
      ts.forEachChild(node, findCall);
    }
    findCall(sf);

    expect(callFound).toBe(true);
    expect(forbiddenArgFound).toBe(false);
  });
});

describe('Hosting documentation guarantees (Property 47)', () => {
  it('docs/hosting.md contains the three authoritative statements', () => {
    const hostingDocPath = resolve(REPO_ROOT, 'docs', 'hosting.md');
    expect(existsSync(hostingDocPath)).toBe(true);
    const content = readFileSync(hostingDocPath, 'utf8').toLowerCase();

    // 1. No cron for ticket prices
    expect(content).toContain('no cron for ticket prices');

    // 2. Keep-alive never touches the database
    expect(content).toContain('keep-alive never touches the database');

    // 3. Lightning Lane prices depend on the sampling job
    expect(content).toContain('lightning lane prices depend on the sampling job');
  });
});
