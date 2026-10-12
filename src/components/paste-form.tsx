import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button, Card, IconWell, Label, tint } from '@/components/ui-kit';
import { categorize } from '@/lib/categories';
import { ingestSms } from '@/lib/db';
import { formatINR } from '@/lib/money';
import { parseSms } from '@/lib/parse';
import { useTheme } from '@/hooks/use-theme';
import { BottomTabInset, MaxContentWidth, Radii, Spacing } from '@/constants/theme';

const REASON_LABEL: Record<string, string> = {
  otp: 'OTP',
  'balance-enquiry': 'Balance enquiry',
  'failed-transaction': 'Failed transaction',
  promotion: 'Promotion',
  income: 'Income',
  'no-direction': 'No direction',
  'no-amount': 'No amount',
  'no-date': 'No date',
  empty: 'Empty',
};

export function PasteForm() {
  const [text, setText] = useState('');
  const [result, setResult] = useState<{ text: string; ok: boolean } | null>(null);
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  // Parsed on every keystroke so the sheet can show what it read, as the design does.
  const preview = useMemo(() => (text.trim() ? parseSms(text, null) : null), [text]);

  const submit = async () => {
    // Pasted text carries no reliable timestamp, so the parser falls back to any date
    // written in the message itself.
    const outcome = await ingestSms(text, null, 'pasted');
    setResult({
      text:
        outcome.status === 'added'
          ? 'Logged.'
          : outcome.status === 'duplicate'
            ? 'Already logged this one.'
            : `Not a spend (${outcome.reason}).`,
      ok: outcome.status === 'added',
    });
    if (outcome.status === 'added') setText('');
  };

  const verdict =
    preview === null
      ? null
      : preview.ok
        ? { tone: 'good', label: 'Spend', detail: categorize(preview.parsed.merchant ?? '') }
        : { tone: 'bad', label: REASON_LABEL[preview.reason] ?? preview.reason, detail: null };

  return (
    <ThemedView style={styles.container}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingTop: insets.top + Spacing.three }]}
          keyboardShouldPersistTaps="handled">
          <ThemedText type="title">Paste an SMS</ThemedText>
          <ThemedText type="small" themeColor="textMuted">
            Copy the text of a bank or payment SMS and paste it below. Amount, date and merchant
            are read from the message; anything that is not a spend is rejected.
          </ThemedText>

          <TextInput
            accessibilityLabel="Bank SMS text"
            style={[
              styles.input,
              { color: theme.text, backgroundColor: theme.surfaceAlt, borderColor: theme.border },
            ]}
            multiline
            numberOfLines={6}
            value={text}
            onChangeText={setText}
            placeholder="Rs.500 debited at SWIGGY on 05/03/2026"
            placeholderTextColor={theme.textMuted}
          />

          {verdict !== null && preview !== null && (
            <>
              <View
                style={[
                  styles.detected,
                  {
                    backgroundColor: tint(verdict.tone === 'good' ? theme.positive : theme.danger, 0.12),
                  },
                ]}>
                <Label style={{ color: verdict.tone === 'good' ? theme.positive : theme.danger }}>
                  SMS detected: {verdict.label}
                </Label>
                <Label>{text.length} chars</Label>
              </View>

              {preview.ok && (
                <Card style={styles.parsed}>
                  <View style={styles.parsedRow}>
                    <IconWell category={verdict!.detail as never} size={34} />
                    <View style={styles.flex}>
                      <ThemedText type="merchant">
                        {preview.parsed.merchant ?? 'Unknown merchant'}
                      </ThemedText>
                      <ThemedText type="small" themeColor="textMuted">
                        {new Date(preview.parsed.txnAt).toLocaleDateString(undefined, {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}{' '}
                        · {verdict!.detail}
                      </ThemedText>
                    </View>
                    <ThemedText type="amount">{formatINR(preview.parsed.amountPaise)}</ThemedText>
                  </View>
                  <ThemedText type="small" themeColor="textMuted">
                    Valid debit
                  </ThemedText>
                </Card>
              )}
            </>
          )}

          <Button label="Log it" disabled={!text.trim()} onPress={() => void submit()} />

          {result !== null && (
            <View style={styles.result}>
              <Label style={{ color: result.ok ? theme.positive : theme.textMuted }}>{result.text}</Label>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.four,
    maxWidth: MaxContentWidth,
    alignSelf: 'stretch',
    gap: Spacing.three,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.md,
    padding: Spacing.three,
    minHeight: 120,
    textAlignVertical: 'top',
    fontSize: 15,
    lineHeight: 22,
  },
  detected: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderRadius: Radii.pill,
    paddingHorizontal: Spacing.three - 2,
    paddingVertical: Spacing.two,
  },
  parsed: { gap: Spacing.two },
  parsedRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4 },
  result: { alignItems: 'center', paddingTop: Spacing.two },
});