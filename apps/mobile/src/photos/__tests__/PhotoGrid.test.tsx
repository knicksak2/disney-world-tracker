// Feature: photo-uploads, decision D35 — PhotoGrid per-tile label (Requirement 15.32)

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { PhotoGrid } from '../PhotoGrid';

describe('PhotoGrid labels', () => {
  it('uses the item accessibilityLabel on the tile and the image', () => {
    render(
      <PhotoGrid
        photos={[
          {
            id: 'p1',
            thumbUrl: 'https://r2.test/p/p1/thumb.jpg',
            accessibilityLabel: 'Trip photo 3 of 12, opens viewer',
          },
        ]}
      />,
    );

    const tile = screen.getByTestId('photo-grid-tile-p1');
    expect(tile.props.accessibilityLabel).toBe('Trip photo 3 of 12, opens viewer');
    expect(tile.props.accessibilityRole).toBe('imagebutton');
    // Tile and image both carry the label.
    expect(screen.getAllByLabelText('Trip photo 3 of 12, opens viewer')).toHaveLength(2);
    expect(screen.queryByLabelText('Guest photo')).toBeNull();
  });

  it('keeps the "Guest photo" default without a label', () => {
    render(<PhotoGrid photos={[{ id: 'p2', thumbUrl: 'https://r2.test/p/p2/thumb.jpg' }]} />);

    expect(screen.getByTestId('photo-grid-tile-p2').props.accessibilityLabel).toBe('Guest photo');
  });

  it('still labels a dish photo "Photo of <name>"', () => {
    render(
      <PhotoGrid
        photos={[{ id: 'p3', thumbUrl: 'https://r2.test/p/p3/thumb.jpg', foodItemName: 'Dole Whip' }]}
      />,
    );

    expect(screen.getByTestId('photo-grid-tile-p3').props.accessibilityLabel).toBe('Photo of Dole Whip');
  });

  it('calls onSelectPhoto with the pressed item', () => {
    const onSelect = jest.fn();
    const item = { id: 'p4', thumbUrl: 'https://r2.test/p/p4/thumb.jpg' };
    render(<PhotoGrid photos={[item]} onSelectPhoto={onSelect} />);

    fireEvent.press(screen.getByTestId('photo-grid-tile-p4'));

    expect(onSelect).toHaveBeenCalledWith(item);
  });
});
