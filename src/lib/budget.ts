/**
 * The text a budget field shows for one category.
 *
 * The field is controlled, so this is the only thing that decides what is on screen:
 * the draft the user is typing, or the stored limit, or nothing for a category that
 * has no limit yet.
 */
export function budgetFieldText(draft: string | undefined, budgetPaise: number): string {
  if (draft !== undefined) return draft;
  if (budgetPaise <= 0) return '';
  return String(budgetPaise / 100);
}
