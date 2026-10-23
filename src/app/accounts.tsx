import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Card, Label, LineIcon, tint } from '@/components/ui-kit';
import { listBalanceHistory, listLatestBalances, type Balance } from '@/lib/db';
import { formatINR, timeLabel } from '@/lib/money';
import { useTheme } from '@/hooks/use-theme';
import { BottomTabInset, MaxContentWidth, Radii, Spacing } from '@/constants/theme';

/**
 * Every account the bank SMSs name, and the balance each one last reported.
 *
 * One screen with two modes rather than two screens: the list, and the history of one
 * account. The account is a query param, so drilling in is a navigation the router
 * already knows how to back out of.
 */
export default function AccountsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { account } = useLocalSearchParams<{ account?: string }>();

  const [latest, setLatest] = useState<Balance[] | null>(null);
  const [history, setHistory] = useState<Balance[] | null>(null);

  const reload = useCallback(async () => {
    if (account === undefined) {
      setLatest(await listLatestBalances());
    } else {
      setHistory(await listBalanceHistory(account));
    }
  }, [account]);

  // Focus rather than mount: the balance changes when a new SMS lands, and coming back
  // from a deep link is exactly when the list can be stale.
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload])
  );

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + Spacing.two }]}>
        {account === undefined ? (
          <>
            <Label>Balances</Label>
            <ThemedText type="title">Accounts</ThemedText>
            {latest === null ? (
              <ThemedText type="small" themeColor="textMuted">
                Loading…
              </ThemedText>
            ) : latest.length === 0 ? (
              <Card>
                <ThemedText type="small" themeColor="textMuted">
                  No balances yet. A bank SMS that quotes one will show it here.
                </ThemedText>
              </Card>
            ) : (
              latest.map((b) => (
                <Pressable
                  key={b.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${b.account}, balance ${formatINR(b.amount_paise)}. Show history.`}
                  onPress={() =>
                    router.push({ pathname: '/accounts', params: { account: b.account } })
                  }>
                  <Card style={styles.card}>
                    <View style={styles.row}>
                      <View style={styles.labelRow}>
                        <View
                          style={[
                            styles.icon,
                            { backgroundColor: tint(theme.accent, 0.16) },
                          ]}>
                          <LineIcon name="doc" size={16} color={theme.accent} />
                        </View>
                        <ThemedText type="smallBold">{b.account}</ThemedText>
                      </View>
                      <ThemedText type="title">{formatINR(b.amount_paise)}</ThemedText>
                    </View>
                    <ThemedText type="small" themeColor="textMuted" style={styles.raw}>
                      As of{' '}
                      {new Date(b.txn_at).toLocaleDateString(undefined, {
                        day: '2-digit',
                        month: 'short',
                      })}
                      , {timeLabel(b.txn_at)}. Tap for history.
                    </ThemedText>
                  </Card>
                </Pressable>
              ))
            )}
          </>
        ) : (
          <>
            <Label>Account</Label>
            <ThemedText type="title">{account}</ThemedText>
            {history === null ? (
              <ThemedText type="small" themeColor="textMuted">
                Loading…
              </ThemedText>
            ) : history.length === 0 ? (
              <Card>
                <ThemedText type="small" themeColor="textMuted">
                  No balance recorded for this account yet.
                </ThemedText>
              </Card>
            ) : (
              history.map((b) => (
                <Card key={b.id} style={styles.card}>
                  <View style={styles.row}>
                    <ThemedText type="small" themeColor="textMuted">
                      {new Date(b.txn_at).toLocaleDateString(undefined, {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}{' '}
                      · {timeLabel(b.txn_at)}
                    </ThemedText>
                    <ThemedText type="smallBold">{formatINR(b.amount_paise)}</ThemedText>
                  </View>
                  <ThemedText type="small" themeColor="textMuted" style={styles.raw}>
                    {b.raw_sms}
                  </ThemedText>
                </Card>
              ))
            )}
          </>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.four,
    paddingBottom: BottomTabInset,
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  card: { gap: Spacing.one },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  icon: {
    width: 28,
    height: 28,
    borderRadius: Radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  raw: { lineHeight: 18 },
});
