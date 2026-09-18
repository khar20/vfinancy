import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { purchasingService, type PurchaseCreateInput } from '@/services/purchasing';
import { queryKeys } from '@/services/queryKeys';

interface PurchaseFilters {
  search?: string;
  status?: string;
  creditCardId?: string;
  from?: string;
  to?: string;
}

export function usePurchases(filters: PurchaseFilters = {}) {
  return useQuery({
    queryKey: queryKeys.purchasing.list(filters),
    queryFn: () => purchasingService.list(filters),
  });
}

export function useCreatePurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PurchaseCreateInput) => purchasingService.create(input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.purchasing.all }),
  });
}

export function useCancelPurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => purchasingService.cancel(id, reason),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.purchasing.all }),
  });
}

export function useMarkPurchaseReceived() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, receivedDate }: { id: string; receivedDate: string }) =>
      purchasingService.markReceived(id, receivedDate),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.purchasing.all }),
  });
}

export function useMarkPurchaseFaulty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => purchasingService.markFaulty(id, reason),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.purchasing.all }),
  });
}

export function useUpdatePurchaseNumber() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, number }: { id: string; number: string }) => purchasingService.updateNumber(id, number),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.purchasing.all }),
  });
}
