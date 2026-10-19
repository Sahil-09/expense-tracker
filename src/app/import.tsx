import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';

import { ingestSms } from '@/lib/db';
import { notifyExpense } from '@/lib/notify';

/**
 * iOS has no SMS-reading API, so an Apple Shortcut forwards a message body here
 * via `expensetracker://import?sms=<encoded>`. We ingest it the same way a pasted
 * SMS is ingested, fire the same heads-up, and land on the Timeline.
 *
 * With no `sms` param this keeps its old behaviour: bounce to the Add tab.
 */
export default function ImportScreen() {
  const params = useLocalSearchParams<{ sms?: string | string[] }>();
  // A URL can carry the param more than once; the first message wins.
  const sms = Array.isArray(params.sms) ? params.sms[0] : params.sms;
  // A ref, not a flag: React runs effects twice in development, and the ref survives
  // the remount, so the message is ingested once.
  const started = useRef(false);

  useEffect(() => {
    if (typeof sms !== 'string' || sms.trim() === '' || started.current) return;
    started.current = true;
    void (async () => {
      try {
        const outcome = await ingestSms(sms, null, 'ios-shortcut');
        if (outcome.status === 'added') void notifyExpense(outcome.id);
      } catch {
        // A failed import must not leave the user on a blank screen.
      }
      router.replace('/');
    })();
  }, [sms]);

  if (typeof sms !== 'string' || sms.trim() === '') return <Redirect href="/add" />;
  // Nothing to show: the effect is ingesting, and then it navigates to the Timeline.
  return null;
}
