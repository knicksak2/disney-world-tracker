import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Card } from '../components';

describe('Card component', () => {
  it('applies flex: 1 directly to the element with testID when onPress is undefined', () => {
    render(
      <Card style={{ flex: 1 }} testID="test-card">
        <Text>Content</Text>
      </Card>,
    );

    const card = screen.getByTestId('test-card');
    const flatStyle = StyleSheet.flatten(card.props.style);
    expect(flatStyle.flex).toBe(1);
    expect(screen.getByText('Content')).toBeTruthy();
  });

  it('applies styles and handles onPress on root Pressable when onPress is provided', () => {
    const onPressMock = jest.fn();
    render(
      <Card
        style={{ flex: 1 }}
        testID="pressable-card"
        onPress={onPressMock}
        accessibilityRole="button"
        accessibilityLabel="Press Me"
      >
        <Text>Pressable Content</Text>
      </Card>,
    );

    const card = screen.getByTestId('pressable-card');
    const flatStyle = StyleSheet.flatten(card.props.style);
    expect(flatStyle.flex).toBe(1);

    fireEvent.press(card);
    expect(onPressMock).toHaveBeenCalledTimes(1);
  });

  it('applies accentColor as borderLeftColor', () => {
    render(
      <Card accentColor="#FF0000" testID="accent-card">
        <Text>Accent</Text>
      </Card>,
    );

    const card = screen.getByTestId('accent-card');
    const flatStyle = StyleSheet.flatten(card.props.style);
    expect(flatStyle.borderLeftColor).toBe('#FF0000');
    expect(flatStyle.borderLeftWidth).toBe(4);
  });
});
