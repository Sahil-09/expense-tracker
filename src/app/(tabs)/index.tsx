import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, SectionList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MonthBar } from '@/components/month-bar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Chip, IconWell, Label, LineIcon, ProgressBar } from '@/components/ui-kit';
import { CATEGORIES, CATEGORY_COLORS, type Category } from '@/lib/categories';
import { useBudgets, useMonthData } from '@/hooks/use-data';
import type { Expense } from '@/lib/db';
import { dayLabel, formatINR, monthStart } from '@/lib/money';
import { onCaptured, onScanState, runScan, type ScanState } from '@/lib/sms';
import { useTheme } from '@/hooks/use-theme';
import { BottomTabInset, MaxContentWidth, Radii, Spacing } from '@/constants/theme';

type Row = { title: string; total: number; data: Expense[]; kind: 'day' | 'due' | 'excluded' };

export default function TimelineScreen() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [monthMs, setMonthMs] = useState(() => monthStart(Date.now()));
  // Derived from the route rather than local state, so Insights can drill in with a
  // param, chips still toggle, and tapping the same category twice behaves.
  const { filter: filterParam } = useLocalSearchParams<{ filter?: string }>();
  const filter = CATEGORIES.includes(filterParam as Category) ? (filterParam as Category) : null;
  const setFilter = (next: Category | null) => {
    setScanNote(null);
    router.setParams({ filter: next ?? undefined });
  };
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanState>({ running: false, done: 0, total: 0, added: 0 });
  const { expenses, total, reload } = useMonthData(monthMs);
  const { budgets } = useBudgets();

  // Live capture: a bank SMS arriving while this screen is open shows up without a refresh.
  useEffect(() => onCaptured(() => void reload()), [reload]);

  // A scan started anywhere (launch auto-scan, the gate, Settings) shows its bar here.
  useEffect(() => onScanState(setScan), []);

  const runManualScan = async () => {
    const result = await runScan().catch((e) => ({
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
    }));
    await reload();
    setScanNote(
      !result.ok
        ? result.error
        : result.added > 0
          ? `Added ${result.added} from ${result.scanned} message${result.scanned === 1 ? '' : 's'}.`
          : `No new expenses in the last ${result.scanned} message${result.scanned === 1 ? '' : 's'}.`
    );
  };

  const usedCategories = useMemo(
    () => CATEGORIES.filter((c) => expenses.some((e) => e.category === c && e.is_expense === 1)),
    [expenses]
  );

  const visible = useMemo(
    () => (filter ? expenses.filter((e) => e.category === filter) : expenses),
    [expenses, filter]
  );

  // Totals count only what is still marked as an expense. The rows themselves stay in
  // the list, dimmed, so a mistaken toggle can be flipped back.
  const visibleTotal = useMemo(
    () => visible.reduce((sum, e) => sum + (e.is_expense === 1 ? e.amount_paise : 0), 0),
    [visible]
  );

  const sections = useMemo<Row[]>(() => {
    // Counted rows own the day sections; everything excluded belongs to a tail section
    // below, so a row appears exactly once.
    const byDay = new Map<number, Expense[]>();
    for (const e of visible) {
      if (e.is_expense !== 1) continue;
      const day = new Date(e.txn_at).setHours(0, 0, 0, 0);
      const list = byDay.get(day);
      if (list) list.push(e);
      else byDay.set(day, [e]);
    }
    const days: Row[] = [...byDay.entries()].map(([day, data]) => ({
      title: dayLabel(day),
      total: data.reduce((sum, e) => sum + e.amount_paise, 0),
      data,
      kind: 'day',
    }));

    if (filter !== null) return days;

    // Obligations and hand-excluded rows trail the real spending, one flat list each.
    // Their headers show what they add up to, which the counted total above reports as
    // nothing because none of it is counted.
    const byNewest = (a: Expense, b: Expense) => b.txn_at - a.txn_at;
    const tail = (title: string, kind: Row['kind'], rows: Expense[]): Row | null =>
      rows.length === 0
        ? null
        : { title, total: rows.reduce((sum, e) => sum + e.amount_paise, 0), data: rows, kind };

    const dues = tail(
      'Dues & bills',
      'due',
      visible.filter((e) => e.is_due === 1).sort(byNewest)
    );
    const rest = tail(
      'Not an expense',
      'excluded',
      visible.filter((e) => e.is_expense === 0 && e.is_due !== 1).sort(byNewest)
    );
    return [...days, dues, rest].filter((s): s is Row => s !== null);
  }, [visible, filter]);

  const dayCount = sections.filter((s) => s.kind === 'day' && s.total > 0).length;
  // The per-category monthly limits add up to one monthly target, as the design shows.
  const target = budgets.reduce((sum, b) => sum + b.monthly_paise, 0);

  return (
    <ThemedView style={styles.container}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + Spacing.two }]}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <ThemedText type="title">Timeline</ThemedText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Scan the last 90 days of messages for expenses"
                disabled={scan.running}
                style={({ pressed }) => [
                  styles.scanBtn,
                  { backgroundColor: theme.surfaceHigh },
                  pressed && styles.scanBtnPressed,
                ]}
                onPress={() => void runManualScan()}>
                <LineIcon name="refresh" size={15} color={theme.accent} />
                <ThemedText type="smallBold" themeColor="textMuted">
                  {scan.running ? 'Scanning' : 'Scan'}
                </ThemedText>
              </Pressable>
            </View>
            {scan.running && (
              <View style={styles.progress}>
                <ProgressBar
                  pct={scan.total === 0 ? 4 : (scan.done / scan.total) * 100}
                  color={theme.accent}
                />
                <ThemedText type="small" themeColor="textMuted" style={styles.progressText}>
                  Reading messages {scan.done} of {scan.total} · {scan.added} added
                </ThemedText>
              </View>
            )}
            {scanNote !== null && (
              <ThemedText type="small" themeColor="textSecondary">
                {scanNote}
              </ThemedText>
            )}

            <MonthBar monthMs={monthMs} onChange={setMonthMs} />

            <View style={[styles.hero, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Label>{filter ? `${filter} only` : 'Spent this month'}</Label>
              <ThemedText type="hero">{formatINR(visibleTotal)}</ThemedText>
              {filter === null && (
                <View style={styles.heroMeta}>
                  <ThemedText type="small" themeColor="textMuted">
                    {dayCount === 0
                      ? 'No days logged yet'
                      : `${dayCount} day${dayCount === 1 ? '' : 's'} · ₹${Math.round(visibleTotal / dayCount / 100)} avg`}
                  </ThemedText>
                  {target > 0 && (
                    <ThemedText type="small" themeColor="textMuted">
                      {Math.round((visibleTotal / target) * 100)}% of ₹{Math.round(target / 100)}
                    </ThemedText>
                  )}
                </View>
              )}
              {target > 0 && filter === null && (
                <ProgressBar pct={(visibleTotal / target) * 100} color={theme.accent} />
              )}
              {filter !== null && (
                <ThemedText type="small" themeColor="textMuted">
                  {formatINR(total)} across all categories
                </ThemedText>
              )}
            </View>

            {usedCategories.length > 1 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filters}>
                <Chip label="All" selected={filter === null} onPress={() => setFilter(null)} />
                {usedCategories.map((c) => (
                  <Chip
                    key={c}
                    label={c}
                    color={CATEGORY_COLORS[c]}
                    selected={filter === c}
                    onPress={() => setFilter(filter === c ? null : c)}
                  />
                ))}
              </ScrollView>
            )}
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Label>{section.title}</Label>
            <ThemedText type="smallBold" themeColor="textMuted">
              {formatINR(section.total)}
            </ThemedText>
          </View>
        )}
        renderItem={({ item, index, section }) => {
          const last = index === section.data.length - 1;
          const due = item.is_due === 1;
          const excluded = item.is_expense === 0;
          const tag = due ? 'Due' : excluded ? 'Not an expense' : item.category;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: excluded }}
              accessibilityLabel={`${item.merchant ?? 'Unknown merchant'}, ${formatINR(item.amount_paise)}, ${tag}${item.note ? `, note: ${item.note}` : ''}${excluded ? ', not counted as an expense' : ''}`}
              style={[
                styles.row,
                excluded && styles.rowExcluded,
                {
                  backgroundColor: theme.surface,
                  borderColor: theme.border,
                  borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                  borderTopLeftRadius: index === 0 ? 20 : 0,
                  borderTopRightRadius: index === 0 ? 20 : 0,
                  borderBottomLeftRadius: last ? 20 : 0,
                  borderBottomRightRadius: last ? 20 : 0,
                },
              ]}
              onPress={() => router.push(`/expense/${item.id}`)}>
              <IconWell category={item.category} size={38} />
              <View style={styles.rowText}>
                <ThemedText
                  type="merchant"
                  numberOfLines={1}
                  themeColor={excluded ? 'textMuted' : undefined}
                  style={excluded && styles.struck}>
                  {item.merchant ?? 'Unknown merchant'}
                </ThemedText>
                <ThemedText type="small" themeColor="textMuted" numberOfLines={1}>
                  {tag}
                </ThemedText>
                {item.note !== null && item.note !== '' && (
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {item.note}
                  </ThemedText>
                )}
              </View>
              <View style={styles.rowAmount}>
                <ThemedText type="amount" themeColor={excluded ? 'textMuted' : undefined}>
                  {excluded ? formatINR(item.amount_paise) : `−${formatINR(item.amount_paise)}`}
                </ThemedText>
                <ThemedText type="small" themeColor="textMuted">
                  {new Date(item.txn_at).toLocaleTimeString(undefined, {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </ThemedText>
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <ThemedText type="subtitle">
              {filter ? `No ${filter} expenses` : 'Nothing logged this month'}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.emptyBody}>
              {filter
                ? 'Tap the filter again to see everything.'
                : 'Scan your inbox from Settings, or tap Add to paste one by hand.'}
            </ThemedText>
          </View>
        }
      />

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
  },
  header: { gap: Spacing.three, paddingBottom: Spacing.three },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  scanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: Spacing.two + 2,
    borderRadius: Radii.md,
  },
  scanBtnPressed: { opacity: 0.6 },
  progress: { gap: Spacing.two - 4 },
  progressText: { marginTop: -2 },
  hero: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three + 2,
    gap: Spacing.two,
  },
  heroMeta: { flexDirection: 'row', justifyContent: 'space-between' },
  filters: { gap: Spacing.two, paddingRight: Spacing.three },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Spacing.four,
    paddingBottom: Spacing.two + 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three - 4,
    paddingVertical: Spacing.three - 4,
    paddingHorizontal: Spacing.three - 2,
  },
  rowText: { flex: 1, gap: 2 },
  rowExcluded: { opacity: 0.6 },
  struck: { textDecorationLine: 'line-through' },
  rowAmount: { alignItems: 'flex-end' },
  empty: { paddingVertical: Spacing.five, gap: Spacing.two },
  emptyBody: { lineHeight: 20 },
});