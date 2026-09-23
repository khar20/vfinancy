import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { purchasingService, type ExtraCostInput, type PurchaseCreateInput } from '@/services/purchasing';
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

function useInvalidateExtraCosts() {
  const qc = useQueryClient();
  return (purchaseId: string) => {
    void qc.invalidateQueries({ queryKey: queryKeys.purchasing.extraCosts(purchaseId) });
    void qc.invalidateQueries({ queryKey: queryKeys.purchasing.extraCostConcepts });
    void qc.invalidateQueries({ queryKey: queryKeys.purchasing.all });
  };
}

export function usePurchaseExtraCosts(purchaseId: string) {
  return useQuery({
    queryKey: queryKeys.purchasing.extraCosts(purchaseId),
    queryFn: () => purchasingService.listExtraCosts(purchaseId),
    enabled: Boolean(purchaseId),
  });
}

export function useExtraCostConcepts() {
  return useQuery({
    queryKey: queryKeys.purchasing.extraCostConcepts,
    queryFn: () => purchasingService.listConcepts(),
    staleTime: 60 * 1000,
  });
}

// Save the cost row and refresh the local concept catalog so the
// autocomplete offers the concept with its latest amount and currency.
export function useSaveExtraCost(purchaseId: string) {
  const invalidate = useInvalidateExtraCosts();
  return useMutation({
    mutationFn: async ({ id, input }: { id?: string; input: ExtraCostInput }) => {
      const saved = id
        ? await purchasingService.updateExtraCost(purchaseId, id, input)
        : await purchasingService.addExtraCost(purchaseId, input);
      await purchasingService.saveConcept({ concept: input.concept, amount: input.amount, currency: input.currency });
      return saved;
    },
    onSuccess: () => invalidate(purchaseId),
  });
}

export function useDeleteExtraCost(purchaseId: string) {
  const invalidate = useInvalidateExtraCosts();
  return useMutation({
    mutationFn: (id: string) => purchasingService.deleteExtraCost(purchaseId, id),
    onSuccess: () => invalidate(purchaseId),
  });
}
