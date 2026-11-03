// Feature: trip-budget, Task 18.5 — Mobile budget structure tests
//
// Property 40: Every new mobile screen is themed, labelled and wired
// Property 49: Mobile tests run under Jest with @testing-library/react-native
// Validates: Requirements 1.1, 22.1, 22.4, 22.5, 22.6, 22.7, 22.8

import * as fs from 'fs';
import * as path from 'path';
import { HUB_SECTIONS } from '../TripDetailScreen';

export const NEW_BUDGET_TSX = [
  'apps/mobile/src/screens/trips/BudgetLineFormModal.tsx',
  'apps/mobile/src/screens/trips/BudgetTravelersModal.tsx',
  'apps/mobile/src/screens/trips/BudgetSettingsModal.tsx',
  'apps/mobile/src/screens/trips/TripBudgetScreen.tsx',
] as const;

function resolveRepoPath(relPath: string): string {
  // From apps/mobile/src/screens/trips/__tests__ -> up 6 levels to repo root
  const repoRoot = path.resolve(__dirname, '../../../../../..');
  return path.resolve(repoRoot, relPath);
}

describe('budgetStructure (Properties 40 and 49)', () => {
  test('NEW_BUDGET_TSX files each import makeStyles or useAppTheme', () => {
    expect(NEW_BUDGET_TSX.length).toBe(4);
    for (const relPath of NEW_BUDGET_TSX) {
      const fullPath = resolveRepoPath(relPath);
      expect(fs.existsSync(fullPath)).toBe(true);
      const content = fs.readFileSync(fullPath, 'utf8');
      const usesMakeStyles = /makeStyles/.test(content);
      const usesAppTheme = /useAppTheme/.test(content);
      expect(usesMakeStyles || usesAppTheme).toBe(true);
    }
  });

  test('TripsStackParamList contains TripBudget with tripId', () => {
    const tripsStackPath = resolveRepoPath('apps/mobile/src/navigation/TripsStack.tsx');
    expect(fs.existsSync(tripsStackPath)).toBe(true);
    const content = fs.readFileSync(tripsStackPath, 'utf8');

    // Asserts TripsStackParamList has TripBudget: { tripId: string }
    expect(content).toMatch(/TripBudget\s*:\s*\{\s*tripId\s*:\s*string\s*\}/);

    // Also asserts screen registration
    expect(content).toMatch(/<Stack\.Screen\s+name=["']TripBudget["']\s+component=\{TripBudgetScreen\}/);
  });

  test('HUB_SECTIONS has budget right after expenses', () => {
    const expensesIdx = HUB_SECTIONS.findIndex((s) => s.key === 'expenses');
    expect(expensesIdx).toBeGreaterThanOrEqual(0);
    const budgetEntry = HUB_SECTIONS[expensesIdx + 1];
    expect(budgetEntry).toBeDefined();
    expect(budgetEntry).toEqual(
      expect.objectContaining({
        key: 'budget',
        route: 'TripBudget',
        title: 'Budget',
        body: 'Plan costs, save per week, compare to what you spent.',
        icon: 'wallet-outline',
      }),
    );
  });

  test('BudgetLineFormModal.tsx imports MenuItemPicker from components/', () => {
    const modalPath = resolveRepoPath('apps/mobile/src/screens/trips/BudgetLineFormModal.tsx');
    expect(fs.existsSync(modalPath)).toBe(true);
    const content = fs.readFileSync(modalPath, 'utf8');
    expect(content).toMatch(
      /import\s+(\{[^}]*MenuItemPicker[^}]*\}|MenuItemPicker)\s+from\s+['"].*components\/MenuItemPicker['"]/,
    );
  });

  test('no Budget mobile test file imports vitest', () => {
    const mobileSrc = resolveRepoPath('apps/mobile/src');
    const budgetTestFiles: string[] = [];

    function walkDir(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(full);
        } else if (
          entry.isFile() &&
          /\.(test|spec)\.(ts|tsx)$/.test(entry.name) &&
          (/budget/i.test(entry.name) || /PriceBadge/i.test(entry.name) || /MenuItemPicker/i.test(entry.name))
        ) {
          budgetTestFiles.push(full);
        }
      }
    }

    walkDir(mobileSrc);
    expect(budgetTestFiles.length).toBeGreaterThanOrEqual(6);

    for (const testFile of budgetTestFiles) {
      const content = fs.readFileSync(testFile, 'utf8');
      expect(content).not.toMatch(/from\s+['"]vitest['"]/);
      expect(content).not.toMatch(/import\s*\{[^}]*\}\s*from\s*['"]vitest['"]/);
    }
  });
});
