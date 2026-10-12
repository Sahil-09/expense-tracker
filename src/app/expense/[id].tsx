import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button, Card, Chip, IconWell, Label, tint } from '@/components/ui-kit';
import { CATEGORIES, CATEGORY_COLORS, type Category } from '@/lib/categories';
import {
  deleteExpense,
  getExpense,
  setCategory,
  setExpense,
  setNote,
  type Expense,
} from '@/lib/db';
import { formatINR } from '@/lib/money';
import { useTheme } from '@/hooks/use-theme';
import { MaxContentWidth, Radii, Spacing } from '@/constants/theme';

export default function ExpenseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [expense, setExpenseState] = useState<Expense | null>(null);
  const theme = useTheme();

  const reload = useCallback(async () => {
    setExpenseState(await getExpense(Number(id)));
  }, [id]);

  useFocusEffect(useCallback(() => { void reload(); }, [reload]));

  if (!expense) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText>Not found</ThemedText>
      </ThemedView>
    );
  }

  const isExpense = expense.is_expense === 1;
  const pick = async (c: Category) => {
    await setCategory(expense.id, c);
    await reload();
  };

  // Turning this off also teaches the app to skip this merchant from now on. Dues are
  // exempt from that memory, so it passes the flag through.
  const toggleExpense = async (next: boolean) => {
    await setExpense(expense.id, next, expense.merchant, expense.is_due === 1);
    await reload();
  };

  const confirmDelete = () =>
    void Alert.alert('Delete expense?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteExpense(expense.id);
          router.back();
        },
      },
    ]);

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <IconWell category={expense.category} size={64} />
          <ThemedText type="hero" style={styles.amount}>
            {isExpense ? '−' : ''}
            {formatINR(expense.amount_paise)}
          </ThemedText>
          <ThemedText type="subtitle">{expense.merchant ?? 'Unknown merchant'}</ThemedText>
          <ThemedText type="small" themeColor="textMuted">
            {new Date(expense.txn_at).toLocaleString()} · via {expense.source}
          </ThemedText>
        </View>

        <Card style={isExpense ? undefined : { borderColor: tint(theme.danger, 0.35) }}>
          <View style={styles.toggleRow}>
            <View style={styles.toggleText}>
              <ThemedText type="subtitle">Expense</ThemedText>
              <ThemedText type="small" themeColor="textMuted">
                {expense.merchant
                  ? isExpense
                    ? 'Counted in your totals.'
                    : `Left out of totals. Future payments to ${expense.merchant} are skipped too.`
                  : 'Counted in your totals. No merchant, so nothing is remembered.'
              }</ThemedText>
            </View>
            <Switch
              accessibilityLabel="Mark as expense"
              value={isExpense}
              onValueChange={(next) => void toggleExpense(next)}
              trackColor={{ false: theme.border, true: tint(theme.accent, 0.5) }}
              thumbColor={isExpense ? theme.accent : theme.textMuted}
            />
          </View>
        </Card>

        <View style={styles.section}>
          <Label>Category</Label>
          <View style={styles.chipRow}>
            {CATEGORIES.map((c) => (
              <Chip
                key={c}
                label={c}
                color={CATEGORY_COLORS[c]}
                selected={c === expense.category}
                onPress={() => void pick(c)}
              />
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Label>Note</Label>
          <NoteField expense={expense} onSaved={reload} />
        </View>

        <Card>
          <View style={styles.cardHead}>
            <Label>Original message</Label>
            <View style={[styles.pill, { backgroundColor: tint(theme.positive, 0.16) }]}>
              <ThemedText type="smallBold" style={{ color: theme.positive }}>
                Parsed automatically
              </ThemedText>
            </View>
          </View>
          <ThemedText type="code" themeColor="textSecondary">
            {expense.raw_sms}
          </ThemedText>
        </Card>

        <Button label="Delete expense" tone="danger" onPress={confirmDelete} />
      </ScrollView>
    </ThemedView>
  );
}

/**
 * Saves on blur rather than on every keystroke, so a note costs one write instead of
 * one per character. Kept as its own component so the draft initialises from the loaded
 * row once, and a background reload cannot overwrite half-typed text.
 */
function NoteField({ expense, onSaved }: { expense: Expense; onSaved: () => Promise<void> }) {
  const theme = useTheme();
  const [text, setText] = useState(expense.note ?? '');

  return (
    <TextInput
      accessibilityLabel="Note"
      value={text}
      onChangeText={setText}
      onBlur={() => {
        if (text.trim() === (expense.note ?? '')) return;
        void setNote(expense.id, text).then(onSaved);
      }}
      placeholder="What was this for?"
      placeholderTextColor={theme.textMuted}
      multiline
      style={[
        styles.input,
        { color: theme.text, backgroundColor: theme.surfaceAlt, borderColor: theme.border },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.five,
    maxWidth: MaxContentWidth,
    alignSelf: 'stretch',
    gap: Spacing.four,
  },
  hero: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.three },
  amount: { fontSize: 40, lineHeight: 46 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  toggleText: { flex: 1, gap: 2 },
  section: { gap: Spacing.two },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pill: { borderRadius: Radii.pill, paddingHorizontal: Spacing.two, paddingVertical: 2 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.md,
    padding: Spacing.two + 2,
    minHeight: 64,
    fontSize: 15,
    lineHeight: 21,
    textAlignVertical: 'top',
  },
});