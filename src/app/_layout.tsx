import {
  Stack,
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
  router,
  usePathname,
  type Href,
} from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, BackHandler, View } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { SmsPermissionGate } from '@/components/sms-permission-gate';
import { ThemeModeProvider, useTheme, useThemeMode } from '@/hooks/use-theme';
import { hasSmsPermission, runScan, startLiveCapture } from '@/lib/sms';
import { getPref } from '@/lib/db';
import { serverUrl, startBackgroundSync } from '@/lib/sync';

SplashScreen.preventAutoHideAsync();

// Without a handler an expense notification arriving while the app is open is silently
// dropped. SDK 57 renamed shouldShowAlert to shouldShowBanner/shouldShowList.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/** Tabs that sit after Timeline, where back should land on Timeline instead of exiting. */
const SECONDARY_TABS = ['/add', '/budgets', '/insights', '/settings'];

/**
 * The auto-scan is a once-per-launch thing, so it is guarded here rather than by an empty
 * dep array alone. The root layout can mount more than once in the life of a process —
 * a Fast Refresh, a theme change re-creating the tree — and each remount would otherwise
 * start another full-inbox scan on top of the one still running. This resets only when
 * the JS process does, which is exactly what "on launch" means.
 */
let autoScanned = false;

/**
 * The only route an expense notification ever links to. Matching it is what lets the
 * string become a typed Href, and keeps a tampered payload from navigating anywhere.
 *
 * A clientId UUID, not the old local integer — see the note on Expense.client_id.
 */
const EXPENSE_ROUTE = /^\/expense\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const urlOf = (n: Notifications.Notification): Href | null => {
  const url = n.request.content.data?.url;
  return typeof url === 'string' && EXPENSE_ROUTE.test(url) ? (url as Href) : null;
};

export default function RootLayout() {
  return (
    <ThemeModeProvider>
      <NavigationShell />
    </ThemeModeProvider>
  );
}

function NavigationShell() {
  const theme = useTheme();
  const { isDark } = useThemeMode();

  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  const pathname = usePathname();
  /** Once per launch. Without this the redirect fights the answer. */
  const redirectAttempted = useRef(false);

  const [onboarding, setOnboarding] = useState<null | boolean>(null);

  // Re-read on every focus, not just at mount: the account screen answers the question by
  // writing the pref and navigating away, and the gate below waits on this.
  const readOnboarding = useCallback(() => {
    void (async () => {
      // Only ask when there is a server to ask about. A build with no EXPO_PUBLIC_SYNC_URL
      // has no accounts to make, so it goes straight to the SMS question as before.
      if (serverUrl() === null) {
        setOnboarding(true);
        return;
      }
      setOnboarding((await getPref('onboarded')) === '1');
    })();
  }, []);

  // Re-read on mount and again on every navigation, not on focus: this is the root
  // layout, so it never actually loses focus and a focus-based re-read fires exactly
  // once. Navigating away from /account is what writes the pref, so the navigation is
  // the signal.
  useEffect(() => {
    readOnboarding();
  }, [readOnboarding, pathname]);

  useEffect(() => {
    // replace, not push: back from a first-run screen should leave the app, not land on
    // an empty Timeline behind a screen the user has not answered yet.
    //
    // Once only. Navigating away writes the pref and replaces to '/', which changes the
    // pathname and re-runs this before the re-read lands — so without the guard it pushes
    // the user straight back to /account after they answered.
    if (onboarding === false && !redirectAttempted.current) {
      redirectAttempted.current = true;
      router.replace('/account');
    }
  }, [onboarding]);

  // App-wide, so a bank SMS is captured no matter which tab is open. Also drains
  // anything the manifest receiver queued while the app was closed.
  useEffect(() => {
    startLiveCapture();
  }, []);

  // Foreground is the natural sync trigger: it is the only moment we know the user is
  // looking at the app, and a failure here has nowhere to go. startBackgroundSync never
  // rejects and never blocks the tree, so this cannot wedge startup on a dead server.
  //
  // AppState rather than useFocusEffect. This is the root layout, which never loses
  // focus, so a focus-based callback fires exactly once at mount and never again — the
  // same trap that broke the onboarding redirect. AppState is the platform's own
  // foreground signal and does not care how the navigator is structured.
  useEffect(() => {
    // AppState is already 'active' on a cold start, so no 'change' event fires for it.
    startBackgroundSync();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') startBackgroundSync();
    });
    return () => sub.remove();
  }, []);


  // expo-router's native tabs never handle a back action (NativeBottomTabsRouter has no
  // GO_BACK branch, and backBehavior is only its default), so back on any tab but Timeline
  // pops the whole tabs screen and drops out of the app. Land on Timeline first instead.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!SECONDARY_TABS.includes(pathname)) return false;
      router.navigate('/');
      return true;
    });
    return () => sub.remove();
  }, [pathname]);

  // Tapping an expense notification opens that expense. The last response is read too,
  // since a notification that cold-starts the app fires no tap while JS is still booting.
  useEffect(() => {
    const open = (n: Notifications.Notification) => {
      const url = urlOf(n);
      if (url !== null) router.push(url);
    };

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      open(response.notification);
    });

    const last = Notifications.getLastNotificationResponse();
    if (last?.notification) {
      open(last.notification);
      // Otherwise every later launch would re-open whatever was last tapped.
      void Notifications.clearLastNotificationResponseAsync().catch(() => {});
    }

    return () => sub.remove();
  }, []);

  // Rendering before Inter arrives flashes the system face, then swaps. Hold the tree.
  //
  // `onboarding` is null until the pref read resolves, and that is the same hold: without
  // it the SMS gate would ask its question before the account question, which is the
  // reverse of the order the user actually wants. Both are below every hook, so hook
  // order never changes.
  //
  // Built on expo-router's own themes so the stack header inherits the app palette
  // without re-declaring the font tokens React Navigation expects.
  const navTheme = useMemo(
    () => ({
      ...(isDark ? DarkTheme : DefaultTheme),
      dark: isDark,
      colors: {
        ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
        primary: theme.accent,
        background: theme.background,
        card: theme.surface,
        text: theme.text,
        border: theme.border,
        notification: theme.accent,
      },
    }),
    [isDark, theme]
  );

  if ((!fontsLoaded && !fontError) || onboarding === null) {
    return <View style={{ flex: 1, backgroundColor: theme.background }} />;
  }

  return (
    <ThemeProvider value={navTheme}>
      <AnimatedSplashOverlay />
      {/* Gated on the account question, not just on the pref having loaded: otherwise both
          questions are on screen at once, and the SMS one is on top. */}
      {onboarding === true && <SmsPermissionGate />}
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="account" options={{ headerShown: false }} />
        <Stack.Screen name="expense/[id]" options={{ title: 'Expense' }} />
      </Stack>
    </ThemeProvider>
  );
}