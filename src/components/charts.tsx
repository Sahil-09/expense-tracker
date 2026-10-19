import { useMemo } from 'react';
import { StyleSheet, Pressable, View } from 'react-native';
import Svg, { Circle, G, Rect } from 'react-native-svg';

import { CATEGORY_COLORS, type Category } from '@/lib/categories';
import { formatINR } from '@/lib/money';
import { ThemedText } from '@/components/themed-text';
import { Label, tint } from '@/components/ui-kit';
import { Radii, Spacing, Tabular } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Slice = { category: Category; total: number; n?: number };

export function Donut({
  slices,
  size = 208,
  subtitle,
}: {
  slices: Slice[];
  size?: number;
  /** Small line under the amount in the hole ("142 transactions"). */
  subtitle?: string;
}) {
  const theme = useTheme();
  const total = slices.reduce((sum, s) => sum + s.total, 0);
  // Stitch's ring is 16px on a 190px viewBox, i.e. ~8.5% of the ring's diameter.
  const stroke = size * 0.085;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;

  // Offsets are derived without mutating anything. At most 9 slices, so the
  // slice-and-sum is cheaper to read than an accumulator.
  const arcs = useMemo(
    () =>
      slices.map((s, i) => ({
        category: s.category,
        dash: (s.total / total) * circumference,
        offset: (slices.slice(0, i).reduce((sum, x) => sum + x.total, 0) / total) * circumference,
      })),
    [slices, total, circumference]
  );

  if (total === 0) {
    return (
      <View style={[styles.donut, { width: size, height: size, borderRadius: Radii.xl }]}>
        <ThemedText type="small" themeColor="textMuted">
          Nothing yet
        </ThemedText>
      </View>
    );
  }

  return (
    <View style={[styles.donut, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={theme.surfaceAlt}
            strokeWidth={stroke}
            fill="none"
          />
          {arcs.map((a) => (
            <Circle
              key={a.category}
              cx={size / 2}
              cy={size / 2}
              r={r}
              stroke={CATEGORY_COLORS[a.category]}
              strokeWidth={stroke}
              fill="none"
              strokeDasharray={`${a.dash} ${circumference - a.dash}`}
              strokeDashoffset={-a.offset}
            />
          ))}
        </G>
      </Svg>
      <View style={styles.donutCenter} pointerEvents="none">
        <Label>Spent</Label>
        <ThemedText type="hero" style={styles.donutAmount}>
          {formatINR(total)}
        </ThemedText>
        {subtitle !== undefined && (
          <ThemedText type="small" themeColor="textMuted" style={styles.donutSubtitle}>
            {subtitle}
          </ThemedText>
        )}
      </View>
    </View>
  );
}

export function Legend({
  slices,
  max,
  onPressCategory,
}: {
  slices: Slice[];
  max?: number;
  /** Omitted by callers that just want a static list; when given, rows become buttons. */
  onPressCategory?: (category: Slice['category']) => void;
}) {
  const theme = useTheme();
  const total = slices.reduce((sum, s) => sum + s.total, 0);
  if (total === 0) return null;
  const shown = max ? slices.slice(0, max) : slices;
  return (
    <View style={styles.legend}>
      {shown.map((s, i) => {
        const row = (
          <View
            style={[
              styles.legendRow,
              i < shown.length - 1 && {
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderColor: theme.border,
                paddingBottom: Spacing.three - 4,
              },
            ]}>
            <View
              style={[
                styles.dotWrap,
                { backgroundColor: tint(CATEGORY_COLORS[s.category], 0.18) },
              ]}>
              <View style={[styles.dot, { backgroundColor: CATEGORY_COLORS[s.category] }]} />
            </View>
            <View style={styles.legendText}>
              <ThemedText type="smallBold">{s.category}</ThemedText>
              {s.n !== undefined && (
                <ThemedText type="small" themeColor="textMuted">
                  {s.n} transaction{s.n === 1 ? '' : 's'}
                </ThemedText>
              )}
            </View>
            <ThemedText type="small" themeColor="textMuted" style={styles.legendPct}>
              {Math.round((s.total / total) * 100)}%
            </ThemedText>
            <ThemedText type="smallBold" style={styles.legendValue}>
              {formatINR(s.total)}
            </ThemedText>
          </View>
        );

        if (!onPressCategory) return <View key={s.category}>{row}</View>;
        return (
          <Pressable
            key={s.category}
            accessibilityRole="button"
            accessibilityLabel={`Show ${s.n ?? 0} ${s.category} transactions, ${formatINR(s.total)}`}
            style={({ pressed }) => (pressed ? styles.legendPressed : undefined)}
            onPress={() => onPressCategory(s.category)}>
            {row}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Vertical columns, as the "Last 6 months" chart is drawn in the design. */
export function ColumnBars({
  data,
  height = 150,
}: {
  data: { label: string; value: number }[];
  height?: number;
}) {
  const theme = useTheme();
  const max = Math.max(...data.map((d) => d.value), 1);
  const last = data.length - 1;
  const compact = (paise: number) =>
    paise >= 10000000 ? `₹${(paise / 10000000).toFixed(1)}L` : `₹${(paise / 100000).toFixed(1)}k`;

  return (
    <View style={styles.columnsWrap}>
      {/* Three dashed rules behind the bars only. The bar track starts 20px down, after the
          value labels, so the grid covers just that band. */}
      <View style={[styles.grid, { top: 20, height }]} pointerEvents="none">
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.gridLine, { borderColor: theme.borderStrong }]} />
        ))}
      </View>
      <View style={[styles.columns, { height: height + 34 }]}>
        {data.map((d, i) => {
          const on = i === last;
          return (
            <View key={d.label} style={styles.column}>
              <ThemedText
                type="small"
                themeColor={on ? 'text' : 'textMuted'}
                style={styles.columnValue}>
                {compact(d.value)}
              </ThemedText>
              <View style={[styles.columnTrack, { height }]}>
                <View
                  style={[
                    styles.columnFill,
                    {
                      height: `${Math.max((d.value / max) * 100, d.value > 0 ? 2 : 0)}%`,
                      backgroundColor: on ? theme.accent : theme.borderStrong,
                    },
                  ]}
                />
              </View>
              <ThemedText
                type="small"
                themeColor={on ? 'text' : 'textMuted'}
                style={styles.columnLabel}>
                {d.label}
              </ThemedText>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export function Bars({ data }: { data: { label: string; value: number }[] }) {
  const theme = useTheme();
  const max = Math.max(...data.map((d) => d.value), 1);
  const last = data.length - 1;
  return (
    <View style={styles.bars}>
      {data.map((d, i) => (
        <View key={d.label} style={styles.barRow}>
          <View style={styles.barHeader}>
            <ThemedText
              type="small"
              themeColor={i === last ? 'text' : 'textMuted'}
              style={styles.barLabel}>
              {d.label}
            </ThemedText>
            <ThemedText type="smallBold" themeColor={i === last ? 'text' : 'textMuted'}>
              {formatINR(d.value)}
            </ThemedText>
          </View>
          <Svg width="100%" height={10}>
            <Rect x={0} y={0} width="100%" height={10} rx={5} fill={theme.surfaceAlt} />
            <Rect
              x={0}
              y={0}
              width={`${Math.max((d.value / max) * 100, d.value > 0 ? 2 : 0)}%`}
              height={10}
              rx={5}
              fill={i === last ? theme.accent : theme.borderStrong}
            />
          </Svg>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  donut: { alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  // Absolute with no insets, the block would sit at the parent's top-left corner and grow
  // rightwards from it, so the label ends up off-centre in the hole.
  donutCenter: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  donutAmount: { fontSize: 24, lineHeight: 30, ...Tabular },
  donutSubtitle: { marginTop: 2 },
  legend: { gap: Spacing.three - 4, alignSelf: 'stretch' },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2 },
  legendPressed: { opacity: 0.55 },
  legendText: { flex: 1, gap: 1 },
  dotWrap: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 9, height: 9, borderRadius: 5 },
  legendLabel: { flex: 1 },
  legendPct: { minWidth: 38, textAlign: 'right' },
  legendValue: { minWidth: 92, textAlign: 'right', ...Tabular },
  bars: { gap: Spacing.three - 2 },
  barRow: { gap: Spacing.one },
  barHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  barLabel: { flex: 1 },
  columnsWrap: { position: 'relative' },
  grid: { position: 'absolute', left: 0, right: 0, top: 0, justifyContent: 'space-between' },
  gridLine: { borderTopWidth: 1, borderStyle: 'dashed', opacity: 0.5 },
  columns: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two + 2 },
  column: { flex: 1, alignItems: 'center', gap: Spacing.one },
  columnValue: { ...Tabular },
  columnTrack: { width: '100%', justifyContent: 'flex-end' },
  columnFill: { width: '100%', borderRadius: 6, minHeight: 2 },
  columnLabel: { letterSpacing: 0.3 },
});