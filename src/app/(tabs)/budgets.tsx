import { useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MonthBar } from '@/components/month-bar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Card, Label, ProgressBar } from '@/components/ui-kit';
import { CATEGORIES, CATEGORY_COLORS, type Category } from '@/lib/categories';
import { useBudgets, useMonthData } from '@/hooks/use-data';
import { setBudget } from '@/lib/db';
import { budgetFieldText } from '@/lib/budget';
import { formatINR, monthStart } from '@/lib/money';
import { useTheme } from '@/hooks/use-theme';
import { BottomTabInset, MaxContentWidth, Radii, Spacing } from '@/constants/theme';

export default function BudgetsScreen() {
  const [monthMs, setMonthMs] = useState(() => monthStart(Date.now()));
  const { budgets, reload } = useBudgets();
  const { byCategory, total, reload: reloadMonth } = useMonthData(monthMs);
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  /**
   * What each field shows, keyed by category.
   *
   * The field is controlled rather than using `defaultValue`, because Fabric pushes the
   * `text` prop into the native input on every render: an uncontrolled field whose
   * `defaultValue` is empty gets its text wiped to '' by a re-render, and the wipe is then
   * saved as a zero budget - so a category that already had a limit starts reading
   * "not set". Keeping the text in state means a re-render cannot touch it.
   */
  const [drafts, setDrafts] = useState<Partial<Record<Category, string>>>({});

  const budgetFor = (c: Category) => budgets.find((b) => b.category === c)?.monthly_paise ?? 0;
  const spentFor = (c: Category) => byCategory.find((b) => b.category === c)?.total ?? 0;
  const budgetTotal = budgets.reduce((sum, b) => sum + b.monthly_paise, 0);
  const over = budgetTotal > 0 && total > budgetTotal;

  const save = async (category: Category, text: string) => {
    // Strip anything that is not a digit so a stray character cannot store NaN.
    const rupees = Number(text.replace(/[^0-9]/g, '')) || 0;
    await setBudget(category, rupees * 100);
    await Promise.all([reload(), reloadMonth()]);
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + Spacing.two }]}
        keyboardShouldPersistTaps="handled">
        <ThemedText type="title">Budgets</ThemedText>

        <MonthBar monthMs={monthMs} onChange={setMonthMs} />

        <Card style={styles.summary}>
          <Label>Spent this month</Label>
          <ThemedText type="hero" style={over && { color: theme.danger }}>
            {formatINR(total)}
          </ThemedText>
          {budgetTotal > 0 && (
            <ProgressBar
              pct={(total / budgetTotal) * 100}
              color={over ? theme.danger : theme.accent}
            />
          )}
          <ThemedText type="small" themeColor={over ? 'danger' : 'textMuted'}>
            {budgetTotal > 0
              ? `${formatINR(Math.abs(total - budgetTotal))} ${over ? 'over' : 'left of'} a ${formatINR(budgetTotal)} budget`
              : 'No budgets set yet — add a limit below.'}
          </ThemedText>
        </Card>

        {CATEGORIES.map((c) => {
          const budget = budgetFor(c);
          const spent = spentFor(c);
          const isOver = budget > 0 && spent > budget;
          const color = isOver ? theme.danger : CATEGORY_COLORS[c];
          const shown = budgetFieldText(drafts[c], budget);

          return (
            <Card key={c}>
              <View style={styles.cardHeader}>
                <View style={[styles.swatch, { backgroundColor: CATEGORY_COLORS[c] }]} />
                <ThemedText type="subtitle" style={styles.cardLabel}>
                  {c}
                </ThemedText>
                <View style={styles.cardAmounts}>
                  <ThemedText type="smallBold" style={isOver && { color: theme.danger }}>
                    {formatINR(spent)}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textMuted">
                    {budget > 0 ? ` of ${formatINR(budget)}` : ''}
                  </ThemedText>
                </View>
              </View>

              <ProgressBar pct={budget > 0 ? (spent / budget) * 100 : 0} color={color} />

              <View style={styles.inputRow}>
                <Label>Monthly limit ₹</Label>
                <TextInput
                  accessibilityLabel={`Monthly limit for ${c} in rupees`}
                  style={[
                    styles.input,
                    {
                      color: theme.text,
                      backgroundColor: theme.surfaceAlt,
                      borderColor: theme.border,
                    },
                  ]}
                  keyboardType="number-pad"
                  value={shown}
                  placeholder="not set"
                  placeholderTextColor={theme.textMuted}
                  onChangeText={(text) => setDrafts((d) => ({ ...d, [c]: text }))}
                  onEndEditing={() => {
                    // Save the value the field actually shows (React state), not the native
                    // text, so a mid-edit re-render cannot persist a stale value.
                    void save(c, shown).then(() => {
                      setDrafts((d) => {
                        const next = { ...d };
                        delete next[c];
                        return next;
                      });
                    });
                  }}
                />
              </View>
            </Card>
          );
        })}

        <ThemedText type="small" themeColor="textMuted" style={styles.footnote}>
          Leave a limit as “not set” to skip that category. Values save when you tap away.
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.four,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    gap: Spacing.three,
  },
  summary: { gap: Spacing.two },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2 },
  swatch: { width: 10, height: 10, borderRadius: 5 },
  cardLabel: { flex: 1 },
  cardAmounts: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.one },
  inputRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  input: {
    minWidth: 110,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.sm,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.two,
    textAlign: 'right',
  },
  footnote: { lineHeight: 20 },
});