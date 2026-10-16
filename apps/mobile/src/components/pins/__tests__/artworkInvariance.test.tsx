/**
 * Property 18: artwork is invariant across schemes. Pin art (every tier,
 * locked and unlocked) and every avatar preset render the identical tree
 * under light and dark — the retrofit never recolours artwork.
 *
 * Validates: Requirement 9.5
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import fc from 'fast-check';
import { AVATAR_PRESET_IDS, PINS, type PinTier } from '@dwt/shared';

import { PinView } from '../PinView';
import { TIER_COLOR } from '../pinTierMeta';
import { renderAvatarPreset } from '../../../avatars/AvatarPresets';
import { resetTestScheme, setTestScheme } from '../../../test/themeTestUtils';

const TIERS = Object.keys(TIER_COLOR) as PinTier[];

function pinIdForTier(tier: PinTier): string {
  const pin = PINS.find((p) => p.tier === tier);
  if (!pin) throw new Error(`no catalog pin for tier ${tier}`);
  return pin.id;
}

function treeUnder(scheme: 'light' | 'dark', el: () => React.ReactElement): string {
  setTestScheme(scheme);
  const view = render(el());
  const json = JSON.stringify(view.toJSON());
  view.unmount();
  return json;
}

afterEach(resetTestScheme);

describe('Property 18: artwork is invariant across schemes', () => {
  // Feature: dark-mode, Property 18: artwork is invariant across schemes
  it('every pin tier (locked and unlocked) renders identically under light and dark', () => {
    fc.assert(
      fc.property(fc.constantFrom(...TIERS), fc.boolean(), (tier, unlocked) => {
        const el = () => (
          <PinView pinId={pinIdForTier(tier)} tier={tier} unlocked={unlocked} motion={false} testID="pin" />
        );
        const light = treeUnder('light', el);
        const dark = treeUnder('dark', el);
        expect(light).toContain('RNSVGSvgView');
        expect(dark).toBe(light);
        resetTestScheme();
      }),
      { numRuns: 100 },
    );
  });

  // Feature: dark-mode, Property 18: artwork is invariant across schemes
  it('every avatar preset renders identically under light and dark', () => {
    fc.assert(
      fc.property(fc.constantFrom(...AVATAR_PRESET_IDS), (id) => {
        const el = () => <>{renderAvatarPreset(id, 64)}</>;
        const light = treeUnder('light', el);
        const dark = treeUnder('dark', el);
        expect(light.length).toBeGreaterThan(10);
        expect(dark).toBe(light);
        resetTestScheme();
      }),
      { numRuns: 100 },
    );
  });
});
