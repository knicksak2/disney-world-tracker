import { ScrollView, FlatList, SectionList } from 'react-native';

/**
 * Global default for scrollable containers.
 *
 * In React Native, the default `keyboardShouldPersistTaps` is 'never'.
 * When a TextInput is focused and the software keyboard is visible,
 * tapping any button/touchable inside a ScrollView, FlatList, or SectionList
 * is swallowed by the scroll container to dismiss the keyboard, requiring
 * the user to tap a second time to execute the action.
 *
 * Setting `keyboardShouldPersistTaps` to 'handled' ensures that:
 * 1. Tapping an interactive child (button, pressable, chip, row) triggers
 *    the action immediately on the first tap.
 * 2. Tapping empty/unhandled background space in the scroll container
 *    dismisses the keyboard as expected.
 *
 * Explicit props on individual components (`keyboardShouldPersistTaps="always"`
 * or `"never"`) continue to take precedence.
 */
interface ComponentWithDefaultProps {
  defaultProps?: Record<string, unknown>;
}

const scrollComponents: ComponentWithDefaultProps[] = [
  ScrollView as unknown as ComponentWithDefaultProps,
  FlatList as unknown as ComponentWithDefaultProps,
  SectionList as unknown as ComponentWithDefaultProps,
];

for (const comp of scrollComponents) {
  if (comp) {
    comp.defaultProps = {
      ...(comp.defaultProps || {}),
      keyboardShouldPersistTaps: 'handled',
    };
  }
}
