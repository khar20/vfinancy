import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { inventoryService } from '@/services/inventory';
import { queryKeys } from '@/services/queryKeys';
import type { ReceiveStockRequest } from '@/services/wails-types';

export function useInventory(query?: { search?: string; status?: string }) {
  return useQuery({
    queryKey: queryKeys.inventory.list(query ?? null),
    queryFn: () => inventoryService.list(query),
  });
}

function useInvalidateInventory() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: queryKeys.inventory.all });
    void qc.invalidateQueries({ queryKey: queryKeys.products.all });
  };
}

export function useReceiveStock() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: (input: ReceiveStockRequest) => inventoryService.receive(input),
    onSuccess: invalidate,
  });
}

export function useAdjustStock() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: ({ batchId, newQuantity, notes }: { batchId: string; newQuantity: number; notes: string }) =>
      inventoryService.adjust(batchId, newQuantity, notes),
    onSuccess: invalidate,
  });
}

export function useVoidStock() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: ({ batchId, reason }: { batchId: string; reason: string }) =>
      inventoryService.void(batchId, reason),
    onSuccess: invalidate,
  });
}
