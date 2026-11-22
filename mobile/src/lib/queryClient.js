import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, err) => err?.status !== 401 && err?.status !== 404 && count < 2,
    },
  },
});
