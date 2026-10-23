import { formatINR, formatINRWorklet, timeLabel } from '@/lib/money';

// formatINRWorklet exists only to animate on the UI thread, where Intl does not exist. It
// is a hand-rolled copy, so the one thing that must hold is that it prints exactly what the
// Intl version prints: the roll would otherwise reformat the number the instant it settles.
const PAISE = [
  0, 1, 9, 10, 99, 100, 999, 1000, 1099, 9999, 10_000, 99_999, 100_000, 123_456,
  1_000_000, 1_234_567, 12_345_678, 123_456_789, 100_000_000, 9_999_999_999,
  -500, -1000, -12_345_678,
];

describe('formatINRWorklet', () => {
  it.each(PAISE)('matches formatINR for %i paise', (paise) => {
    expect(formatINRWorklet(paise)).toBe(formatINR(paise));
  });

  it('groups in threes then pairs, the way en-IN does', () => {
    // 123,456,789 paise is 12,34,567.89 rupees: "12,34,567", not "123,456,789".
    expect(formatINRWorklet(123_456_789)).toBe(formatINR(123_456_789));
    expect(formatINRWorklet(123_456_789)).toContain('12,34,567');
  });

  it('keeps the sign outside the currency mark, as Intl does', () => {
    expect(formatINRWorklet(-1000)).toBe(formatINR(-1000));
  });

  it('always prints two decimals, so the width does not jump while rolling', () => {
    expect(formatINRWorklet(1000)).toMatch(/\.\d{2}$/);
    expect(formatINRWorklet(1005)).toMatch(/\.\d{2}$/);
  });
});

// Local constructors on purpose: the label reads the device's wall clock, so the
// expectation must be built the same way, whatever timezone the test machine is in.
describe('timeLabel', () => {
  it.each([
    [new Date(2026, 9, 21, 0, 0), '12:00 AM'],
    [new Date(2026, 9, 21, 9, 5), '9:05 AM'],
    [new Date(2026, 9, 21, 11, 59), '11:59 AM'],
    [new Date(2026, 9, 21, 12, 0), '12:00 PM'],
    [new Date(2026, 9, 21, 13, 7), '1:07 PM'],
    [new Date(2026, 9, 21, 23, 59), '11:59 PM'],
  ])('renders %s as %s', (at, want) => {
    expect(timeLabel(at.getTime())).toBe(want);
  });
});
