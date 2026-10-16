/**
 * AttributionScreen (R6.1) — the in-app "Art credits" surface.
 *
 * Lists every motif-library attribution the pin artwork owes, verbatim from `PIN_CREDITS` (which
 * `creditsGate.test.ts` keeps in lock-step with `motifs/CREDITS.md`). CC BY obliges naming the
 * author, so each line names the author, source, and licence. Reached from the Pin Board / Profile.
 */
import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { CollectionStackParamList } from '../../navigation/CollectionStack';
import { PIN_CREDITS } from '../../components/pins/pinCredits';
import { makeStyles } from '../../theme/makeStyles';
import { Card, GradientHeader, ScreenContainer, SectionLabel } from '../../theme/components';

type Props = NativeStackScreenProps<CollectionStackParamList, 'PinAttribution'>;

export default function AttributionScreen({ navigation }: Props): JSX.Element {
  const styles = useStyles();
  return (
    <ScreenContainer>
      <GradientHeader
        title="Art credits"
        subtitle="Motif attribution for the pin collection"
        icon="ribbon"
        compact
        onBack={() => navigation.goBack()}
      />
      <ScrollView contentContainerStyle={styles.content} testID="pin-attribution">
        <SectionLabel>Attribution</SectionLabel>
        <Text style={styles.intro}>
          Pin artwork draws on the open-source motif libraries below. Creative Commons attribution
          licences require naming the author, not just the library.
        </Text>
        {PIN_CREDITS.map((line, i) => (
          <Card key={i} style={styles.creditCard}>
            <Text style={styles.creditText} testID={`credit-line-${i}`}>
              {line}
            </Text>
          </Card>
        ))}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            CC BY 3.0 / 4.0 require attribution only — no share-alike. CC0 1.0 is public domain.
            Motifs marked Project Original are ours outright.
          </Text>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const useStyles = makeStyles((t) => ({
  content: { padding: t.spacing.lg },
  intro: {
    ...t.typography.body,
    color: t.color.textSecondary,
    marginBottom: t.spacing.lg,
  },
  creditCard: { marginBottom: t.spacing.md },
  creditText: { ...t.typography.body, color: t.color.textPrimary },
  footer: { marginTop: t.spacing.md },
  footerText: { ...t.typography.meta, color: t.color.textSecondary },
}));
