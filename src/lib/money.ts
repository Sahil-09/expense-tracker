const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

/** "1,23,456.78" -> 12345678. Integer maths only; floats lose paise. */
export function toPaise(input: string): number | null {
  const clean = input.replace(/[,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const [whole, frac = ''] = clean.split('.');
  return Number(whole) * 100 + Number((frac + '00').slice(0, 2));
}

export function formatINR(paise: number): string {
  return INR.format(paise / 100);
}

/**
 * Worklet-safe twin of `formatINR`, for the animated money roll.
 *
 * `Intl.NumberFormat` does not exist on the UI thread, so the counter cannot use it. This
 * has to stay byte-identical to `formatINR` — Indian grouping, the two decimals Intl
 * always emits, the sign position — or the number visibly changes format the instant the
 * animation settles. `money.test.ts` asserts that equivalence across a spread of values.
 */
export function formatINRWorklet(paise: number): string {
  'worklet';
  const negative = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const frac = abs % 100;

  // Indian grouping: last three digits, then pairs. `1,23,456` rather than `123,456`.
  const digits = String(rupees);
  let whole: string;
  if (digits.length <= 3) {
    whole = digits;
  } else {
    const last3 = digits.slice(-3);
    const rest = digits.slice(0, -3);
    whole = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
  }

  const tail = frac < 10 ? '0' + frac : String(frac);
  return `${negative ? '-' : ''}₹${whole}.${tail}`;
}

/** Start of the month containing `at`, as a local-midnight epoch ms. */
export function monthStart(at: number): number {
  const d = new Date(at);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

export function addMonths(epochMs: number, delta: number): number {
  const d = new Date(epochMs);
  return new Date(d.getFullYear(), d.getMonth() + delta, 1).getTime();
}

export function monthKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/** "Mon, 5 Oct" — the day-group header format the design uses. */
export function dayLabel(at: number): string {
  const d = new Date(at);
  const weekday = d.toLocaleDateString(undefined, { weekday: 'short' });
  const month = d.toLocaleDateString(undefined, { month: 'short' });
  return `${weekday}, ${d.getDate()} ${month}`;
}

/**
 * "10:14 AM" — 12-hour with an explicit meridiem.
 *
 * Hand-rolled rather than `toLocaleTimeString`: that follows the device's 24-Hour Time
 * setting, which drops the AM/PM this exists to show.
 */
export function timeLabel(at: number): string {
  const d = new Date(at);
  const hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours % 12 || 12}:${minutes} ${hours < 12 ? 'AM' : 'PM'}`;
}