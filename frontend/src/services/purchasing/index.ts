import type {
  CreatePurchaseRequest,
  ExtraCostConcept,
  ExtraCostDTO,
  ExtraCostRequest,
  PurchaseItemRequest,
  PurchaseOrderDTO,
} from '../wails-types';
import { wailsClient } from '../bindings';
import { fetchAllPages } from '../paginate';

export interface PurchaseLineInput {
  productId: string;
  quantity: number;
  unitPrice: number;
  salePricePen?: number;
  description: string;
}

interface PurchaseQuery {
  search?: string;
  status?: string;
  creditCardId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface Purchase extends PurchaseOrderDTO {
  date: string;
}

function toPurchase(dto: PurchaseOrderDTO): Purchase {
  return { ...dto, date: dto.orderDate };
}

function toItems(items: PurchaseLineInput[]): PurchaseItemRequest[] {
  return items.map((it) => ({
    productId: it.productId,
    description: it.description,
    quantity: it.quantity,
    unitCostUsd: it.unitPrice,
    salePricePen: it.salePricePen ?? 0,
  }));
}

export interface PurchaseCreateInput {
  number?: string;
  customerId?: string;
  supplierId: string;
  paymentMethod: 'card' | 'cash' | 'digital_wallet';
  creditCardId: string;
  orderDate: string;
  expectedDate?: string;
  exchangeRate?: number;
  notes?: string;
  items: PurchaseLineInput[];
}

export type ExtraCost = ExtraCostDTO;

export interface ExtraCostInput {
  concept: string;
  amount: number;
  currency: string;
  exchangeRate?: number;
}

function toExtraCostRequest(input: ExtraCostInput): ExtraCostRequest {
  return {
    concept: input.concept,
    amount: input.amount,
    currencyCode: input.currency,
    exchangeRate: input.exchangeRate ?? 0,
  };
}

export const purchasingService = {
  async list(q: PurchaseQuery = {}): Promise<Purchase[]> {
    const items = await fetchAllPages((page, pageSize) =>
      wailsClient.listPurchaseOrders({
        page,
        pageSize,
        search: q.search ?? '',
        status: q.status ?? '',
        creditCardId: q.creditCardId ?? '',
        from: q.from ?? '',
        to: q.to ?? '',
      }),
    );
    return (items as PurchaseOrderDTO[]).map(toPurchase);
  },

  async get(id: string): Promise<Purchase> {
    return toPurchase(await wailsClient.getPurchaseOrder(id));
  },

  async create(input: PurchaseCreateInput): Promise<Purchase> {
    const req: CreatePurchaseRequest = {
      number: input.number ?? '',
      customerId: input.customerId ?? '',
      supplierId: input.supplierId,
      paymentMethod: input.paymentMethod,
      creditCardId: input.creditCardId,
      exchangeRate: input.exchangeRate ?? 1,
      orderDate: input.orderDate,
      expectedDate: input.expectedDate ?? '',
      notes: input.notes ?? '',
      items: toItems(input.items),
    };
    const dto = await wailsClient.createPurchase(req);
    return toPurchase(dto);
  },

  async cancel(id: string, reason: string): Promise<Purchase> {
    return toPurchase(await wailsClient.cancelPurchase({ id, reason }));
  },

  async markReceived(id: string, receivedDate: string): Promise<void> {
    await wailsClient.markPurchaseReceived(id, receivedDate);
  },

  async markFaulty(id: string, reason: string): Promise<Purchase> {
    return toPurchase(await wailsClient.markPurchaseFaulty({ id, reason }));
  },

  async updateNumber(id: string, number: string): Promise<Purchase> {
    return toPurchase(await wailsClient.updatePurchaseNumber(id, number));
  },

  async listExtraCosts(purchaseId: string): Promise<ExtraCost[]> {
    return wailsClient.listPurchaseExtraCosts(purchaseId);
  },

  async addExtraCost(purchaseId: string, input: ExtraCostInput): Promise<ExtraCost> {
    return wailsClient.addPurchaseExtraCost(purchaseId, toExtraCostRequest(input));
  },

  async updateExtraCost(purchaseId: string, costId: string, input: ExtraCostInput): Promise<ExtraCost> {
    return wailsClient.updatePurchaseExtraCost(purchaseId, costId, toExtraCostRequest(input));
  },

  async deleteExtraCost(purchaseId: string, costId: string): Promise<void> {
    await wailsClient.deletePurchaseExtraCost(purchaseId, costId);
  },

  async listConcepts(): Promise<ExtraCostConcept[]> {
    return wailsClient.getExtraCostConcepts();
  },

  async saveConcept(c: ExtraCostConcept): Promise<void> {
    await wailsClient.saveExtraCostConcept(c);
  },
};
