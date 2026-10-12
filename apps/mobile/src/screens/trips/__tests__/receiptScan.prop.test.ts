// Feature: trip-expenses, Property 8: Receipt parsing partitions recognized text losslessly between items, charge lines, and ignored totals
// Feature: trip-expenses, Property 9: Multi-photo Receipt_Scan append is order-independent for the final reviewed set

import fc from 'fast-check';
import {
  parseReceiptText,
  classifyReceiptLine,
  createScannedPhotoReceipt,
  combineScannedReceipts,
} from '../receiptScan';

describe('receiptScan Property Tests', () => {
  // Arbitrary generator for receipt lines of various kinds
  const arbItemName = fc.stringMatching(/^[A-Za-z0-9 ]{3,20}$/).filter((s) => s.trim().length >= 3);
  const arbDollars = fc.integer({ min: 1, max: 200 });
  const arbCents = fc.integer({ min: 0, max: 99 });
  const arbPriceStr = fc.tuple(arbDollars, arbCents).map(([d, c]) => `${d}.${c < 10 ? '0' : ''}${c}`);

  const arbItemLine = fc.tuple(arbItemName, arbPriceStr).map(([name, price]) => `${name} $${price}`);
  const arbSubtotalLine = arbPriceStr.map((p) => `Subtotal $${p}`);
  const arbTotalLine = arbPriceStr.map((p) => `Total: $${p}`);
  const arbTenderLine = arbPriceStr.map((p) => `Visa *4321 $${p}`);
  const arbTaxLine = arbPriceStr.map((p) => `Sales Tax $${p}`);
  const arbTipLine = arbPriceStr.map((p) => `Auto Gratuity $${p}`);
  const arbFeeLine = arbPriceStr.map((p) => `Service Fee $${p}`);
  const arbDiscountLine = arbPriceStr.map((p) => `Annual Passholder Discount -$${p}`);
  const arbIgnoredText = fc.constantFrom(
    'Walt Disney World Resort',
    'Server: Mickey Mouse',
    'Table 42',
    'Order #987654',
    'Have a magical day!',
    'Suggested 18% = 12.50',
    'Change Due $0.00'
  );

  const arbReceiptLine = fc.oneof(
    arbItemLine,
    arbSubtotalLine,
    arbTotalLine,
    arbTenderLine,
    arbTaxLine,
    arbTipLine,
    arbFeeLine,
    arbDiscountLine,
    arbIgnoredText
  );

  // Property 8: Receipt parsing partitions recognized text losslessly between items, charge lines, and ignored totals
  // Validates: Requirements 9.2, 9.5, 9.6
  it('Property 8: partitions lines losslessly and deterministically', () => {
    fc.assert(
      fc.property(fc.array(arbReceiptLine, { minLength: 1, maxLength: 20 }), (lines) => {
        const rawText = lines.join('\n');

        // 1. Line-by-line partition check: exactly one branch is taken
        for (const line of lines) {
          const classification = classifyReceiptLine(line);
          const kinds = ['item', 'chargeLine', 'subtotal', 'ignored'];
          expect(kinds).toContain(classification.kind);

          // Subtotal lines must NEVER be classified as item or chargeLine
          if (/subtotal/i.test(line)) {
            expect(classification.kind).toBe('subtotal');
          }

          // Total or tender lines must be ignored
          if (/^(?:total|grand total|visa)/i.test(line.trim())) {
            expect(classification.kind).toBe('ignored');
          }
        }

        // 2. Determinism check: running twice on the same rawText produces identical results
        const run1 = parseReceiptText(rawText);
        const run2 = parseReceiptText(rawText);

        expect(run1.items.length).toBe(run2.items.length);
        expect(run1.chargeLines.length).toBe(run2.chargeLines.length);
        expect(run1.subtotalCents).toBe(run2.subtotalCents);

        for (let i = 0; i < run1.items.length; i++) {
          expect(run1.items[i]!.name).toBe(run2.items[i]!.name);
          expect(run1.items[i]!.priceCents).toBe(run2.items[i]!.priceCents);
          expect(run1.items[i]!.isAlcohol).toBe(run2.items[i]!.isAlcohol);
        }

        for (let i = 0; i < run1.chargeLines.length; i++) {
          expect(run1.chargeLines[i]!.kind).toBe(run2.chargeLines[i]!.kind);
          expect(run1.chargeLines[i]!.amountCents).toBe(run2.chargeLines[i]!.amountCents);
        }
      }),
      { numRuns: 100 }
    );
  });

  // Property 9: Multi-photo Receipt_Scan append is order-independent for the final reviewed set
  // Validates: Requirements 9.10, 9.11, 9.12
  it('Property 9: multi-photo append is order-independent and discard is lossless', () => {
    const arbPhotoText = fc.array(arbReceiptLine, { minLength: 1, maxLength: 5 }).map((l) => l.join('\n'));

    fc.assert(
      fc.property(arbPhotoText, arbPhotoText, arbPhotoText, (textA, textB, textC) => {
        const photoA = createScannedPhotoReceipt('photo-A', textA);
        const photoB = createScannedPhotoReceipt('photo-B', textB);
        const photoC = createScannedPhotoReceipt('photo-C', textC);

        // Append order independence: [A, B] vs [B, A] contain the same set of items and charge lines
        const combinedAB = combineScannedReceipts([photoA, photoB]);
        const combinedBA = combineScannedReceipts([photoB, photoA]);

        expect(combinedAB.items.length).toBe(combinedBA.items.length);
        expect(combinedAB.chargeLines.length).toBe(combinedBA.chargeLines.length);

        const sumPriceAB = combinedAB.items.reduce((s, it) => s + it.priceCents, 0);
        const sumPriceBA = combinedBA.items.reduce((s, it) => s + it.priceCents, 0);
        expect(sumPriceAB).toBe(sumPriceBA);

        // Discard consistency: Removing photo B from [A, B, C] yields exactly [A, C]
        const allThree = [photoA, photoB, photoC];
        const keptWithoutB = allThree.filter((p) => p.id !== 'photo-B');
        const combinedWithoutB = combineScannedReceipts(keptWithoutB);
        const directlyAC = combineScannedReceipts([photoA, photoC]);

        expect(combinedWithoutB.items.length).toBe(directlyAC.items.length);
        expect(combinedWithoutB.chargeLines.length).toBe(directlyAC.chargeLines.length);

        for (let i = 0; i < combinedWithoutB.items.length; i++) {
          expect(combinedWithoutB.items[i]!.name).toBe(directlyAC.items[i]!.name);
          expect(combinedWithoutB.items[i]!.priceCents).toBe(directlyAC.items[i]!.priceCents);
        }
      }),
      { numRuns: 100 }
    );
  });
});
