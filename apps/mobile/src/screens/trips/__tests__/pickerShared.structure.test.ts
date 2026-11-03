// Feature: trip-expenses, Property 21: Menu Item Picker is shared and singular
// Validates: Requirements 16.1 - 16.8, trip-expenses Property 19, 20, 21

import * as fs from 'fs';
import * as path from 'path';

function resolveRepoPath(relPath: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../../..');
  return path.resolve(repoRoot, relPath);
}

describe('pickerShared.structure (trip-expenses Property 21)', () => {
  test('ExpenseFormModal.tsx and BudgetLineFormModal.tsx both import MenuItemPicker from components/MenuItemPicker', () => {
    const expenseFormPath = resolveRepoPath('apps/mobile/src/screens/trips/ExpenseFormModal.tsx');
    const budgetModalPath = resolveRepoPath('apps/mobile/src/screens/trips/BudgetLineFormModal.tsx');

    expect(fs.existsSync(expenseFormPath)).toBe(true);
    expect(fs.existsSync(budgetModalPath)).toBe(true);

    const expenseFormContent = fs.readFileSync(expenseFormPath, 'utf8');
    const budgetModalContent = fs.readFileSync(budgetModalPath, 'utf8');

    // Both must import MenuItemPicker from components/MenuItemPicker
    const pickerImportPattern =
      /import\s+(\{[^}]*MenuItemPicker[^}]*\}|MenuItemPicker)\s+from\s+['"].*components\/MenuItemPicker['"]/;

    expect(expenseFormContent).toMatch(pickerImportPattern);
    expect(budgetModalContent).toMatch(pickerImportPattern);
  });

  test('exactly one file named MenuItemPicker.tsx and one menuItemPicker.pure.ts exist under apps/mobile/src/', () => {
    const mobileSrc = resolveRepoPath('apps/mobile/src');
    const matchingComponentFiles: string[] = [];
    const matchingPureFiles: string[] = [];

    function walkDir(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(full);
        } else if (entry.isFile()) {
          if (entry.name === 'MenuItemPicker.tsx') {
            matchingComponentFiles.push(full);
          } else if (entry.name === 'menuItemPicker.pure.ts') {
            matchingPureFiles.push(full);
          }
        }
      }
    }

    walkDir(mobileSrc);

    expect(matchingComponentFiles).toHaveLength(1);
    expect(matchingPureFiles).toHaveLength(1);
    expect(matchingComponentFiles[0]).toContain(path.join('components', 'MenuItemPicker.tsx'));
    expect(matchingPureFiles[0]).toContain(path.join('components', 'menuItemPicker.pure.ts'));
  });

  test('ExpenseFormModal.menuPicker.test.tsx covers each condition of Property 19 and Property 20', () => {
    const testFilePath = resolveRepoPath(
      'apps/mobile/src/screens/trips/__tests__/ExpenseFormModal.menuPicker.test.tsx',
    );
    expect(fs.existsSync(testFilePath)).toBe(true);
    const content = fs.readFileSync(testFilePath, 'utf8');

    // Property 19 conditions:
    // itemized, linked restaurant, priced items; absent for even, tiered, custom/exact, unlinked, no cached menu, no parseable price
    expect(content).toContain('Pick from menu');
    expect(content).toContain('itemized');
    expect(content).toContain('even');
    expect(content).toContain('PRICELESS_MENUS');
    expect(content).toContain('menus: []');

    // Property 20 conditions:
    // tiered offer appears in Menu Pricing Suggestions card, no network call before submit, discarded offer absent from body
    expect(content).toContain('Menu Pricing Suggestions');
    expect(content).toContain('tier-suggestions-banner');
    expect(content).toContain('discard-tier-suggestions-btn');
    expect(content).toContain('apply-tier-suggestions-btn');
  });
});

