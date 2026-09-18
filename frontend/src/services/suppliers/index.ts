import type { SaveSupplierRequest, SupplierDTO } from '../wails-types';
import { wailsClient } from '../bindings';
import { fetchAllPages } from '../paginate';

export interface SupplierQuery {
  search?: string;
  page?: number;
  pageSize?: number;
}

export type SupplierInput = Omit<SaveSupplierRequest, 'id'>;

export const suppliersService = {
  async list(q: SupplierQuery = {}): Promise<{ items: SupplierDTO[]; total: number }> {
    const items = await fetchAllPages((page, pageSize) =>
      wailsClient.listSuppliers({ page, pageSize }, q.search ?? ''),
    );
    return { items, total: items.length };
  },

  async getOptions(): Promise<SupplierDTO[]> {
    return wailsClient.supplierOptions();
  },

  async create(input: SupplierInput): Promise<SupplierDTO> {
    return wailsClient.createSupplier(input);
  },

  async update(id: string, input: SupplierInput): Promise<SupplierDTO> {
    return wailsClient.updateSupplier({ ...input, id });
  },

  async remove(id: string): Promise<void> {
    await wailsClient.removeSupplier(id);
  },
};