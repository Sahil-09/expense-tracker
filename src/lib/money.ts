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