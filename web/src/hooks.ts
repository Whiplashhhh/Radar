import { useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api, type ItemCard, type Settings } from './api';
import { setBadge } from './lib/push';

export function useStats() {
  const q = useQuery({ queryKey: ['stats'], queryFn: api.stats, refetchInterval: 60_000, staleTime: 15_000 });
  const n = q.data?.unread.priority;
  useEffect(() => {
    if (n != null) setBadge(n);
  }, [n]);
  return q;
}

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: api.settings, staleTime: 60_000 });
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: unknown) => api.putSettings(patch),
    onSuccess: (s: Settings) => {
      qc.setQueryData(['settings'], s);
      void qc.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}

type ItemsPage = { items: ItemCard[]; nextCursor: string | null };

/** Met à jour un item dans toutes les listes en cache (mise à jour optimiste). */
function patchCached(qc: ReturnType<typeof useQueryClient>, id: number, patch: Partial<ItemCard>) {
  qc.setQueriesData<InfiniteData<ItemsPage>>({ queryKey: ['items'] }, (data) =>
    data ? { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) })) } : data,
  );
}

export function useItemActions() {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: { read?: boolean; starred?: boolean } }) => api.patchItem(id, patch),
    onMutate: ({ id, patch }) => patchCached(qc, id, patch),
    onError: (_e, { id, patch }) => patchCached(qc, id, { ...(patch.read !== undefined ? { read: !patch.read } : {}), ...(patch.starred !== undefined ? { starred: !patch.starred } : {}) }),
    onSettled: (_d, _e, { id }) => {
      void qc.invalidateQueries({ queryKey: ['stats'] });
      void qc.invalidateQueries({ queryKey: ['item', id] });
      void qc.invalidateQueries({ queryKey: ['vuln'] });
    },
  });
  return {
    setRead: (id: number, read: boolean) => m.mutate({ id, patch: { read } }),
    setStarred: (id: number, starred: boolean) => m.mutate({ id, patch: { starred } }),
  };
}
