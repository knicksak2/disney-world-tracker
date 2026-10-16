/**
 * Property 21 (dark-mode retrofit, design.md rule 7): pin tier colours used as UI text are
 * legible in dark, while the tier artwork itself is unchanged.
 *
 * `TIER_COLOR` is pin artwork. Where a tier colour is text (the `PinDetailModal` tier Badge), the
 * screen reads `usePalette(TIER_TEXT)[tier]`, so light renders `TIER_COLOR` byte-for-byte and dark
 * renders the lifted amethyst / bronze values. The `PinView` art is never recoloured.
 */
// Feature: dark-mode, Property 21: pin tier UI text is legible while tier art is unchanged

import React from 'react';
import { StyleSheet } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { render, screen } from '@testing-library/react-native';
import fc from 'fast-check';
import { PINS, PIN_TIERS, type PinDTO, type PinTier, type UserPinProgressDTO } from '@dwt/shared';

import { TIER_COLOR, TIER_LABEL } from '../../../components/pins/pinTierMeta';
import { CONTRAST_REQUIREMENTS, TIER_TEXT_DARK, contrastRatio, mixOver } from '../../../theme/contrast';
import { darkTheme, withAlpha } from '../../../theme/theme';
import { resetTestScheme, setTestScheme } from '../../../test/themeTestUtils';
import PinDetailModal from '../PinDetailModal';
import { TIER_TEXT } from '../tierText.palette';

type Scheme = 'light' | 'dark';

const BASE_PIN: PinDTO = PINS[0]!;

/** A catalog pin of the given tier (or the base pin re-tiered when the catalog has none). */
function pinOfTier(tier: PinTier): PinDTO {
  return PINS.find((p) => p.tier === tier) ?? { ...BASE_PIN, tier };
}

const UNLOCKED: Omit<UserPinProgressDTO, 'pinId'> = {
  unlocked: true,
  awardedAt: '2026-01-15T10:00:00.000Z',
  currentValue: null,
  targetValue: null,
  percentComplete: null,
  claimedAt: '2026-01-15T10:01:00.000Z',
};

/**
 * Host-element snapshot of a rendered subtree (what `toJSON()` shows): host types and their
 * non-function props, with composite wrappers flattened away.
 */
function serialize(node: ReactTestInstance | string): unknown[] {
  if (typeof node === 'string') return [node];
  const children = node.children.flatMap(serialize);
  if (typeof node.type !== 'string') return children;
  const props: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node.props)) {
    if (k === 'children' || typeof v === 'function') continue;
    props[k] = v;
  }
  return [{ type: node.type, props: JSON.parse(JSON.stringify(props)), children }];
}

function renderDetail(pin: PinDTO): void {
  render(
    <PinDetailModal
      visible
      onClose={jest.fn()}
      pin={pin}
      progress={{ pinId: pin.id, ...UNLOCKED }}
    />,
  );
}

/** Renders the modal under `scheme` and returns the tier Badge text colour + the art subtree. */
function renderUnder(scheme: Scheme, pin: PinDTO): { badgeColor: unknown; art: unknown } {
  setTestScheme(scheme);
  try {
    renderDetail(pin);
    const badgeText = screen.getByText(TIER_LABEL[pin.tier]);
    const badgeColor = StyleSheet.flatten(badgeText.props.style)?.color;
    const art = serialize(screen.getByTestId('pin-detail-art'));
    return { badgeColor, art };
  } finally {
    screen.unmount();
    resetTestScheme();
  }
}

afterEach(resetTestScheme);

describe('Property 21: pin tier UI text is legible while tier art is unchanged', () => {
  it('TIER_TEXT.light is TIER_COLOR verbatim; dark lifts only amethyst and bronze', () => {
    expect(TIER_TEXT.light).toEqual(TIER_COLOR);
    expect(TIER_TEXT.dark).toEqual({ ...TIER_COLOR, amethyst: '#c08ff5', bronze: '#e0965f' });
    // The contrast table checks exactly these dark values.
    expect(TIER_TEXT.dark).toEqual(TIER_TEXT_DARK);
  });

  it('every dark tier text clears 4.5:1 as Badge text on its 14% tint over surface / surfaceAlt / background', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<PinTier>(...PIN_TIERS),
        fc.constantFrom<'surface' | 'surfaceAlt' | 'background'>('surface', 'surfaceAlt', 'background'),
        (tier, ground) => {
          const fg = TIER_TEXT.dark[tier];
          const bg = mixOver(fg, darkTheme.color[ground], 0.14);
          expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
        },
      ),
      { numRuns: 100 },
    );
    const tierRows = CONTRAST_REQUIREMENTS.filter((r) => r.label.startsWith('TIER_TEXT'));
    expect(tierRows.length).toBeGreaterThan(0);
    for (const r of tierRows) expect(contrastRatio(r.fg, r.bg)).toBeGreaterThanOrEqual(r.min);
  });

  it('PinDetailModal tier Badge text is TIER_TEXT.dark[tier] in dark and TIER_COLOR[tier] in light; PinView art is identical', () => {
    fc.assert(
      fc.property(fc.constantFrom<PinTier>(...PIN_TIERS), (tier) => {
        const pin = pinOfTier(tier);
        const light = renderUnder('light', pin);
        const dark = renderUnder('dark', pin);

        expect(light.badgeColor).toBe(TIER_COLOR[tier]);
        expect(dark.badgeColor).toBe(TIER_TEXT.dark[tier]);
        // Property 18 instance: the pin artwork subtree is the same in both schemes.
        expect((light.art as unknown[]).length).toBeGreaterThan(0);
        expect(JSON.stringify(light.art)).toMatch(/#[0-9a-f]{6}/i);
        expect(dark.art).toEqual(light.art);
      }),
      { numRuns: 100 },
    );
  });

  it('dark amethyst / bronze Badge text differs from the tier art colour (the fix is observable)', () => {
    for (const tier of ['amethyst', 'bronze'] as const) {
      const dark = renderUnder('dark', pinOfTier(tier));
      expect(dark.badgeColor).toBe(TIER_TEXT.dark[tier]);
      expect(dark.badgeColor).not.toBe(TIER_COLOR[tier]);
    }
  });

  it('the Badge tint behind the tier text follows the text colour (withAlpha 14%)', () => {
    setTestScheme('dark');
    const pin = pinOfTier('amethyst');
    renderDetail(pin);
    // Walk up from the label to the host View that paints the Badge tint.
    let cur: ReactTestInstance | null = screen.getByText(TIER_LABEL.amethyst).parent;
    let tint: unknown;
    while (cur !== null && tint === undefined) {
      if (typeof cur.type === 'string') tint = StyleSheet.flatten(cur.props.style)?.backgroundColor;
      cur = cur.parent;
    }
    expect(tint).toBe(withAlpha(TIER_TEXT.dark.amethyst, 0.14));
  });
});
