import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AnimatedMoney } from '@/components/animated-money';
import { ColumnBars, Donut, Legend } from '@/components/charts';
import { MonthBar } from '@/components/month-bar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Card, Label, LineIcon, tint } from '@/components/ui-kit';
import type { Category } from '@/lib/categories';
import { useMonthData, useMonthlyTotals } from '@/hooks/use-data';
import { useTheme } from '@/hooks/use-theme';
import { formatINR, monthKey, monthStart } from '@/lib/money';
import { BottomTabInset, MaxContentWidth, Radii, Spacing } from '@/constants/theme';

export default function InsightsScreen() {
  const router = useRouter();
  const [monthMs, setMonthMs] = useState(() => monthStart(Date.now()));
  const { byCategory, total, income } = useMonthData(monthMs);
  const monthlyTotals = useMonthlyTotals(6);
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const trend = monthlyTotals.map((m) => ({
    label: new Date(`${m.month}-02T12:00:00`).toLocaleDateString(undefined, { month: 'short' }),
    value: m.total,
  }));

  const latest = monthlyTotals[monthlyTotals.length - 1];
  const previous = monthlyTotals[monthlyTotals.length - 2];
  const isLatest = latest?.month === monthKey(monthMs);
  const delta =
    isLatest && previous && previous.total > 0
      ? Math.round(((total - previous.total) / previous.total) * 100)
      : null;

  // Projected month-end run rate, the third figure the design puts under the donut.
  const daysInMonth = new Date(new Date(monthMs).getFullYear(), new Date(monthMs).getMonth() + 1, 0).getDate();
  const daysSoFar = isLatest ? new Date().getDate() : daysInMonth;
  // An estimate has no business carrying paise, so the run rate rounds to whole rupees.
  const projected =
    isLatest && daysSoFar > 0
      ? Math.round((total / daysSoFar) * daysInMonth / 100) * 100
      : total;
  const trendTotal = trend.reduce((s, d) => s + d.value, 0);
  const txns = byCategory.reduce((s, c) => s + (c.n ?? 0), 0);

  // Donut centre already prints Spent, so the row leads with the run rate. A past month
  // has no run rate left to project, so it drops out there.
  const stats = [
    ...(isLatest
      ? [{ label: 'Projected', value: <AnimatedMoney paise={projected} type="small" /> }]
      : []),
    { label: 'Txns', value: String(txns) },
    ...(income > 0
      ? [
          { label: 'Income', value: <AnimatedMoney paise={income} type="small" /> },
          { label: 'Net', value: <AnimatedMoney paise={total - income} type="small" /> },
        ]
      : []),
  ] satisfies { label: string; value: ReactNode }[];

  // Green when the month is down, red when it is up; the badge and the callout share it.
  const trendTone = delta !== null && delta > 0 ? theme.danger : theme.positive;

  // The Timeline already renders a category filtered, so drilling down is a navigation
  // with a param rather than a second list screen to keep in sync.
  const openCategory = (category: Category) => {
    router.push({ pathname: '/', params: { filter: category, monthMs: String(monthMs) } });
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + Spacing.two }]}>
        <ThemedText type="title">Insights</ThemedText>

        <MonthBar monthMs={monthMs} onChange={setMonthMs} />

        <Card style={styles.spendCard}>
          <View style={styles.spendHead}>
            <Label>Spend breakdown</Label>
            {delta !== null && (
              <View
                style={[
                  styles.delta,
                  {
                    backgroundColor: tint(delta <= 0 ? theme.positive : theme.danger, 0.16),
                  },
                ]}>
                <ThemedText
                  type="smallBold"
                  style={{ color: delta <= 0 ? theme.positive : theme.danger }}>
                  {delta <= 0 ? '↓' : '↑'} {Math.abs(delta)}% vs prev
                </ThemedText>
              </View>
            )}
          </View>

          <Donut slices={byCategory} subtitle={`${txns} transaction${txns === 1 ? '' : 's'}`} />

          <View style={[styles.stats, { borderColor: theme.border }]}>
            {stats.map((s, i) => (
              <Stat
                key={s.label}
                label={s.label}
                value={s.value}
                divider={i > 0}
                borderColor={theme.border}
              />
            ))}
          </View>
        </Card>

        {delta !== null && (
          <View
            style={[
              styles.callout,
              {
                backgroundColor: tint(trendTone, 0.08),
                borderColor: tint(trendTone, 0.24),
              },
            ]}>
            <View
              style={[
                styles.calloutIcon,
                {
                  backgroundColor: tint(trendTone, 0.16),
                  borderColor: tint(trendTone, 0.3),
                },
              ]}>
              <LineIcon name="chart" size={18} color={trendTone} />
            </View>
            <View style={styles.calloutBody}>
              <Label style={{ color: trendTone }}>Efficiency trend</Label>
              <ThemedText type="small" themeColor="textSecondary" style={styles.calloutText}>
                You spent {Math.abs(delta)}% {delta <= 0 ? 'less' : 'more'} than last month.
              </ThemedText>
            </View>
          </View>
        )}

        <Label>Top categories</Label>
        <Card>
          {byCategory.length === 0 ? (
            <ThemedText type="small" themeColor="textMuted">
              Nothing logged this month.
            </ThemedText>
          ) : (
            <Legend slices={byCategory} max={6} onPressCategory={openCategory} />
          )}
        </Card>

        <Label>Last 6 months</Label>
        <Card>
          {trend.length === 0 ? (
            <ThemedText type="small" themeColor="textMuted">
              No history yet.
            </ThemedText>
          ) : (
            <>
              <ThemedText type="subtitle">{formatINR(trendTotal)}</ThemedText>
              <ColumnBars data={trend} />
            </>
          )}
        </Card>
      </ScrollView>
    </ThemedView>
  );
}

function Stat({
  label,
  value,
  divider = false,
  borderColor,
}: {
  label: string;
  value: ReactNode;
  divider?: boolean;
  borderColor: string;
}) {
  return (
    <View
      style={[
        styles.stat,
        divider && { borderLeftWidth: StyleSheet.hairlineWidth, borderColor },
      ]}>
      <Label>{label}</Label>
      {typeof value === 'string' ? (
        <ThemedText type="smallBold">{value}</ThemedText>
      ) : (
        value
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.four,
    maxWidth: MaxContentWidth,
    alignSelf: 'stretch',
    gap: Spacing.three,
  },
  spendCard: { gap: Spacing.three },
  spendHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  delta: { borderRadius: Radii.pill, paddingHorizontal: Spacing.two + 2, paddingVertical: 4 },
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.three,
    marginTop: Spacing.two,
  },
  stat: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 78,
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: Spacing.one,
  },
  callout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
  },
  calloutIcon: {
    width: 40,
    height: 40,
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calloutBody: { flex: 1, gap: 2 },
  calloutText: { lineHeight: 20 },
});