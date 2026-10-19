import { budgetFieldText } from '@/lib/budget';

describe('budgetFieldText', () => {
  it('shows the stored limit in rupees', () => {
    expect(budgetFieldText(undefined, 400_000)).toBe('4000');
    expect(budgetFieldText(undefined, 100)).toBe('1');
  });

  it('shows nothing for a category with no limit', () => {
    expect(budgetFieldText(undefined, 0)).toBe('');
  });

  it('prefers the draft over the stored limit while the field is being edited', () => {
    expect(budgetFieldText('5000', 400_000)).toBe('5000');
  });

  it('keeps an emptied draft empty rather than falling back to the stored limit', () => {
    // The user cleared the field on purpose. Falling back would put the old number back
    // under their cursor, and the blur would then save that number instead of the clear.
    expect(budgetFieldText('', 400_000)).toBe('');
  });
});
