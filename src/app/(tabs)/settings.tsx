import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button, Card, Label, LineIcon, tint } from '@/components/ui-kit';
import Constants from 'expo-constants';
import { useMonthlyTotals } from '@/hooks/use-data';
import { useTheme, useThemeMode, type ThemeMode } from '@/hooks/use-theme';
import {
  BACKFILL_DAYS,
  hasSmsPermission,
  isAndroid,
  nativeModuleMissing,
  requestSmsPermission,
  runScan,
} from '@/lib/sms';
import { clearAll, countExpenses } from '@/lib/db';
import { formatINR } from '@/lib/money';
import { BottomTabInset, MaxContentWidth, Radii, Spacing } from '@/constants/theme';

const MODES: { value: ThemeMode; label: string; icon: string }[] = [
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
  { value: 'system', label: 'System', icon: 'laptop' },
];

export default function SettingsScreen() {
  const [count, setCount] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [granted, setGranted] = useState<boolean | null>(null);
  const totals = useMonthlyTotals(12);
  const lifetime = totals.reduce((sum, t) => sum + t.total, 0);
  const { mode, setMode } = useThemeMode();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    void countExpenses().then(setCount);
    void hasSmsPermission().then(setGranted);
  }, []);


  const scan = async () => {
    if (!hasSmsPermission()) await requestSmsPermission();
    setBusy(true);
    setStatus(null);
    // Without this, any thrown error escapes `void scan()` as an unhandled rejection
    // and pops a red box instead of a message the user can read.
    const result = await runScan(BACKFILL_DAYS).catch((e) => ({
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
    }));
    setBusy(false);
    setGranted(await hasSmsPermission());

    if (!result.ok) {
      setStatus(result.error);
    } else if (result.scanned === 0) {
      setStatus(
        `Permission ${granted === false ? 'still not granted' : 'looks granted'}, but 0 messages came back. ` +
          'If you just granted it, reopen the app and scan again.'
      );
    } else {
      setStatus(
        `Read ${result.scanned} · added ${result.added} · already had ${result.duplicates} · ` +
          `skipped ${result.skipped} (not a spend)` +
          (result.reclassified > 0 ? ` · ${result.reclassified} moved out of totals` : '') +
          (result.failed > 0 ? ` · ${result.failed} failed` : '') +
          '.'
      );
      setCount(await countExpenses());
    }
  };

  const smsReady = !nativeModuleMissing && granted === true;

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + Spacing.two }]}>
        <Label>Preferences &amp; data</Label>
        <ThemedText type="title">Settings</ThemedText>

        <Card>
          <View style={styles.labelRow}>
            <Label>At a glance</Label>
            <ThemedText type="small" themeColor="textMuted">All figures</ThemedText>
          </View>
          <Row icon="doc" label="Expenses stored" value={count === null ? '…' : String(count)} />
          <Row icon="chart" label="Tracked over 12 months" value={formatINR(lifetime)} />
        </Card>

        <View style={styles.sectionHeader}>
          <Label>Sms capture</Label>
          {smsReady && (
            <View style={[styles.pill, { backgroundColor: tint(theme.positive, 0.16) }]}>
              <ThemedText type="smallBold" style={{ color: theme.positive }}>
                Android ready
              </ThemedText>
            </View>
          )}
        </View>

        <Card>
          {isAndroid ? (
            <>
              <Row label="Native SMS module" value={nativeModuleMissing ? 'Missing' : 'Loaded'} />
              <Row
                label="SMS permission"
                value={granted === null ? '…' : granted ? 'Granted' : 'Not granted'}
              />
              <ThemedText type="small" themeColor="textMuted">
                Reads the last {BACKFILL_DAYS} days and logs anything that looks like a payment.
                Income, OTPs and promotions are ignored.
              </ThemedText>
              <Button
                icon="refresh"
                label={busy ? 'Scanning…' : 'Scan inbox now'}
                disabled={busy}
                onPress={() => void scan()}
              />
            </>
          ) : (
            <ThemedText type="small" themeColor="textMuted">
              Apple does not allow any app to read the SMS inbox. On iOS, share a message from
              Messages to this app, or paste it from the Timeline screen.
            </ThemedText>
          )}

          {status !== null && (
            <ThemedText type="small" themeColor={status.startsWith('Read') ? 'positive' : 'textMuted'}>
              {status}
            </ThemedText>
          )}
        </Card>


        <Label>Appearance</Label>

        <Card>
          <Row icon="gear" label="Theme" value={mode.toUpperCase()} />
          <View style={styles.segment}>
            {MODES.map((m) => {
              const selected = mode === m.value;
              return (
                <Pressable
                  key={m.value}
                  accessibilityRole="button"
                  accessibilityLabel={`${m.label} theme`}
                  accessibilityState={{ selected }}
                  style={[
                    styles.segmentItem,
                    {
                      backgroundColor: selected ? theme.accent : 'transparent',
                      borderColor: selected ? theme.accent : theme.border,
                    },
                  ]}
                  onPress={() => setMode(m.value)}>
                  <View style={styles.segInner}>
                    <LineIcon
                      name={m.icon}
                      size={15}
                      color={selected ? theme.onAccent : theme.textMuted}
                    />
                    <ThemedText type="smallBold" style={selected && { color: theme.onAccent }}>
                      {m.label}
                    </ThemedText>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </Card>

        <Label style={{ color: theme.danger }}>Danger zone</Label>

        <Card style={{ borderColor: tint(theme.danger, 0.35) }}>
          <View style={styles.dangerHead}>
            <LineIcon name="warning" size={16} color={theme.danger} />
            <ThemedText type="small" themeColor="textMuted" style={styles.dangerBody}>
              Deletes every logged expense. Budgets are kept. This cannot be undone.
            </ThemedText>
          </View>
          <Button
            label="Clear all expenses"
            tone="danger"
            onPress={() =>
              void Alert.alert('Clear all expenses?', 'This permanently deletes every logged expense.', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: () => {
                    void clearAll().then(async () => {
                      setCount(await countExpenses());
                      setStatus('All expenses deleted.');
                    });
                  },
                },
              ])
            }
          />
        </Card>

        <ThemedText type="label" themeColor="textMuted" style={styles.footer}>
          Expense Tracker � v{Constants.expoConfig?.version ?? '1.0.0'}
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

function Row({ label, value, icon }: { label: string; value: string; icon?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      {icon !== undefined && <LineIcon name={icon} size={17} color={theme.textMuted} />}
      <ThemedText type="small" themeColor="textSecondary" style={styles.rowLabel}>
        {label}
      </ThemedText>
      <ThemedText type="smallBold">{value}</ThemedText>
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
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  segInner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  pill: { borderRadius: Radii.pill, paddingHorizontal: Spacing.two + 2, paddingVertical: 3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2 },
  rowLabel: { flex: 1 },
  segment: { flexDirection: 'row', gap: Spacing.two },
  segmentItem: {
    flex: 1,
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.two + 2,
    alignItems: 'center',
  },
  dangerHead: { flexDirection: 'row', gap: Spacing.two + 2, alignItems: 'flex-start' },
  dangerBody: { flex: 1 },
  footer: { textAlign: 'center', paddingTop: Spacing.two },
});