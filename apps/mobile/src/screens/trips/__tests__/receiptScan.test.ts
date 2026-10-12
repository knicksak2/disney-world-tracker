import {
  parseReceiptText,
  flagAlcoholCandidate,
  matchMenuItemName,
  extractTierPriceSuggestions,
  createScannedPhotoReceipt,
  combineScannedReceipts,
} from '../receiptScan';

describe('receiptScan Unit Tests', () => {
  describe('parseReceiptText on representative fixtures', () => {
    it('parses a Disney table-service receipt with tax and gratuity', () => {
      const tableServiceReceipt = `
        Be Our Guest Restaurant
        Magic Kingdom Park
        Server: Lumiere
        Table 12

        1 French Onion Soup $14.50
        1 Filet Mignon $48.00
        1 Safari Amber Beer $9.50
        1 Grey Stuff $12.00

        Subtotal $84.00
        Sales Tax $5.46
        Auto Gratuity $15.12
        Total $104.58

        Visa *1234 $104.58
        Thank you for dining with us!
      `;

      const result = parseReceiptText(tableServiceReceipt);

      // Items (4 items)
      expect(result.items).toHaveLength(4);
      expect(result.items[0]).toMatchObject({
        name: 'French Onion Soup',
        priceCents: 1450,
        isAlcohol: false,
      });
      expect(result.items[1]).toMatchObject({
        name: 'Filet Mignon',
        priceCents: 4800,
        isAlcohol: false,
      });
      expect(result.items[2]).toMatchObject({
        name: 'Safari Amber Beer',
        priceCents: 950,
        isAlcohol: true,
      });
      expect(result.items[3]).toMatchObject({
        name: 'Grey Stuff',
        priceCents: 1200,
        isAlcohol: false,
      });

      // Charge lines (Tax + Gratuity)
      expect(result.chargeLines).toHaveLength(2);
      expect(result.chargeLines.find((cl) => cl.kind === 'tax')).toMatchObject({
        kind: 'tax',
        amountCents: 546,
      });
      expect(result.chargeLines.find((cl) => cl.kind === 'gratuity')).toMatchObject({
        kind: 'gratuity',
        amountCents: 1512,
      });

      // Subtotal (detected as context)
      expect(result.subtotalCents).toBe(8400);
    });

    it('parses a quick-service receipt with a discount line', () => {
      const quickServiceReceipt = `
        Aloha Isle
        Adventureland

        1 Dole Whip Float 7.99
        2 Pineapple Cup 11.98
        Annual Passholder Discount -1.99
        Sub Total 17.98
        Tax 1.17
        Total Due 19.15
      `;

      const result = parseReceiptText(quickServiceReceipt);

      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toMatchObject({
        name: 'Dole Whip Float',
        priceCents: 799,
        isAlcohol: false,
      });
      expect(result.items[1]).toMatchObject({
        name: 'Pineapple Cup',
        priceCents: 1198,
        isAlcohol: false,
      });

      expect(result.chargeLines).toHaveLength(2);
      expect(result.chargeLines.find((cl) => cl.kind === 'discount')).toMatchObject({
        kind: 'discount',
        amountCents: 199,
      });
      expect(result.chargeLines.find((cl) => cl.kind === 'tax')).toMatchObject({
        kind: 'tax',
        amountCents: 117,
      });

      expect(result.subtotalCents).toBe(1798);
    });

    it('parses a multi-item gift shop receipt', () => {
      const giftShopReceipt = `
        Emporium - Main Street USA
        Cashier: Goofy

        Mickey Ear Hat 29.99
        Spirit Jersey 79.99
        Disney Pin Set 16.99
        MagicBand Plus 44.99
        Bag Fee 0.25

        Subtotal 172.21
        Sales Tax 11.19
        Total: 183.40
        MasterCard 183.40
      `;

      const result = parseReceiptText(giftShopReceipt);

      expect(result.items).toHaveLength(4);
      expect(result.items.map((i) => i.name)).toEqual([
        'Mickey Ear Hat',
        'Spirit Jersey',
        'Disney Pin Set',
        'MagicBand Plus',
      ]);
      expect(result.items.map((i) => i.priceCents)).toEqual([2999, 7999, 1699, 4499]);

      // Fee + Tax
      expect(result.chargeLines).toHaveLength(2);
      expect(result.chargeLines.find((cl) => cl.kind === 'fee')).toMatchObject({
        kind: 'fee',
        amountCents: 25,
      });
      expect(result.chargeLines.find((cl) => cl.kind === 'tax')).toMatchObject({
        kind: 'tax',
        amountCents: 1119,
      });

      expect(result.subtotalCents).toBe(17221);
    });

    it('returns empty result when given blank text without error (Req 9.5)', () => {
      const result = parseReceiptText('   ');
      expect(result.items).toEqual([]);
      expect(result.chargeLines).toEqual([]);
      expect(result.subtotalCents).toBeNull();
    });
  });

  describe('flagAlcoholCandidate (Req 9.8)', () => {
    it('flags common alcoholic beverages', () => {
      expect(flagAlcoholCandidate('Draft Beer')).toBe(true);
      expect(flagAlcoholCandidate('IPA Pint')).toBe(true);
      expect(flagAlcoholCandidate('Cabernet Sauvignon')).toBe(true);
      expect(flagAlcoholCandidate('Chardonnay Glass')).toBe(true);
      expect(flagAlcoholCandidate('Margarita on Rocks')).toBe(true);
      expect(flagAlcoholCandidate('Vodka Tonic')).toBe(true);
      expect(flagAlcoholCandidate('Whiskey Sour')).toBe(true);
      expect(flagAlcoholCandidate('Red Wine')).toBe(true);
      expect(flagAlcoholCandidate('Hard Cider')).toBe(true);
    });

    it('flags Disney-specific lounge drinks', () => {
      expect(flagAlcoholCandidate('Lapu Lapu')).toBe(true);
      expect(flagAlcoholCandidate('Fuzzy Tauntaun')).toBe(true);
      expect(flagAlcoholCandidate('Bespin Fizz')).toBe(true);
      expect(flagAlcoholCandidate('Avocado Margarita')).toBe(true);
      expect(flagAlcoholCandidate('Tipsy Ducks in Love')).toBe(true);
      expect(flagAlcoholCandidate('Spikey Pineapple')).toBe(true);
    });

    it('does NOT flag non-alcoholic items and exclusions', () => {
      expect(flagAlcoholCandidate('Root Beer')).toBe(false);
      expect(flagAlcoholCandidate('Ginger Beer')).toBe(false);
      expect(flagAlcoholCandidate('Beer Battered Cod')).toBe(false);
      expect(flagAlcoholCandidate('Mickey Pretzel')).toBe(false);
      expect(flagAlcoholCandidate('Cheeseburger')).toBe(false);
      expect(flagAlcoholCandidate('Coca Cola')).toBe(false);
      expect(flagAlcoholCandidate('Virgin Colada')).toBe(false);
      expect(flagAlcoholCandidate('Non-Alcoholic Punch')).toBe(false);
    });
  });

  describe('matchMenuItemName (Req 9.9)', () => {
    const restaurantMenu = [
      'The Grey Stuff',
      'French Onion Soup',
      'Center-Cut Filet Mignon',
      'Tavern Pork Chop',
      'Roasted Poulet Rouge Chicken',
    ];

    it('matches exact normalized names', () => {
      expect(matchMenuItemName('French Onion Soup', restaurantMenu)).toBe('French Onion Soup');
      expect(matchMenuItemName('french onion soup', restaurantMenu)).toBe('French Onion Soup');
    });

    it('matches minor OCR typos via edit distance', () => {
      expect(matchMenuItemName('The Grey Stuf', restaurantMenu)).toBe('The Grey Stuff');
      expect(matchMenuItemName('Pork Chop', restaurantMenu)).toBe('Tavern Pork Chop');
    });

    it('returns null when no confident match exists', () => {
      expect(matchMenuItemName('Spaghetti Carbonara', restaurantMenu)).toBeNull();
      expect(matchMenuItemName('Fish and Chips', restaurantMenu)).toBeNull();
    });
  });

  describe('extractTierPriceSuggestions (Req 11.4, 11.5)', () => {
    it('extracts per-person pricing from buffets and prix fixe menus', () => {
      const buffetMenu = [
        {
          menuType: 'Dinner',
          groups: [
            {
              name: 'Buffet Pricing',
              items: [
                { name: '$65 per adult', price: '$65.00' },
                { name: '$40 per child', price: '$40.00' },
              ],
            },
          ],
        },
      ];

      const suggestions = extractTierPriceSuggestions(buffetMenu);
      expect(suggestions).toEqual([
        { name: 'Adult', priceCents: 6500 },
        { name: 'Child', priceCents: 4000 },
      ]);
    });

    it('extracts colon-separated tier pricing (Adult: $55)', () => {
      const fixedMenu = [
        {
          menuType: 'Lunch',
          groups: [
            {
              name: 'Pricing',
              items: [
                { name: 'Adult: $55.00', price: '55.00' },
                { name: 'Child: $35.00', price: '35.00' },
              ],
            },
          ],
        },
      ];

      const suggestions = extractTierPriceSuggestions(fixedMenu);
      expect(suggestions).toEqual([
        { name: 'Adult', priceCents: 5500 },
        { name: 'Child', priceCents: 3500 },
      ]);
    });

    it('returns empty array when menu has no tier pricing (Req 11.5)', () => {
      const aLaCarteMenu = [
        {
          menuType: 'All Day',
          groups: [
            {
              name: 'Entrees',
              items: [
                { name: 'Cheeseburger', price: '$14.99' },
                { name: 'Chicken Tenders', price: '$12.49' },
              ],
            },
          ],
        },
      ];

      const suggestions = extractTierPriceSuggestions(aLaCarteMenu);
      expect(suggestions).toEqual([]);
    });
  });

  describe('multi-photo append and discard (Req 9.10, 9.12)', () => {
    it('combines multiple photos and discards one photo cleanly', () => {
      const photo1 = createScannedPhotoReceipt('photo-1', 'Burger 15.00\nFries 5.00');
      const photo2 = createScannedPhotoReceipt('photo-2', 'Shake 8.00\nTax 2.00');

      const combined = combineScannedReceipts([photo1, photo2]);
      expect(combined.items).toHaveLength(3);
      expect(combined.items.map((i) => i.name)).toEqual(['Burger', 'Fries', 'Shake']);
      expect(combined.chargeLines).toHaveLength(1);

      // Discard photo 1
      const keptOnlyPhoto2 = combineScannedReceipts([photo2]);
      expect(keptOnlyPhoto2.items).toHaveLength(1);
      expect(keptOnlyPhoto2.items[0]!.name).toBe('Shake');
    });
  });
});
