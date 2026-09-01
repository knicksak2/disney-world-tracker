/**
 * Component tests for ResortPicker search and selection.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { ResortDTO } from '@dwt/shared';

import { ResortPicker } from '../ResortPicker';

describe('ResortPicker', () => {
  const mockResorts: ResortDTO[] = [
    {
      id: 'res-coronado',
      name: "Disney's Coronado Springs Resort",
      description: null,
      imageUrl: null,
      latitude: null,
      longitude: null,
      address: null,
      phone: null,
      representingExperienceId: null,
    },
    {
      id: 'res-riviera',
      name: "Disney's Riviera Resort",
      description: null,
      imageUrl: null,
      latitude: null,
      longitude: null,
      address: null,
      phone: null,
      representingExperienceId: null,
    },
    {
      id: 'res-yacht-beach',
      name: "Disney's Yacht & Beach Club Resorts",
      description: null,
      imageUrl: null,
      latitude: null,
      longitude: null,
      address: null,
      phone: null,
      representingExperienceId: null,
    },
  ];

  it('renders all resorts when search query is empty', () => {
    const onToggle = jest.fn();
    render(
      <ResortPicker
        resorts={mockResorts}
        selectedIds={[]}
        onToggle={onToggle}
        testIDPrefix="test"
      />,
    );

    expect(screen.getByTestId('test-resort-res-coronado')).toBeTruthy();
    expect(screen.getByTestId('test-resort-res-riviera')).toBeTruthy();
    expect(screen.getByTestId('test-resort-res-yacht-beach')).toBeTruthy();
  });

  it('filters resorts using normalized search with connectors (& vs and)', () => {
    const onToggle = jest.fn();
    render(
      <ResortPicker
        resorts={mockResorts}
        selectedIds={[]}
        onToggle={onToggle}
        testIDPrefix="test"
      />,
    );

    const searchInput = screen.getByTestId('test-search');
    fireEvent.changeText(searchInput, 'Yacht and Beach');

    expect(screen.getByTestId('test-resort-res-yacht-beach')).toBeTruthy();
    expect(screen.queryByTestId('test-resort-res-coronado')).toBeNull();
    expect(screen.queryByTestId('test-resort-res-riviera')).toBeNull();
  });

  it('filters resorts without apostrophe requirement', () => {
    const onToggle = jest.fn();
    render(
      <ResortPicker
        resorts={mockResorts}
        selectedIds={[]}
        onToggle={onToggle}
        testIDPrefix="test"
      />,
    );

    const searchInput = screen.getByTestId('test-search');
    fireEvent.changeText(searchInput, 'Disneys Riviera');

    expect(screen.getByTestId('test-resort-res-riviera')).toBeTruthy();
    expect(screen.queryByTestId('test-resort-res-coronado')).toBeNull();
  });

  it('calls onToggle when a resort row is pressed', () => {
    const onToggle = jest.fn();
    render(
      <ResortPicker
        resorts={mockResorts}
        selectedIds={[]}
        onToggle={onToggle}
        testIDPrefix="test"
      />,
    );

    fireEvent.press(screen.getByTestId('test-resort-res-coronado'));
    expect(onToggle).toHaveBeenCalledWith('res-coronado');
  });

  it('renders selected resort chips and calls onToggle on chip press', () => {
    const onToggle = jest.fn();
    render(
      <ResortPicker
        resorts={mockResorts}
        selectedIds={['res-riviera']}
        onToggle={onToggle}
        testIDPrefix="test"
      />,
    );

    const chip = screen.getByTestId('test-chip-res-riviera');
    expect(chip).toBeTruthy();

    fireEvent.press(chip);
    expect(onToggle).toHaveBeenCalledWith('res-riviera');
  });
});
