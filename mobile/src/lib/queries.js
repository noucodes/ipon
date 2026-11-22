// Data hooks (TanStack Query). After any change we invalidate everything money-related,
// since one transaction moves balances, the summary and history at once.
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { get, post, patch, del, qs } from './api';
import { queryClient } from './queryClient';

export const refreshMoney = () =>
  Promise.all(['summary', 'accounts', 'transactions', 'transaction', 'recurring', 'categories', 'feeSuggest']
    .map((k) => queryClient.invalidateQueries({ queryKey: [k] })));

export const useSummary = () =>
  useQuery({ queryKey: ['summary'], queryFn: () => get('/summary') });

export const useNetWorthHistory = (months = 6) =>
  useQuery({ queryKey: ['summary', 'history', months], queryFn: () => get(`/summary/net-worth${qs({ months })}`), select: (d) => d.points });

export const useAccounts =({ includeArchived = false } = {}) =>
  useQuery({
    queryKey: ['accounts', includeArchived],
    queryFn: () => get(`/accounts${qs({ include_archived: includeArchived || undefined })}`),
    select: (d) => d.accounts,
  });

export const useAccount = (id) =>
  useQuery({ queryKey: ['accounts', 'one', id], queryFn: () => get(`/accounts/${id}`), select: (d) => d.account, enabled: !!id });

export const useCategories = () =>
  useQuery({ queryKey: ['categories'], queryFn: () => get('/categories'), select: (d) => d.categories, staleTime: 5 * 60_000 });

export const useFeePresets = () =>
  useQuery({ queryKey: ['feePresets'], queryFn: () => get('/fee-presets'), select: (d) => d.presets, staleTime: 5 * 60_000 });

export const useFeeSuggestion = (from, to) =>
  useQuery({
    queryKey: ['feeSuggest', from, to],
    queryFn: () => get(`/fee-presets/suggest${qs({ from, to })}`),
    select: (d) => d.suggestion,
    enabled: Boolean(from && to && from !== to),
  });

export const useTransaction = (id) =>
  useQuery({ queryKey: ['transaction', id], queryFn: () => get(`/transactions/${id}`), select: (d) => d.transaction, enabled: !!id });

const PAGE = 40;
export const useTransactions = (filters = {}, { enabled = true } = {}) =>
  useInfiniteQuery({
    queryKey: ['transactions', filters],
    enabled,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => get(`/transactions${qs({ ...filters, limit: PAGE, offset: pageParam })}`),
    getNextPageParam: (last, pages) => (last.has_more ? pages.length * PAGE : undefined),
  });

export const useRecurring = () =>
  useQuery({ queryKey: ['recurring'], queryFn: () => get('/recurring'), select: (d) => d.items });

export const useHousehold = () => useQuery({ queryKey: ['household'], queryFn: () => get('/household') });

export const useInvites = (enabled) =>
  useQuery({ queryKey: ['invites'], queryFn: () => get('/household/invites'), select: (d) => d.invites, enabled });

/** Generic mutation that refreshes money data afterwards. */
export function useMoneyMutation(fn, { extraKeys = [] } = {}) {
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await refreshMoney();
      await Promise.all(extraKeys.map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
    },
  });
}

export const api = { get, post, patch, del };
