import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { listBudgets, listExpenses, monthlyIncome, monthlyTotal, totalsByCategory, totalsByMonth, type Budget, type Expense } from '@/lib/db';
import type { Category } from '@/lib/categories';

export function useMonthData(monthMs: number) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [total, setTotal] = useState(0);
  const [income, setIncome] = useState(0);
  const [byCategory, setByCategory] = useState<{ category: Category; total: number; n: number }[]>([]);

  const reload = useCallback(async () => {
    setExpenses(await listExpenses(monthMs));
    setTotal(await monthlyTotal(monthMs));
    setIncome(await monthlyIncome(monthMs));
    setByCategory(await totalsByCategory(monthMs));
  }, [monthMs]);

  useFocusEffect(useCallback(() => { void reload(); }, [reload]));

  return { expenses, total, income, byCategory, reload };
}

export function useBudgets() {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const reload = useCallback(async () => setBudgets(await listBudgets()), []);
  useFocusEffect(useCallback(() => { void reload(); }, [reload]));
  return { budgets, reload };
}

/** Oldest-first list of the last `count` months that have any spending. */
export function useMonthlyTotals(count: number) {
  const [totals, setTotals] = useState<{ month: string; total: number }[]>([]);

  useFocusEffect(
    useCallback(() => {
      void totalsByMonth(count).then((rows) =>
        setTotals([...rows].reverse().filter((r) => r.total > 0))
      );
    }, [count])
  );

  return totals;
}