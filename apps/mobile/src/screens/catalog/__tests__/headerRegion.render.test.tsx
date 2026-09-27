// Feature: experience-detail-redesign, Task 16.4 — Header region render tests
//
// Validates: Requirements 11.1, 11.3, 11.4, 11.5, 11.6, 11.7, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import type { LiveDetailResponseDTO } from '@dwt/shared';

import LiveStatusStrip from '../LiveStatusStrip';
import QuickSpecsRow from '../QuickSpecsRow';
import LensSwitcher from '../LensSwitcher';

describe('Header region components (Task 16.4)', () => {
  describe('LiveStatusStrip (Requirements 12.1-12.7)', () => {
    it('R12.2: renders standby wait and Lightning Lane state for Ride', () => {
      const mockLiveQuery = {
        data: {
          liveDetail: {
            status: 'Operating' as const,
            waitMinutes: 45,
            showtimes: [],
            operatingHours: [],
            diningAvailability: [],
            lightningLane: {
              available: true,
              returnStart: '2026-09-24T14:00:00Z',
              returnEnd: '2026-09-24T15:00:00Z',
            },
          },
          retrievedAt: '2026-09-24T12:00:00Z',
          stale: false,
        } as LiveDetailResponseDTO,
        isLoading: false,
        isError: false,
      };

      const { getByTestId, getByText } = render(
        <LiveStatusStrip category="Ride" liveQuery={mockLiveQuery} />,
      );

      expect(getByTestId('live-status-strip')).toBeTruthy();
      expect(getByText('45 min wait')).toBeTruthy();
      expect(getByTestId('live-status-ll')).toBeTruthy();
    });

    it('R12.2: renders closed/down indication when not Operating', () => {
      const mockLiveQuery = {
        data: {
          liveDetail: {
            status: 'Closed' as const,
            showtimes: [],
            operatingHours: [],
            diningAvailability: [],
          },
          retrievedAt: '2026-09-24T12:00:00Z',
          stale: false,
        } as LiveDetailResponseDTO,
        isLoading: false,
        isError: false,
      };

      const { getByText } = render(
        <LiveStatusStrip category="Ride" liveQuery={mockLiveQuery} />,
      );

      expect(getByText('Closed')).toBeTruthy();
    });

    it('R12.3: renders reservation availability for Restaurant', () => {
      const mockLiveQuery = {
        data: {
          liveDetail: {
            status: 'Operating' as const,
            showtimes: [],
            operatingHours: [
              {
                open: '2026-09-24T16:00:00Z',
                close: '2026-09-24T22:00:00Z',
              },
            ],
            diningAvailability: [
              {
                status: 'Walk-up available',
                estimatedWaitMinutes: 20,
              },
            ],
          },
          retrievedAt: '2026-09-24T12:00:00Z',
          stale: false,
        } as LiveDetailResponseDTO,
        isLoading: false,
        isError: false,
      };

      const { getByTestId, getByText } = render(
        <LiveStatusStrip category="Restaurant" liveQuery={mockLiveQuery} />,
      );

      expect(getByTestId('live-status-headline')).toBeTruthy();
      expect(getByText(/Walk-up available/)).toBeTruthy();
      expect(getByText(/20 min wait/)).toBeTruthy();
    });

    it('R12.4: renders next-showtime countdown and clock time for Show', () => {
      const mockNow = new Date('2026-09-24T13:30:00Z');
      const mockLiveQuery = {
        data: {
          liveDetail: {
            status: 'Operating' as const,
            showtimes: [
              {
                start: '2026-09-24T14:00:00Z', // 30 minutes in the future
              },
            ],
            operatingHours: [],
            diningAvailability: [],
          },
          retrievedAt: '2026-09-24T12:00:00Z',
          stale: false,
        } as LiveDetailResponseDTO,
        isLoading: false,
        isError: false,
      };

      const { getByTestId, getByText } = render(
        <LiveStatusStrip category="Show" liveQuery={mockLiveQuery} now={mockNow} />,
      );

      expect(getByTestId('live-status-headline')).toBeTruthy();
      expect(getByText(/Next in 30 min/)).toBeTruthy();
    });

    it('R12.5: omits LiveStatusStrip when liveSectionFor returns none', () => {
      const mockLiveQuery = {
        data: {
          liveDetail: {
            status: 'Operating' as const,
            showtimes: [],
            operatingHours: [],
            diningAvailability: [],
          },
          retrievedAt: '2026-09-24T12:00:00Z',
          stale: false,
        } as LiveDetailResponseDTO,
        isLoading: false,
        isError: false,
      };

      const { queryByTestId } = render(
        <LiveStatusStrip category="Tour" liveQuery={mockLiveQuery} />,
      );

      expect(queryByTestId('live-status-strip')).toBeNull();
    });

    it('R12.6: renders live-unavailable indicator on live failure', () => {
      const mockLiveQuery = {
        data: undefined,
        isLoading: false,
        isError: true,
      };

      const { getByTestId, getByText } = render(
        <LiveStatusStrip category="Ride" liveQuery={mockLiveQuery} />,
      );

      expect(getByTestId('live-status-strip-unavailable')).toBeTruthy();
      expect(getByTestId('live-unavailable')).toBeTruthy();
      expect(getByText('Live information unavailable')).toBeTruthy();
    });
  });

  describe('QuickSpecsRow (Requirement 11.3)', () => {
    it('renders duration, height, climate, and feature chips', () => {
      const experience = {
        category: 'Ride',
        subType: 'Boat Ride',
        heightRequirement: { name: 'Any Height' },
        physicalConsiderations: [{ name: 'Indoor air-conditioned' }],
        interestFacets: {
          general: [{ name: 'Water Classic' }],
        },
      };

      const { getByTestId, getByText } = render(
        <QuickSpecsRow experience={experience} />,
      );

      expect(getByTestId('experience-quick-specs-row')).toBeTruthy();
      expect(getByTestId('spec-duration')).toBeTruthy();
      expect(getByText('Boat Ride')).toBeTruthy();
      expect(getByTestId('spec-height')).toBeTruthy();
      expect(getByText('Any Height')).toBeTruthy();
      expect(getByTestId('spec-climate')).toBeTruthy();
      expect(getByText('Indoor A/C')).toBeTruthy();
      expect(getByTestId('spec-feature')).toBeTruthy();
      expect(getByText('Water Classic')).toBeTruthy();
    });

    it('renders service type, price tier, climate, and cuisine for Restaurant matching mockup', () => {
      const restaurantExp = {
        category: 'Restaurant',
        subType: 'Table Service',
        priceTier: '$$$',
        physicalConsiderations: [{ name: 'Indoor air-conditioned' }],
        groupedFacets: {
          cuisine: [{ name: 'French' }],
        },
      };

      const { getByTestId, getByText } = render(
        <QuickSpecsRow experience={restaurantExp} />,
      );

      expect(getByTestId('experience-quick-specs-row')).toBeTruthy();
      expect(getByTestId('spec-duration')).toBeTruthy();
      expect(getByText('Table Service')).toBeTruthy();
      expect(getByTestId('spec-height')).toBeTruthy();
      expect(getByText('$$$ Price Tier')).toBeTruthy();
      expect(getByTestId('spec-climate')).toBeTruthy();
      expect(getByText('Indoor A/C')).toBeTruthy();
      expect(getByTestId('spec-feature')).toBeTruthy();
      expect(getByText('French Cuisine')).toBeTruthy();
    });

    it('renders Table Service and World Cuisine for Skipper Canteen with Reservations Accepted subType', () => {
      const skipperExp = {
        category: 'Restaurant',
        name: 'Jungle Navigation Co. LTD Skipper Canteen',
        subType: 'Reservations Accepted',
        priceTier: '$$',
        physicalConsiderations: [{ name: 'Indoor air-conditioned' }],
        description: 'Feast on bold, flavorful dishes inspired by the rivers of Asia, Africa, and South America.',
      };

      const { getByTestId, getByText } = render(
        <QuickSpecsRow experience={skipperExp} />,
      );

      expect(getByTestId('experience-quick-specs-row')).toBeTruthy();
      expect(getByTestId('spec-duration')).toBeTruthy();
      expect(getByText('Table Service')).toBeTruthy();
      expect(getByTestId('spec-height')).toBeTruthy();
      expect(getByText('$$ Price Tier')).toBeTruthy();
      expect(getByTestId('spec-climate')).toBeTruthy();
      expect(getByText('Indoor A/C')).toBeTruthy();
      expect(getByTestId('spec-feature')).toBeTruthy();
      expect(getByText('World Cuisine')).toBeTruthy();
    });

    it('renders 12 min show for Mickey\'s PhilharMagic', () => {
      const philharExp = {
        category: 'Show',
        name: "Mickey's PhilharMagic",
        heightRequirement: { name: 'Any Height' },
        physicalConsiderations: [{ name: 'Indoor air-conditioned' }],
      };

      const { getByTestId, getByText } = render(
        <QuickSpecsRow experience={philharExp} />,
      );

      expect(getByTestId('spec-duration')).toBeTruthy();
      expect(getByText('12 min show')).toBeTruthy();
      expect(getByText('Indoor A/C')).toBeTruthy();
    });

    it('renders 20 min show and Outdoor for The Dapper Dans', () => {
      const dapperExp = {
        category: 'Show',
        name: 'The Dapper Dans',
        subType: 'Atmosphere',
        heightRequirement: { name: 'Any Height' },
      };

      const { getByTestId, getByText } = render(
        <QuickSpecsRow experience={dapperExp} />,
      );

      expect(getByTestId('spec-duration')).toBeTruthy();
      expect(getByText('20 min show')).toBeTruthy();
      expect(getByText('Outdoor')).toBeTruthy();
    });

    it('renders Outdoor for Jungle Cruise and Seven Dwarfs Mine Train', () => {
      const jungleExp = {
        category: 'Ride',
        name: 'Jungle Cruise',
        heightRequirement: { name: 'Any Height' },
      };

      const { getByText: getByTextJungle } = render(
        <QuickSpecsRow experience={jungleExp} />,
      );
      expect(getByTextJungle('Outdoor')).toBeTruthy();

      const mineTrainExp = {
        category: 'Ride',
        name: 'Seven Dwarfs Mine Train',
        heightRequirement: { name: '38 in (97 cm)' },
      };

      const { getByText: getByTextMine } = render(
        <QuickSpecsRow experience={mineTrainExp} />,
      );
      expect(getByTextMine('Outdoor')).toBeTruthy();
    });

    it('renders Outdoor for Big Thunder Mountain Railroad and PeopleMover, and Indoor A/C for Carousel of Progress', () => {
      const btmExp = {
        category: 'Ride',
        name: 'Big Thunder Mountain Railroad',
        heightRequirement: { name: '40 in (102 cm)' },
      };
      const { getByText: getByTextBtm } = render(
        <QuickSpecsRow experience={btmExp} />,
      );
      expect(getByTextBtm('Outdoor')).toBeTruthy();

      const ttaExp = {
        category: 'Ride',
        name: 'Tomorrowland Transit Authority PeopleMover',
        heightRequirement: { name: 'Any Height' },
      };
      const { getByText: getByTextTta } = render(
        <QuickSpecsRow experience={ttaExp} />,
      );
      expect(getByTextTta('Outdoor')).toBeTruthy();

      const copExp = {
        category: 'Ride',
        name: "Walt Disney's Carousel of Progress",
        heightRequirement: { name: 'Any Height' },
      };
      const { getByText: getByTextCop } = render(
        <QuickSpecsRow experience={copExp} />,
      );
      expect(getByTextCop('Indoor A/C')).toBeTruthy();
    });

    it('renders Outdoor for Blizzard Beach water park and Indoor A/C for Voices of Liberty', () => {
      const blizzardExp = {
        category: 'Ride',
        name: 'Summit Plummet',
        park: 'Blizzard Beach',
        heightRequirement: { name: '48 in (122 cm)' },
      };
      const { getByText: getByTextBlizzard } = render(
        <QuickSpecsRow experience={blizzardExp} />,
      );
      expect(getByTextBlizzard('Outdoor')).toBeTruthy();

      const volExp = {
        category: 'Show',
        name: 'Voices of Liberty',
        park: 'EPCOT',
        subType: 'Concert',
        heightRequirement: { name: 'Any Height' },
      };
      const { getByText: getByTextVol } = render(
        <QuickSpecsRow experience={volExp} />,
      );
      expect(getByTextVol('Indoor A/C')).toBeTruthy();
    });

    it('renders accurate duration chips across all parks (EPCOT, Hollywood Studios, Animal Kingdom, Magic Kingdom, Water Parks)', () => {
      // EPCOT
      const remy = { category: 'Ride', name: "Remy's Ratatouille Adventure" };
      const { getByText: getByTextRemy } = render(<QuickSpecsRow experience={remy} />);
      expect(getByTextRemy('5 min ride')).toBeTruthy();

      const cosmic = { category: 'Ride', name: 'Guardians of the Galaxy: Cosmic Rewind' };
      const { getByText: getByTextCosmic } = render(<QuickSpecsRow experience={cosmic} />);
      expect(getByTextCosmic('3 min ride')).toBeTruthy();

      const spaceship = { category: 'Ride', name: 'Spaceship Earth' };
      const { getByText: getByTextSpaceship } = render(<QuickSpecsRow experience={spaceship} />);
      expect(getByTextSpaceship('16 min ride')).toBeTruthy();

      const turtle = { category: 'Show', name: 'Turtle Talk With Crush' };
      const { getByText: getByTextTurtle } = render(<QuickSpecsRow experience={turtle} />);
      expect(getByTextTurtle('15 min show')).toBeTruthy();

      // Hollywood Studios
      const starTours = { category: 'Ride', name: 'Star Tours – The Adventures Continue' };
      const { getByText: getByTextStarTours } = render(<QuickSpecsRow experience={starTours} />);
      expect(getByTextStarTours('5 min ride')).toBeTruthy();

      const slinky = { category: 'Ride', name: 'Slinky Dog Dash' };
      const { getByText: getByTextSlinky } = render(<QuickSpecsRow experience={slinky} />);
      expect(getByTextSlinky('3 min ride')).toBeTruthy();

      const frozenSing = { category: 'Show', name: 'For the First Time in Forever: A Frozen Sing-Along Celebration' };
      const { getByText: getByTextFrozenSing } = render(<QuickSpecsRow experience={frozenSing} />);
      expect(getByTextFrozenSing('30 min show')).toBeTruthy();

      // Animal Kingdom
      const kali = { category: 'Ride', name: 'Kali River Rapids' };
      const { getByText: getByTextKali } = render(<QuickSpecsRow experience={kali} />);
      expect(getByTextKali('5 min ride')).toBeTruthy();

      const birds = { category: 'Show', name: 'Feathered Friends in Flight!' };
      const { getByText: getByTextBirds } = render(<QuickSpecsRow experience={birds} />);
      expect(getByTextBirds('25 min show')).toBeTruthy();

      // Magic Kingdom
      const tron = { category: 'Ride', name: 'TRON Lightcycle / Run' };
      const { getByText: getByTextTron } = render(<QuickSpecsRow experience={tron} />);
      expect(getByTextTron('2 min ride')).toBeTruthy();

      const tiana = { category: 'Ride', name: "Tiana's Bayou Adventure" };
      const { getByText: getByTextTiana } = render(<QuickSpecsRow experience={tiana} />);
      expect(getByTextTiana('11 min ride')).toBeTruthy();

      const laughFloor = { category: 'Show', name: 'Monsters, Inc. Laugh Floor' };
      const { getByText: getByTextLaughFloor } = render(<QuickSpecsRow experience={laughFloor} />);
      expect(getByTextLaughFloor('15 min show')).toBeTruthy();

      // Water Parks
      const crushGusher = { category: 'Ride', name: "Crush 'n' Gusher" };
      const { getByText: getByTextCrush } = render(<QuickSpecsRow experience={crushGusher} />);
      expect(getByTextCrush('3 min ride')).toBeTruthy();

      const summit = { category: 'Ride', name: 'Summit Plummet' };
      const { getByText: getByTextSummit } = render(<QuickSpecsRow experience={summit} />);
      expect(getByTextSummit('1 min ride')).toBeTruthy();
    });

    it('R20.1: renders Tier, Primary Transit, and Feature Pool for Resort category, and no Area chip', () => {
      const coronadoExp = {
        category: 'Resort',
        name: "Disney's Coronado Springs Resort",
        tier: 'Moderate',
        resortArea: "Disney's Animal Kingdom Resort Area",
        transportationModes: ['Bus'],
        featurePool: 'The Dig Site & Lost City of Cibola Pool',
      };
      const { getByText, getByTestId, queryByTestId } = render(
        <QuickSpecsRow experience={coronadoExp as any} />,
      );

      expect(getByTestId('spec-tier')).toBeTruthy();
      expect(getByText('Moderate Resort')).toBeTruthy();
      expect(getByTestId('spec-transit')).toBeTruthy();
      expect(getByText('Bus Transit')).toBeTruthy();
      expect(getByTestId('spec-pool')).toBeTruthy();
      const poolText = getByText('The Dig Site & Lost City of Cibola Pool');
      expect(poolText).toBeTruthy();

      // R20.1: the Geographic Area chip is deliberately omitted from
      // Quick_Specs_Row — it is already conveyed by the header subtitle and
      // the hero photo's location pill (R20.7), so repeating it here would
      // starve the remaining three chips of space.
      expect(queryByTestId('spec-area')).toBeNull();

      // With the Area chip gone, the remaining three no longer split the row
      // into equal thirds: only the longest-text chip (the feature pool name)
      // grows to absorb the freed-up width, while the short, fixed-length
      // chips (tier, transit) stay at their natural size instead of also
      // being stretched (which would just add empty padding around them).
      const flatten = (style: unknown): Record<string, unknown> =>
        Object.assign({}, ...(Array.isArray(style) ? style : [style]));
      const tierFlex = flatten(getByTestId('spec-tier').props.style);
      const transitFlex = flatten(getByTestId('spec-transit').props.style);
      const poolFlex = flatten(getByTestId('spec-pool').props.style);
      expect(tierFlex.flexGrow).toBe(0);
      expect(transitFlex.flexGrow).toBe(0);
      expect(poolFlex.flexGrow).toBe(1);

      // A genuinely long feature-pool name (this fixture's 40-character
      // "The Dig Site & Lost City of Cibola Pool") still can't fit on one
      // line even with the growing chip's extra width, so this chip alone is
      // allowed to wrap onto a second line instead of permanently
      // ellipsizing — the other two chips stay single-line.
      expect(poolText.props.numberOfLines).toBe(2);
      expect(getByText('Moderate Resort').props.numberOfLines).toBe(1);
      expect(getByText('Bus Transit').props.numberOfLines).toBe(1);

      // The pool chip stays centered like its neighbors (so a short name
      // doesn't look orphaned against the left edge), but carries a fixed
      // left padding so the icon keeps a minimum gap from the preceding
      // divider even when a long name fills the whole slot and leftover
      // centered space is near zero.
      expect(poolFlex.justifyContent).toBe('center');
      expect(poolFlex.paddingLeft).toBeGreaterThan(0);
    });

    it('renders authentic Beach Club resort chips (Deluxe, Boat Transit, Stormalong Bay), no Area chip', () => {
      const beachClubExp = {
        category: 'Resort',
        name: "Disney's Beach Club Resort",
        tier: 'Deluxe',
        resortArea: "Disney's EPCOT Resort Area",
        transportationModes: ['Boat', 'Walking', 'Skyliner', 'Bus'],
        featurePool: 'Stormalong Bay',
      };
      const { getByText, getByTestId, queryByTestId } = render(
        <QuickSpecsRow experience={beachClubExp as any} />,
      );

      expect(getByTestId('spec-tier')).toBeTruthy();
      expect(getByText('Deluxe Resort')).toBeTruthy();
      expect(getByTestId('spec-transit')).toBeTruthy();
      expect(getByText('Boat Transit')).toBeTruthy();
      expect(getByTestId('spec-pool')).toBeTruthy();
      expect(getByText('Stormalong Bay Pool')).toBeTruthy();
      expect(queryByTestId('spec-area')).toBeNull();

      // "Stormalong Bay Pool" is short relative to the growing slot it's
      // given — it stays centered like its neighbors instead of anchoring
      // left and leaving a large empty gap on the right of the chip.
      const flatten = (style: unknown): Record<string, unknown> =>
        Object.assign({}, ...(Array.isArray(style) ? style : [style]));
      const poolFlex = flatten(getByTestId('spec-pool').props.style);
      expect(poolFlex.justifyContent).toBe('center');
    });
  });

  describe('LensSwitcher (Requirements 11.1, 11.2, 11.3, 11.4, 11.6, 20.2, 21.5)', () => {
    it('renders both segments with accessible tab role and selected state', () => {
      const onChangeLens = jest.fn();

      const { getByTestId } = render(
        <LensSwitcher activeLens="today" onChangeLens={onChangeLens} />,
      );

      const switcher = getByTestId('lens-switcher');
      expect(switcher).toBeTruthy();

      const todayTab = getByTestId('lens-tab-today');
      const passportTab = getByTestId('lens-tab-passport');

      expect(todayTab.props.accessibilityRole).toBe('tab');
      expect(todayTab.props.accessibilityState).toEqual({ selected: true });
      expect(todayTab.props.accessibilityLabel).toContain('selected');

      expect(passportTab.props.accessibilityRole).toBe('tab');
      expect(passportTab.props.accessibilityState).toEqual({ selected: false });

      // Activating inactive segment invokes callback (R11.4)
      fireEvent.press(passportTab);
      expect(onChangeLens).toHaveBeenCalledWith('passport');
    });

    it('R20.2: renders Resort Guide and Stay Passport & Lore when category is Resort', () => {
      const { getByText, getByTestId } = render(
        <LensSwitcher activeLens="today" category="Resort" />,
      );

      expect(getByText('Resort Guide')).toBeTruthy();
      expect(getByText('Stay Passport & Lore')).toBeTruthy();
      expect(getByTestId('lens-tab-today').props.accessibilityLabel).toContain('Resort Guide');
      expect(getByTestId('lens-tab-passport').props.accessibilityLabel).toContain('Stay Passport & Lore');
    });

    it('R21.5: renders Today at Resort when areaType is Resort', () => {
      const { getByText, getByTestId } = render(
        <LensSwitcher activeLens="today" category="Recreation" areaType="Resort" />,
      );

      expect(getByText('Today at Resort')).toBeTruthy();
      expect(getByText('My Passport & Lore')).toBeTruthy();
      expect(getByTestId('lens-tab-today').props.accessibilityLabel).toContain('Today at Resort');
    });
  });
});
