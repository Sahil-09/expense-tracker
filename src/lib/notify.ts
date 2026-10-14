import * as Notifications from 'expo-notifications';

import { getExpense, listBudgets, monthlyTotal } from './db';
import { formatINR, monthStart } from './money';

/** Android needs a channel before it will even show the permission prompt. */
const CHANNEL_ID = 'expenses';

export type BudgetStats = {
  /** Sum of the per-category monthly limits. 0 when the user has set none. */
  target: number;
  spent: number;
  /** target - spent. Negative once the month is blown. */
  left: number;
  daysLeft: number;
  /** What is left per remaining day, floored at 0. */
  safePerDay: number;
};

/**
 * Pure month maths, kept out of the notification code so it can be tested without
 * a device. `now` is injected rather than read so a test can pin the date.
 */
export function budgetStats(spent: number, target: number, now: number): BudgetStats {
  const d = new Date(now);
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const daysLeft = Math.max(daysInMonth - d.getDate() + 1, 0);
  const left = target - spent;
  return {
    target,
    spent,
    left,
    daysLeft,
    safePerDay: daysLeft > 0 ? Math.floor(Math.max(left, 0) / daysLeft) : 0,
  };
}

/** Whole rupees, like the Timeline's summary figures. Paise are noise in a popup. */
function rupees(paise: number): string {
  return `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;
}

function budgetLine(s: BudgetStats): string {
  if (s.target <= 0) return `${rupees(s.spent)} spent this month · no budget set`;
  if (s.left < 0) {
    return `${rupees(s.spent)} of ${rupees(s.target)} · over by ${rupees(-s.left)}`;
  }
  return `${rupees(s.spent)} of ${rupees(s.target)} · ${rupees(s.safePerDay)}/day safe for ${s.daysLeft} days`;
}

/**
 * Creates the channel and asks for permission. Called once, right after SMS access is
 * granted. A refusal is not an error worth surfacing — capture still works without it.
 */
export async function ensureNotificationsReady(): Promise<boolean> {
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Expenses',
      // HIGH, not DEFAULT: the whole point is seeing a spend the moment it happens, and
      // DEFAULT only drops it into the shade. Channels are immutable once created, so a
      // user who created this channel earlier keeps whatever importance they were given.
      importance: Notifications.AndroidImportance.HIGH,
    });
    const existing = await Notifications.getPermissionsAsync();
    const status = existing.granted ? existing : await Notifications.requestPermissionsAsync();
    return status.granted;
  } catch {
    return false;
  }
}

/**
 * Pops a heads-up for one freshly logged expense, carrying the month it lands in and
 * how much is safe to spend per remaining day.
 *
 * Best-effort by design: it runs on the live-capture path, so a missing permission, a
 * missing module or a dead channel must never cost us the expense itself.
 */
export async function notifyExpense(id: number): Promise<void> {
  try {
    const expense = await getExpense(id);
    if (expense === null) return;

    // The expense's own month, not this one: a message can carry an older date in its
    // body, and the budget line would then contradict the row it is attached to.
    const month = monthStart(expense.txn_at);
    const [budgets, spent] = await Promise.all([listBudgets(), monthlyTotal(month)]);
    const target = budgets.reduce((sum, b) => sum + b.monthly_paise, 0);

    await Notifications.scheduleNotificationAsync({
      content: {
        title: `${expense.merchant ?? 'Unknown merchant'} −${formatINR(expense.amount_paise)}`,
        body: budgetLine(budgetStats(spent, target, expense.txn_at)),
        // clientId, not the local integer: after sync the same integer exists on two
        // devices meaning two different expenses, so a notification built from it would
        // open the wrong one.
        data: { url: `/expense/${expense.client_id}` },
      },
      // Not `trigger: null`: that posts immediately but lands on expo-notifications'
      // fallback channel, so the HIGH importance set above is silently ignored.
      // A bare channelId is the immediate-delivery trigger that respects it.
      trigger: { channelId: CHANNEL_ID },
    });
  } catch {
    // No permission, or the module is not in this build.
  }
}