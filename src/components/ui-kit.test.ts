import { tint } from '@/components/ui-kit';

describe('tint', () => {
  it('unpacks hex into rgba at the requested alpha', () => {
    expect(tint('#F97316', 0.14)).toBe('rgba(249, 115, 22, 0.14)');
    expect(tint('#000000', 0)).toBe('rgba(0, 0, 0, 0)');
  });

  it('keeps channels that a naive >> would shift wrong', () => {
    // 0x22BB44: green must not bleed into red, blue must not underflow.
    expect(tint('#22BB44', 1)).toBe('rgba(34, 187, 68, 1)');
  });
});