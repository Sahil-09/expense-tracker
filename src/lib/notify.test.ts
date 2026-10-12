import { budgetStats } from '@/lib/notify';

// Pinned so the day count is not whatever the test happens to run on.
const oct = (day: number) => new Date(2026, 9, day, 12, 0, 0).getTime();

describe('budgetStats', () => {
  it('divides what is left by the days remaining, including today', () => {
    // October has 31 days; on the 12th there are 20 left, today included.
    const s = budgetStats(100_000, 300_000, oct(12));
    expect(s.daysLeft).toBe(20);
    expect(s.left).toBe(200_000);
    expect(s.safePerDay).toBe(10_000);
  });

  it('floors rather than rounding, so the day figure never oversells the budget', () => {
    // 200_001 / 20 = 10000.05
    expect(budgetStats(99_999, 300_000, oct(12)).safePerDay).toBe(10_000);
  });

  it('reports zero per day once the month is blown, not a negative one', () => {
    const s = budgetStats(350_000, 300_000, oct(12));
    expect(s.left).toBe(-50_000);
    expect(s.safePerDay).toBe(0);
  });

  it('handles the last day of the month', () => {
    expect(budgetStats(0, 300_000, oct(31)).daysLeft).toBe(1);
    expect(budgetStats(0, 300_000, oct(31)).safePerDay).toBe(300_000);
  });

  it('keeps February short in a leap year', () => {
    const s = budgetStats(0, 100_000, new Date(2028, 1, 1, 12).getTime());
    expect(s.daysLeft).toBe(29);
  });

  it('gives a target of zero a zero per-day figure', () => {
    const s = budgetStats(12_345, 0, oct(12));
    expect(s.left).toBe(-12_345);
    expect(s.safePerDay).toBe(0);
  });
});