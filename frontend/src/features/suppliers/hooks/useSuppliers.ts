import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { suppliersService, type SupplierInput, type SupplierQuery } from '@/services/suppliers';
import { queryKeys } from '@/services/queryKeys';

export function useSuppliers(query?: SupplierQuery) {
  return useQuery({
    queryKey: queryKeys.suppliers.list(query ?? null),
    queryFn: () => suppliersService.list(query),
  });
}

export function useSupplierOptions() {
  return useQuery({
    queryKey: queryKeys.suppliers.options,
    queryFn: () => suppliersService.getOptions(),
  });
}

function useInvalidateSuppliers() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: queryKeys.suppliers.all });
    void qc.invalidateQueries({ queryKey: queryKeys.purchasing.all });
  };
}

export function useCreateSupplier() {
  const invalidate = useInvalidateSuppliers();
  return useMutation({
    mutationFn: (input: SupplierInput) => suppliersService.create(input),
    onSuccess: invalidate,
  });
}

export function useUpdateSupplier() {
  const invalidate = useInvalidateSuppliers();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: SupplierInput }) => suppliersService.update(id, input),
    onSuccess: invalidate,
  });
}

export function useRemoveSupplier() {
  const invalidate = useInvalidateSuppliers();
  return useMutation({
    mutationFn: (id: string) => suppliersService.remove(id),
    onSuccess: invalidate,
  });
}