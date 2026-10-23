import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button, Card, Label, LineIcon } from '@/components/ui-kit';
import { useTheme } from '@/hooks/use-theme';
import {
  forgotPassword,
  hasBackedUp,
  markBackedUp,
  register,
  resetPassword,
  serverUrl,
  signIn,
} from '@/lib/sync';
import { confirmAlert } from '@/lib/confirm';
import { setPref } from '@/lib/db';
import { BottomTabInset, MaxContentWidth, Radii, Spacing } from '@/constants/theme';

const confirmBackup = () =>
  confirmAlert(
    'Back up first',
    'This device will give every expense a new id so it can sync. Copy the app data (or pull the database with adb) before continuing.',
    'I have a backup'
  );

type Mode = 'signin' | 'signup' | 'reset';

const MODES: { id: Mode; label: string }[] = [
  { id: 'signin', label: 'Sign in' },
  { id: 'signup', label: 'Create' },
  { id: 'reset', label: 'Reset' },
];

/**
 * First run, and reachable again from Settings.
 *
 * Reached two ways, so it must behave in both: the root layout redirects here on a fresh
 * install, and Settings pushes it for someone who chose to stay local and changed their
 * mind. That is why nothing on this screen reads the onboarding flag itself — the redirect
 * in _layout owns that, and pushing here simply works.
 */
export default function AccountScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const needsCode = mode !== 'signin';

  const canSubmit =
    email.trim() !== '' &&
    password !== '' &&
    (needsCode ? code.trim() !== '' : true) &&
    !busy;

  /** Leaves the account question behind. Everything after this is the same app. */
  const done = async () => {
    await setPref('onboarded', '1');
    router.replace('/');
  };

  /** Emails a reset code. Shares `busy` so a send cannot overlap a submit, or itself. */
  const sendCode = async () => {
    setBusy(true);
    setNote(null);
    try {
      setNote(
        (await forgotPassword(email.trim())) ?? 'If that address has an account, a code is on its way.'
      );
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setNote(null);
    try {
      // Turning on sync is the moment this device gives every expense a new id, and that
      // is the only step in the app that can touch live history. Asking once, before the
      // first sign-in, is cheap insurance; the prompt cannot be skipped by muscle memory
      // because it is the only thing on the way through.
      if ((mode === 'signin' || mode === 'signup') && !(await hasBackedUp())) {
        const ok = await confirmBackup();
        if (!ok) {
          setNote('Sync not turned on.');
          return;
        }
        await markBackedUp();
      }

      // Reset deliberately does not sign in: it proves the code, changes the password and
      // leaves them to sign in with it.
      const error =
        mode === 'signin'
          ? await signIn(email.trim(), password)
          : mode === 'signup'
            ? await register(email.trim(), password, code.trim())
            : await resetPassword(email.trim(), code.trim(), password);
      if (error !== null) {
        setNote(error);
        return;
      }
      if (mode === 'reset') {
        setNote('Password changed. Sign in with it.');
        setMode('signin');
        setPassword('');
        return;
      }
      await done();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + Spacing.four,
            paddingBottom: insets.bottom + BottomTabInset + Spacing.four,
          },
        ]}
        keyboardShouldPersistTaps="handled">
        <View style={[styles.badge, { backgroundColor: theme.accent }]}>
          <LineIcon name="cloud" size={26} color={theme.onAccent} />
        </View>

        <Label>Optional</Label>
        <ThemedText type="title">Keep a backup, or don&rsquo;t</ThemedText>

        <ThemedText type="body" themeColor="textSecondary" style={styles.body}>
          The app works entirely on this phone with no account at all. Signing in adds a
          second copy of your expenses on your own server, so a lost phone is not a lost
          history — and nothing here leaves that server.
        </ThemedText>

        <View style={styles.segment}>
          {MODES.map((m) => {
            const on = mode === m.id;
            return (
              <Pressable
                key={m.id}
                accessibilityRole="tab"
                accessibilityLabel={m.label}
                accessibilityState={{ selected: on }}
                style={[
                  styles.segmentItem,
                  {
                    backgroundColor: on ? theme.accent : 'transparent',
                    borderColor: on ? theme.accent : theme.border,
                  },
                ]}
                onPress={() => {
                  setMode(m.id);
                  setNote(null);
                }}>
                <ThemedText type="smallBold" style={on && { color: theme.onAccent }}>
                  {m.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>

        <Card>
          {mode === 'signup' && (
            <ThemedText type="small" themeColor="textMuted" style={styles.hint}>
              You need the code whoever runs the server gave you. Without it, accounts
              cannot be created here.
            </ThemedText>
          )}
          {mode === 'reset' && (
            <ThemedText type="small" themeColor="textMuted" style={styles.hint}>
              Tap Send code and an 8-digit code goes out to the address above. It is not the
              same as the signup code.
            </ThemedText>
          )}

          <Field label="Email" value={email} onChange={setEmail} auto="email" />

          {mode === 'reset' && (
            // Disabled on an empty box and while anything is in flight, or a lost double-tap
            // mails a second code and the first one they read is already stale.
            <Button
              label="Send code"
              icon="message"
              disabled={email.trim() === '' || busy}
              onPress={() => void sendCode()}
            />
          )}

          <Field
            label={mode === 'reset' ? 'New password' : 'Password'}
            value={password}
            onChange={setPassword}
            secure
            hint={mode === 'signin' ? undefined : 'At least 10 characters.'}
          />

          {needsCode && (
            <Field label="Code" value={code} onChange={setCode} secure auto="off" />
          )}

          <Button
            label={
              busy
                ? 'One moment…'
                : mode === 'signin'
                  ? 'Sign in'
                  : mode === 'signup'
                    ? 'Create account'
                    : 'Reset password'
            }
            disabled={!canSubmit}
            onPress={() => void submit()}
          />

          {note !== null && (
            <ThemedText
              type="small"
              themeColor={note.startsWith('Password changed') ? 'positive' : 'textMuted'}>
              {note}
            </ThemedText>
          )}
        </Card>

        <View style={[styles.note, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}>
          <ThemedText type="small" themeColor="textMuted">
            {serverUrl() === null
              ? 'No sync server is configured in this build, so staying local is all there is.'
              : 'Staying local keeps everything on this phone. You can add sync later from Settings.'}
          </ThemedText>
        </View>

        <Button label="Continue without an account" onPress={() => void done()} />
      </ScrollView>
    </ThemedView>
  );
}

function Field({
  label,
  value,
  onChange,
  secure,
  auto,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  secure?: boolean;
  auto?: 'email' | 'off';
  hint?: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <Label>{label}</Label>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete={auto === 'off' ? 'off' : auto}
        keyboardType={auto === 'email' ? 'email-address' : 'default'}
        secureTextEntry={secure}
        style={[
          styles.input,
          { color: theme.text, backgroundColor: theme.surfaceAlt, borderColor: theme.border },
        ]}
      />
      {hint !== undefined && (
        <ThemedText type="small" themeColor="textMuted">
          {hint}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
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
  hint: { marginBottom: Spacing.two },
  segment: { flexDirection: 'row', gap: Spacing.two },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.two,
  },
  field: { gap: Spacing.two - 4 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.md,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.two,
    fontSize: 15,
    lineHeight: 20,
  },
  note: {
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
  },
});