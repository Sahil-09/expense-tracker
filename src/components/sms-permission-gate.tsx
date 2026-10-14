import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button, Label, LineIcon } from '@/components/ui-kit';
import { useTheme } from '@/hooks/use-theme';
import { getPref, setPref } from '@/lib/db';
import { ensureNotificationsReady } from '@/lib/notify';
import {
  hasSmsPermission,
  isAndroid,
  nativeModuleMissing,
  requestSmsPermission,
  runScan,
} from '@/lib/sms';
import { BottomTabInset, MaxContentWidth, Radii, Spacing } from '@/constants/theme';

const PROMPTED = 'sms_prompted';

/**
 * Asks for SMS access once, on first launch.
 *
 * Two permissions are requested together and they mean different things: READ_SMS reads
 * the inbox during a scan, RECEIVE_SMS is what lets a message be logged the moment it
 * arrives. The user is told about both here, because a bare system dialog for a
 * background-listening permission is easy to refuse without knowing what is being offered.
 * The prompt itself is shown at most once: the answer is remembered so a "Not now" never
 * turns into a nag.
 */
export function SmsPermissionGate() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!isAndroid || nativeModuleMissing) return;
    let cancelled = false;
    void (async () => {
      if (await hasSmsPermission()) return;
      if ((await getPref(PROMPTED)) === '1') return;
      if (!cancelled) setAsking(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const answer = async (ask: boolean) => {
    setAsking(false);
    await setPref(PROMPTED, '1');
    if (!ask) return;
    // Consent is only worth anything if it leads somewhere: scan straight away so the
    // history is already on screen, instead of leaving an empty app and a manual step.
    if (!(await requestSmsPermission())) return;
    // Asked here because this is the only moment the user is already expecting a prompt.
    // A refusal costs nothing: capture still works, it just stops popping up.
    await ensureNotificationsReady();
    await runScan().catch(() => {});
  };

  if (!asking) return null;

  return (
    <ThemedView style={styles.overlay}>
      <ScrollView
        style={styles.scroller}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + Spacing.four,
            paddingBottom: insets.bottom + BottomTabInset + Spacing.four,
          },
        ]}>
        <View style={[styles.badge, { backgroundColor: theme.accent }]}>
          <LineIcon name="message" size={26} color={theme.onAccent} />
        </View>

        <Label>One time setup</Label>
        <ThemedText type="title">Read your bank SMS</ThemedText>

        <ThemedText type="body" themeColor="textSecondary" style={styles.body}>
          Expense Tracker turns your bank and payment messages into expenses. It asks for two
          things: permission to read your messages, so everything already sitting in your inbox
          can be imported, and permission to be told when a new one arrives, so spending is
          logged the moment it happens instead of waiting for you to open the app. It also asks
          to post notifications, so each new expense can show what is left of this month&rsquo;s budget.
        </ThemedText>

        <View style={[styles.note, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <ThemedText type="small" themeColor="textMuted">
            Messages stay on this phone. Nothing is uploaded and no account is created. You can
            still paste messages by hand if you say no.
          </ThemedText>
        </View>

        <Label>Turn any of them off later in Android settings</Label>

        <View style={styles.actions}>
          <Button label="Allow access" onPress={() => void answer(true)} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Not now"
            style={styles.skip}
            onPress={() => void answer(false)}>
            <ThemedText type="small" themeColor="textMuted">
              Not now
            </ThemedText>
          </Pressable>
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, zIndex: 100 },
  // flex:1 here, not on the overlay. Centering on the overlay instead makes an
  // over-tall form overflow both ends with no scroll range, clipping the top away.
  scroller: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
  },
  badge: {
    width: 56,
    height: 56,
    borderRadius: Radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { lineHeight: 24 },
  note: { borderRadius: Radii.lg, borderWidth: StyleSheet.hairlineWidth, padding: Spacing.three },
  actions: { gap: Spacing.two, marginTop: Spacing.two },
  skip: { alignItems: 'center', paddingVertical: Spacing.three - 2 },
});