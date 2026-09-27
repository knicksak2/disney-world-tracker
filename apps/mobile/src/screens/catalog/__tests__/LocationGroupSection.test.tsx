// Feature: experience-detail-redesign — LocationGroupSection tests
//
// Validates: Requirements 10.1, 14.4

import React from 'react';
import { render } from '@testing-library/react-native';

import LocationGroupSection, {
  resolveLandmarkDetails,
} from '../LocationGroupSection';
import type { TagGroup } from '../infoTags';

describe('LocationGroupSection & resolveLandmarkDetails', () => {
  describe('resolveLandmarkDetails', () => {
    it('resolves Remy in France Pavilion near International Gateway for EPCOT', () => {
      const details = resolveLandmarkDetails(
        "Remy's Ratatouille Adventure",
        'World Showcase',
        'EPCOT',
        28.36825,
        -81.553097,
      );

      expect(details.area).toBe('France Pavilion');
      expect(details.hubWalk).toContain('from International Gateway');
      expect(details.hubWalk).not.toContain('Central Hub');
      expect(details.detail).toContain('France Pavilion');
    });

    it('resolves Star Tours in Echo Lake near Chinese Theatre for Hollywood Studios', () => {
      const details = resolveLandmarkDetails(
        'Star Tours – The Adventures Continue',
        'Echo Lake',
        'Hollywood Studios',
        28.355695,
        -81.558891,
      );

      expect(details.area).toBe('Echo Lake Plaza');
      expect(details.hubWalk).toContain('from Chinese Theatre');
      expect(details.hubWalk).not.toContain('Central Hub');
      expect(details.detail).toContain('Echo Lake');
    });

    it('resolves Pirates of the Caribbean in Caribbean Plaza for Magic Kingdom', () => {
      const details = resolveLandmarkDetails(
        'Pirates of the Caribbean',
        'Adventureland',
        'Magic Kingdom',
        28.418129,
        -81.584228,
      );

      expect(details.area).toBe('Caribbean Plaza');
      expect(details.hubWalk).toContain('from Central Plaza');
      expect(details.hubWalk).not.toContain('Central Hub');
      expect(details.detail).toContain('Caribbean Plaza');
    });

    it('resolves Flight of Passage in Valley of Mo\'ara for Animal Kingdom', () => {
      const details = resolveLandmarkDetails(
        'Avatar Flight of Passage',
        'Pandora - The World of Avatar',
        'Animal Kingdom',
        28.355554,
        -81.592147,
      );

      expect(details.area).toBe("Valley of Mo'ara");
      expect(details.hubWalk).toContain('from Tree of Life');
      expect(details.hubWalk).not.toContain('Central Hub');
      expect(details.detail).toContain('Valley of Mo\'ara');
    });

    it('falls back gracefully to park landmarks when coordinates are null', () => {
      const epcotGeneric = resolveLandmarkDetails(
        'Some Experience',
        'World Showcase',
        'EPCOT',
      );
      expect(epcotGeneric.hubWalk).toContain('from World Showcase Plaza');
      expect(epcotGeneric.hubWalk).not.toContain('Central Hub');

      const dhsGeneric = resolveLandmarkDetails(
        'Some Experience',
        'Echo Lake',
        'Hollywood Studios',
      );
      expect(dhsGeneric.hubWalk).toContain('from Chinese Theatre');
      expect(dhsGeneric.hubWalk).not.toContain('Central Hub');

      const dakGeneric = resolveLandmarkDetails(
        'Some Experience',
        'Africa',
        'Animal Kingdom',
      );
      expect(dakGeneric.hubWalk).toContain('from Tree of Life');
      expect(dakGeneric.hubWalk).not.toContain('Central Hub');
    });

    it('resolves Coronado Springs Resort and its experiences without falling back to Central Plaza', () => {
      const resort = resolveLandmarkDetails(
        "Disney's Coronado Springs Resort",
        undefined,
        undefined,
        28.3644,
        -81.5694,
        "Disney's Coronado Springs Resort",
        'Animal Kingdom Resort Area',
      );
      expect(resort.area).toBe('El Centro & Gran Destino Tower');
      expect(resort.hubWalk).toContain('1000 W Buena Vista Dr');
      expect(resort.hubWalk).not.toContain('Central Plaza');
      expect(resort.detail).toContain('Animal Kingdom Resort Area');

      const painting = resolveLandmarkDetails(
        'Colors of Coronado Painting Experience',
        undefined,
        undefined,
        null,
        null,
        "Disney's Coronado Springs Resort",
        'Animal Kingdom Resort Area',
      );
      expect(painting.area).toBe('Gran Destino Tower');
      expect(painting.hubWalk).toContain('El Centro Lobby');
      expect(painting.hubWalk).not.toContain('Central Plaza');
      expect(painting.detail).toContain('Gran Destino Tower');

      const dining = resolveLandmarkDetails(
        'El Mercado de Coronado',
        undefined,
        undefined,
        null,
        null,
        "Disney's Coronado Springs Resort",
        'Animal Kingdom Resort Area',
      );
      expect(dining.area).toBe('El Centro Commercial Corridor');
      expect(dining.hubWalk).toContain('Main Lobby');
      expect(dining.hubWalk).not.toContain('Central Plaza');
      expect(dining.detail).toContain('El Centro main building');
    });
  });

  describe('LocationGroupSection rendering', () => {
    it('renders clean route title and accurate walking blurb for Remy', () => {
      const group: TagGroup = {
        id: 'location',
        label: 'Location',
        tags: [
          { kind: 'park', label: 'EPCOT', accessibilityLabel: 'Park: EPCOT' },
          { kind: 'land', label: 'World Showcase', accessibilityLabel: 'Land: World Showcase' },
        ],
      };

      const { getByText, queryByText } = render(
        <LocationGroupSection
          group={group}
          experienceName="Remy's Ratatouille Adventure"
          latitude={28.36825}
          longitude={-81.553097}
        />,
      );

      expect(getByText('World Showcase • France Pavilion')).toBeTruthy();
      expect(getByText('EPCOT • Landmark Navigation')).toBeTruthy();
      expect(getByText(/from International Gateway/)).toBeTruthy();
      expect(queryByText(/Central Hub/)).toBeNull();
      expect(queryByText(/Landmark Area/)).toBeNull();
    });

    it('renders clean route title and accurate walking blurb for Star Tours', () => {
      const group: TagGroup = {
        id: 'location',
        label: 'Location',
        tags: [
          { kind: 'park', label: 'Hollywood Studios', accessibilityLabel: 'Park: Hollywood Studios' },
          { kind: 'land', label: 'Echo Lake', accessibilityLabel: 'Land: Echo Lake' },
        ],
      };

      const { getByText, queryByText } = render(
        <LocationGroupSection
          group={group}
          experienceName="Star Tours – The Adventures Continue"
          latitude={28.355695}
          longitude={-81.558891}
        />,
      );

      expect(getByText('Echo Lake • Echo Lake Plaza')).toBeTruthy();
      expect(getByText('Hollywood Studios • Landmark Navigation')).toBeTruthy();
      expect(getByText(/from Chinese Theatre/)).toBeTruthy();
      expect(queryByText(/Central Hub/)).toBeNull();
      expect(queryByText(/Landmark Area/)).toBeNull();
    });

    it('renders property landmark subtitle and accurate resort title for Coronado Springs', () => {
      const group: TagGroup = {
        id: 'location',
        label: 'Location',
        tags: [
          {
            kind: 'resort',
            label: "Disney's Coronado Springs Resort",
            accessibilityLabel: "Resort: Disney's Coronado Springs Resort",
          },
          {
            kind: 'resortArea',
            label: 'Animal Kingdom Resort Area',
            accessibilityLabel: 'Resort area: Animal Kingdom Resort Area',
          },
        ],
      };

      const { getByText, queryByText } = render(
        <LocationGroupSection
          group={group}
          experienceName="Disney's Coronado Springs Resort"
          latitude={28.3644}
          longitude={-81.5694}
        />,
      );

      expect(
        getByText("Disney's Coronado Springs Resort • Animal Kingdom Resort Area"),
      ).toBeTruthy();
      expect(
        getByText("Disney's Coronado Springs Resort • Property Landmark"),
      ).toBeTruthy();
      expect(getByText(/1000 W Buena Vista Dr/)).toBeTruthy();
      expect(queryByText(/Central Plaza/)).toBeNull();
      expect(queryByText(/Magic Kingdom/)).toBeNull();
    });
  });
});
