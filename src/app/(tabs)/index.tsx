import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, SectionList, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AnimatedMoney } from '@/components/animated-money';
import { MonthBar } from '@/components/month-bar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Chip, IconWell, Label, ProgressBar } from '@/components/ui-kit';
import { CATEGORIES, CATEGORY_COLORS, type Category } from '@/lib/categories';
import { useBudgets, useMonthData } from '@/hooks/use-data';
import type { Expense } from '@/lib/db';
import { dayLabel, formatINR, monthStart } from '@/lib/money';
import { onCaptured } from '@/lib/sms';
import { useTheme } from '@/hooks/use-theme';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';

type Row = { title: string; total: number; data: Expense[]; kind: 'day' };

export default function TimelineScreen() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const { filter: filterParam, monthMs: monthMsParam } = useLocalSearchParams<{ filter?: string; monthMs?: string }>();
  const filter = CATEGORIES.includes(filterParam as Category) ? (filterParam as Category) : null;
  const setFilter = (next: Category | null) => {
    router.setParams({ filter: next ?? undefined });
  };
  // Per mount, not once per JS process: an app left open across a month boundary must still
  // land on the new month when this screen comes back. The lazy initializer is also what
  // keeps Date.now() out of the render body, which the compiler lint rejects.
  const [fallbackMonthMs] = useState(() => monthStart(Date.now()));
  const monthMs = useMemo(() => {
    if (monthMsParam) {
      const parsed = Number(monthMsParam);
      if (!isNaN(parsed)) return parsed;
    }
    return fallbackMonthMs;
  }, [monthMsParam, fallbackMonthMs]);
  const setMonthMs = (next: number) => {
    router.setParams({ monthMs: String(next) });
  };
  const { expenses, total, reload } = useMonthData(monthMs);
  const { budgets } = useBudgets();

  // Live capture: a bank SMS arriving while this screen is open shows up without a refresh.
  // Nothing to kick off here either: the launch auto-scan is the only trigger, so a scan
  // can be running with nobody having pressed anything.
  useEffect(() => onCaptured(() => void reload()), [reload]);

  // Ids as of the last committed render, tagged with the month they belong to. The list
  // virtualises, so cells unmount and remount as they scroll past the window; an
  // unconditional `entering` would replay on every one of those and leave rows half-lit
  // mid-scroll. Null until the first paint, and stale for a different month, so both the
  // initial load and a month switch arrive at full opacity rather than fading a whole
  // month in.
  const seen = useRef<{ month: number; ids: Set<string> } | null>(null);
  useEffect(() => {
    seen.current = { month: monthMs, ids: new Set(expenses.map((e) => String(e.id))) };
  }, [expenses, monthMs]);

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
    // Every row lands in its day, whatever its kind. Dues, transfers and income stay
    // visible next to the spending, dimmed, so the month reads as a statement rather than
    // two lists; the day header counts only what is still an expense.
    const byDay = new Map<number, Expense[]>();
    for (const e of visible) {
      const day = new Date(e.txn_at).setHours(0, 0, 0, 0);
      const list = byDay.get(day);
      if (list) list.push(e);
      else byDay.set(day, [e]);
    }
    return [...byDay.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([day, data]) => ({
        title: dayLabel(day),
        total: data.reduce((sum, e) => sum + (e.is_expense === 1 ? e.amount_paise : 0), 0),
        data,
        kind: 'day' as const,
      }));
  }, [visible]);

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
            <ThemedText type="title">Timeline</ThemedText>

            <MonthBar monthMs={monthMs} onChange={setMonthMs} />

            <Animated.View
              key={monthMs}
              entering={reducedMotion ? undefined : FadeIn.duration(180)}
              style={styles.heroGroup}>
              <View style={[styles.hero, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <Label>{filter ? `${filter} only` : 'Spent this month'}</Label>
                <AnimatedMoney paise={visibleTotal} type="hero" />
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
            </Animated.View>
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Label>{section.title}</Label>
            {section.total > 0 && (
              <ThemedText type="smallBold" themeColor="textMuted">
                {formatINR(section.total)}
              </ThemedText>
            )}
          </View>
        )}
        renderItem={({ item, index, section }) => {
          const last = index === section.data.length - 1;
          const income = item.is_income === 1;
          const due = item.is_due === 1;
          const excluded = item.is_expense === 0;
          const tag = income ? 'Income' : due ? 'Due' : excluded ? 'Not an expense' : item.category;
          // Opacity only, no transform or measurement: anything else makes every recycled
          // cell re-lay-out mid-scroll, which is what actually costs frames here.
          const isNew = seen.current?.month === monthMs && !seen.current.ids.has(String(item.id));
          const row = (
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
              onPress={() => router.push(`/expense/${item.client_id}`)}>
              <IconWell category={item.category} size={38} />
              <View style={styles.rowText}>
                <ThemedText
                  type="merchant"
                  numberOfLines={1}
                  themeColor={excluded ? 'textMuted' : undefined}
                  style={excluded && !income && styles.struck}>
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
                  {income
                    ? `+${formatINR(item.amount_paise)}`
                    : excluded
                      ? formatINR(item.amount_paise)
                      : `−${formatINR(item.amount_paise)}`}
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
          // The fade lives on a wrapper, not the Pressable: FadeIn always targets opacity 1,
          // which would override rowExcluded's 0.6 on the "Not an expense" rows.
          return (
            <Animated.View entering={!reducedMotion && isNew ? FadeIn.duration(210) : undefined}>
              {row}
            </Animated.View>
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
  // The header's own gap only applies between top-level children, so the hero/chips spacing
  // has to be restated now that the cross-fade wraps both of them.
  heroGroup: { gap: Spacing.three },
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