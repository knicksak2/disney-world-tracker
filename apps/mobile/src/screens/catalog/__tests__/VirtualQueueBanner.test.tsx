// Feature: experience-detail-redesign, Task 17.2 — VirtualQueueBanner tests
//
// Property 24: Virtual Queue Banner renders iff state is present
// Validates: Requirements 15.1, 15.2, 15.3, 15.4

import React from 'react';
import { render } from '@testing-library/react-native';
import VirtualQueueBanner from '../VirtualQueueBanner';

describe('VirtualQueueBanner (Task 17.2)', () => {
  // Feature: experience-detail-redesign, Property 24: Virtual Queue Banner renders iff state is present
  // Validates: Requirements 15.1, 15.3
  describe('Property 24: renders iff state is a non-empty string', () => {
    it('omits banner when boardingGroup is undefined', () => {
      const { queryByTestId } = render(<VirtualQueueBanner boardingGroup={undefined} />);
      expect(queryByTestId('experience-virtual-queue-banner')).toBeNull();
    });

    it('omits banner when boardingGroup is empty object or state is absent', () => {
      const { queryByTestId } = render(
        <VirtualQueueBanner boardingGroup={{ available: true } as any} />,
      );
      expect(queryByTestId('experience-virtual-queue-banner')).toBeNull();
    });

    it('omits banner when boardingGroup has range but no state', () => {
      const { queryByTestId } = render(
        <VirtualQueueBanner
          boardingGroup={{ currentGroupStart: 10, currentGroupEnd: 20 } as any}
        />
      );
      expect(queryByTestId('experience-virtual-queue-banner')).toBeNull();
    });

    it('omits banner when state is empty or whitespace string', () => {
      const { queryByTestId: q1 } = render(
        <VirtualQueueBanner boardingGroup={{ state: '' }} />,
      );
      expect(q1('experience-virtual-queue-banner')).toBeNull();

      const { queryByTestId: q2 } = render(
        <VirtualQueueBanner boardingGroup={{ state: '   ' }} />,
      );
      expect(q2('experience-virtual-queue-banner')).toBeNull();
    });

    it('renders banner when state is a non-empty string', () => {
      const { getByTestId, getByText } = render(
        <VirtualQueueBanner boardingGroup={{ state: 'Open' }} />,
      );
      expect(getByTestId('experience-virtual-queue-banner')).toBeTruthy();
      expect(getByText('Open')).toBeTruthy();
    });
  });

  describe('Range display & accessibility (R15.2, R15.4)', () => {
    it('displays range and accessibility label when both start and end group are present', () => {
      const { getByTestId, getByText } = render(
        <VirtualQueueBanner
          boardingGroup={{
            state: 'Open',
            currentGroupStart: 15,
            currentGroupEnd: 30,
          }}
        />,
      );

      const banner = getByTestId('experience-virtual-queue-banner');
      expect(banner).toBeTruthy();
      expect(getByTestId('vq-group-range')).toBeTruthy();
      expect(getByText('Groups 15\u201330')).toBeTruthy();

      const a11y = banner.props.accessibilityLabel;
      expect(a11y).toBeTruthy();
      expect(a11y).toContain('Open');
      expect(a11y).toContain('15');
      expect(a11y).toContain('30');
    });

    it('omits range badge when only start group is present', () => {
      const { getByTestId, queryByTestId } = render(
        <VirtualQueueBanner
          boardingGroup={{
            state: 'Boarding',
            currentGroupStart: 15,
          }}
        />,
      );

      expect(getByTestId('experience-virtual-queue-banner')).toBeTruthy();
      expect(queryByTestId('vq-group-range')).toBeNull();
    });

    it('provides non-empty accessibility label when range is absent', () => {
      const { getByTestId } = render(
        <VirtualQueueBanner boardingGroup={{ state: 'Closed' }} />,
      );
      const banner = getByTestId('experience-virtual-queue-banner');
      expect(banner.props.accessibilityLabel).toBe('Virtual Queue: Closed');
    });
  });
});
