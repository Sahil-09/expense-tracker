import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button, Card, Chip, IconWell, Label, LineIcon, tint } from '@/components/ui-kit';
import { CATEGORIES, CATEGORY_COLORS, type Category } from '@/lib/categories';
import {
  deleteExpense,
  getExpenseByClientId,
  listSimilarExpenses,
  markNotExpenses,
  setCategory,
  setExpense,
  setNote,
  type Expense,
  type SimilarExpense,
} from '@/lib/db';
import { dayLabel, formatINR, timeLabel } from '@/lib/money';
import { confirmAlert } from '@/lib/confirm';
import { useTheme } from '@/hooks/use-theme';
import { MaxContentWidth, Radii, Spacing } from '@/constants/theme';

export default function ExpenseScreen() {
  // The route param is a clientId UUID, not the local autoincrement id: two devices
  // each mint id 5 for different expenses once sync is on.
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [expense, setExpenseState] = useState<Expense | null>(null);
  /** Non-null while the "mark the rest too" sheet is open. */
  const [similar, setSimilar] = useState<SimilarExpense[] | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const theme = useTheme();

  const reload = useCallback(async () => {
    setExpenseState(await getExpenseByClientId(id));
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
  //
  // That memory only looks forward, so without this the app would stop logging Swiggy
  // forever while three older Swiggys stayed in the totals. Asking here is where the
  // user is already declaring the merchant off-limits, and it is the last chance to fix
  // the history rather than just the future.
  const toggleExpense = async (next: boolean) => {
    await setExpense(expense.id, next, expense.merchant, expense.is_due === 1);

    if (!next && expense.merchant !== null) {
      // The row just flipped is already out of `is_expense = 1`, so it is not in here.
      const others = await listSimilarExpenses(expense.merchant);
      if (others.length > 0) {
        // Everything pre-ticked: taking the whole set is the usual case, and unticking
        // the odd one is far less work than ticking them all.
        setPicked(others.map((r) => r.id));
        setSimilar(others);
      }
    }

    await reload();
  };

  const applyPicked = async () => {
    if (similar !== null && picked.length > 0) await markNotExpenses(picked);
    setSimilar(null);
    setPicked([]);
    await reload();
  };

  const cancelPicked = () => {
    setSimilar(null);
    setPicked([]);
  };

  const confirmDelete = async () => {
    if (!(await confirmAlert('Delete expense?', 'This cannot be undone.', 'Delete'))) return;
    await deleteExpense(expense.id);
    router.back();
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <IconWell category={expense.category} size={64} />
          <ThemedText type="hero" style={styles.amount}>
            {expense.is_income === 1 ? '+' : isExpense ? '−' : ''}
            {formatINR(expense.amount_paise)}
          </ThemedText>
          <ThemedText type="subtitle">{expense.merchant ?? 'Unknown merchant'}</ThemedText>
          <ThemedText type="small" themeColor="textMuted">
            {new Date(expense.txn_at).toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
            , {timeLabel(expense.txn_at)} · via {expense.source}
          </ThemedText>
        </View>

        {expense.is_income === 1 ? (
          <Card>
            <View style={styles.toggleRow}>
              <View style={styles.toggleText}>
                <ThemedText type="subtitle">Income</ThemedText>
                <ThemedText type="small" themeColor="textMuted">
                  Money in. Never counted in your totals.
                </ThemedText>
              </View>
            </View>
          </Card>
        ) : (
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
        )}

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

      {similar !== null && (
        <SimilarPicker
          rows={similar}
          picked={picked}
          onToggle={(id) =>
            setPicked((prev) =>
              prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
            )
          }
          onCancel={cancelPicked}
          onConfirm={() => void applyPicked()}
        />
      )}
    </ThemedView>
  );
}

/**
 * Picks which of the other rows for this merchant also leave the totals.
 *
 * A sheet rather than an <Alert> because the useful answer is usually "all but that
 * one", and a dialog can only offer all or nothing. onRequestClose is the hardware back
 * gesture, which has to mean cancel or the sheet cannot be dismissed at all.
 */
function SimilarPicker({
  rows,
  picked,
  onToggle,
  onCancel,
  onConfirm,
}: {
  rows: SimilarExpense[];
  picked: number[];
  onToggle: (id: number) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const theme = useTheme();
  return (
    <Modal transparent animationType="slide" onRequestClose={onCancel}>
      <View style={[styles.backdrop, { backgroundColor: tint(theme.text, 0.5) }]}>
        <View style={[styles.sheet, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Label>Similar transactions</Label>
          <ThemedText type="title">
            {rows.length} other {rows[0]?.merchant}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Tick the ones that were not a real expense.
          </ThemedText>

          <ScrollView style={styles.pickList} nestedScrollEnabled>
            {rows.map((r) => {
              const on = picked.includes(r.id);
              return (
                <Pressable
                  key={r.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`${formatINR(r.amount_paise)}, ${r.category}, ${dayLabel(r.txn_at)}`}
                  onPress={() => onToggle(r.id)}
                  style={({ pressed }) => [
                    styles.pickRow,
                    { borderColor: theme.border, backgroundColor: theme.surfaceAlt },
                    pressed && styles.pickRowPressed,
                  ]}>
                  <View
                    style={[
                      styles.box,
                      {
                        borderColor: on ? theme.accent : theme.borderStrong,
                        backgroundColor: on ? theme.accent : 'transparent',
                      },
                    ]}>
                    {on && <LineIcon name="check" size={14} color={theme.onAccent} />}
                  </View>
                  <View style={styles.pickText}>
                    <ThemedText type="smallBold">{formatINR(r.amount_paise)}</ThemedText>
                    <ThemedText type="small" themeColor="textMuted">
                      {r.category} · {dayLabel(r.txn_at)}
                    </ThemedText>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.pickActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Leave these counted"
              onPress={onCancel}
              style={({ pressed }) => [styles.pickCancel, pressed && styles.pickRowPressed]}>
              <ThemedText type="subtitle" themeColor="textSecondary">
                Cancel
              </ThemedText>
            </Pressable>
            <Button
              label={picked.length > 0 ? `Mark ${picked.length}` : 'Mark none'}
              disabled={picked.length === 0}
              onPress={onConfirm}
            />
          </View>
        </View>
      </View>
    </Modal>
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
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: Radii.xl,
    borderTopRightRadius: Radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three + 2,
    gap: Spacing.two,
    maxHeight: '80%',
  },
  pickList: { gap: Spacing.two },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.two + 2,
  },
  pickRowPressed: { opacity: 0.6 },
  pickText: { flex: 1 },
  box: {
    width: 22,
    height: 22,
    borderRadius: Radii.sm,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.two },
  pickCancel: { flex: 1, alignItems: 'center', paddingVertical: Spacing.three - 2 },
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