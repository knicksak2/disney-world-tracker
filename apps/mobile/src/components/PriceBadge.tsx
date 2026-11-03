import React from 'react';
import {
  Linking,
  Pressable,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {
  formatCalendarDateAsOf,
  priceLabelText,
  type PriceLabelKind,
  type PriceSource,
} from '@dwt/shared';

import { makeStyles } from '../theme/makeStyles';
import { usePalette } from '../theme/useAppTheme';
import { PRICE_BADGE } from './PriceBadge.palette';

export const THEMEPARKS_WIKI_URL = 'https://themeparks.wiki';
export const THEMEPARKS_WIKI_CREDIT = 'Powered by ThemeParks.wiki';

export const DISNEY_NOT_COVERED_NOTE =
  'Discounted, military, seller and special-offer prices are not covered.';

export function formatDisneySourceLine(asOfDate?: string | null): string {
  if (asOfDate) {
    const formatted = formatCalendarDateAsOf(asOfDate);
    if (formatted) {
      return `Prices from Disney's website, as of ${formatted}; final price at checkout may differ`;
    }
  }
  return `Prices from Disney's website; final price at checkout may differ`;
}

export interface PriceBadgeProps {
  readonly priceLabelKind: PriceLabelKind;
  readonly effectivePriceSource: PriceSource;
  readonly asOfDate?: string | null;
  readonly asOf?: string | null;
  readonly attribution?: 'disney' | 'themeparks_wiki' | 'none' | null;
  readonly showAttribution?: boolean;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

export function PriceBadge({
  priceLabelKind,
  effectivePriceSource,
  asOfDate,
  asOf,
  attribution,
  showAttribution = true,
  style,
  testID,
}: PriceBadgeProps): React.JSX.Element {
  const styles = useStyles();
  const palette = usePalette(PRICE_BADGE);

  const resolvedDate = asOfDate ?? asOf ?? null;
  const labelText = priceLabelText(priceLabelKind, effectivePriceSource, resolvedDate);

  const isEstimate = priceLabelKind === 'estimate';

  const shouldShowAttribution = showAttribution && attribution !== 'none';
  const showThemeParks =
    shouldShowAttribution &&
    (attribution === 'themeparks_wiki' ||
      (attribution == null && effectivePriceSource === 'themeparks_ll'));
  const showDisney =
    shouldShowAttribution &&
    (attribution === 'disney' ||
      (attribution == null && effectivePriceSource === 'disney_ticket_calendar'));

  const disneySourceText = formatDisneySourceLine(resolvedDate);

  return (
    <View style={[styles.container, style]} testID={testID}>
      <View
        style={[
          styles.badge,
          {
            backgroundColor: isEstimate ? palette.estimateBg : palette.bg,
            borderColor: isEstimate ? palette.estimateBorder : palette.border,
          },
        ]}
        accessibilityRole="text"
        accessibilityLabel={labelText}
      >
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          style={[
            styles.badgeText,
            { color: isEstimate ? palette.estimateText : palette.text },
          ]}
        >
          {labelText}
        </Text>
      </View>

      {showThemeParks && (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={THEMEPARKS_WIKI_CREDIT}
          onPress={() => {
            void Linking.openURL(THEMEPARKS_WIKI_URL);
          }}
          style={styles.attributionLink}
        >
          <Text
            style={[styles.attributionLinkText, { color: palette.linkText }]}
          >
            {THEMEPARKS_WIKI_CREDIT}
          </Text>
        </Pressable>
      )}

      {showDisney && (
        <View style={styles.disneyBlock}>
          <Text
            style={[styles.attributionText, { color: palette.attributionText }]}
            accessibilityLabel={disneySourceText}
          >
            {disneySourceText}
          </Text>
          <Text
            style={[styles.attributionText, { color: palette.attributionText }]}
            accessibilityLabel={DISNEY_NOT_COVERED_NOTE}
          >
            {DISNEY_NOT_COVERED_NOTE}
          </Text>
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    alignItems: 'flex-start',
    gap: 4,
  },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: t.radius.sm,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  disneyBlock: {
    gap: 2,
    marginTop: 2,
  },
  attributionText: {
    fontSize: 11,
    lineHeight: 15,
  },
  attributionLink: {
    marginTop: 2,
  },
  attributionLinkText: {
    fontSize: 11,
    lineHeight: 15,
    textDecorationLine: 'underline',
  },
}));
