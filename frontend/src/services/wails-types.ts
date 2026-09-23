export interface PaginationRequest {
  page: number;
  pageSize: number;
}

export interface PageResult<T = unknown> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type LocalAuthState = {
  configured: boolean;
  passwordEnabled: boolean;
  unlocked: boolean;
};

export type LocalProfile = {
  id: string;
  name: string;
  commercialName: string;
  taxId: string;
  email: string;
  fiscalAddress: string;
  phone: string;
  website: string;
  securityQuestion: string;
  passwordEnabled: boolean;
};

export interface SetupWorkspaceRequest {
  id?: string;
  name: string;
  commercialName?: string;
  taxId?: string;
  email?: string;
  fiscalAddress?: string;
  phone?: string;
  website?: string;
  password: string;
}

export interface UpdateLocalProfileRequest {
  name: string;
  commercialName?: string;
  taxId?: string;
  email?: string;
  fiscalAddress?: string;
  phone?: string;
  website?: string;
}

export interface SetSecurityQuestionRequest {
  question: string;
  answer: string;
}

export interface RecoverWithAnswerRequest {
  answer: string;
  newPassword: string;
}

export interface SetLocalPasswordRequest {
  current: string;
  next: string;
}

export interface Preferences {
  clearanceDays: number;
  clearanceWarningDays: number;
  importCostFactor: number;
  fallbackExchangeRate: number;
  purchaseLimitUSD: number;
  backupFolder: string;
  backupFrequency: string;
}

export interface SyncConfig {
  enabled: boolean;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  sslMode: string;
  pollIntervalSec: number;
}

export interface BackupResult {
  path: string;
  fallbackUsed: boolean;
  warning: string;
}

export interface CustomerDTO {
  id: string;
  documentType: string;
  documentNumber: string;
  businessName: string;
  email: string;
  phone: string;
  address: string;
  currentDebt: number;
  status: string;
}

export interface SaveCustomerRequest {
  id?: string;
  businessName: string;
  documentType: '' | 'DNI' | 'RUC';
  documentNumber: string;
  email: string;
  phone: string;
  address: string;
}

export interface SupplierDTO {
  id: string;
  name: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  isActive: boolean;
}

export interface SaveSupplierRequest {
  id?: string;
  name: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  status: string;
}

export interface ProductDTO {
  id: string;
  sku: string;
  description: string;
  unitCode: string;
  costUsd: number;
  salePrice: number;
  isActive: boolean;
}

export interface SaveProductRequest {
  id?: string;
  sku?: string;
  description: string;
  unitCode: string;
  costUsd: number;
  salePrice: number;
}

export interface InventoryBatchDTO {
  id: string;
  productId: string;
  productDescription: string;
  purchaseOrderItemId: string;
  arrivalDate: string;
  quantity: number;
  originalQuantity: number;
  unitCost: number;
  status: string;
  isClearance: boolean;
  maxSaleDate: string;
}

export interface InventoryMovementDTO {
  id: string;
  batchId: string;
  productId: string;
  movementDate: string;
  type: string;
  quantity: number;
  balanceAfter: number;
  unitCost: number;
  notes: string;
}

export interface ReceiveStockRequest {
  productId: string;
  quantity: number;
  arrivalDate: string;
  unitCost: number;
}

export interface AdjustStockRequest {
  batchId: string;
  newQuantity: number;
  notes: string;
}

export interface VoidStockRequest {
  batchId: string;
  reason: string;
}

export interface SaleItemDTO {
  id: string;
  productId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  costSnapshot: number;
}

export interface SaleDTO {
  id: string;
  customerId: string;
  number: string;
  saleDate: string;
  dueDate: string;
  status: string;
  saleType: string;
  total: number;
  paidAmount: number;
  costTotal: number;
  profit: number;
  notes: string;
  cancelledAt: string;
  cancelledReason: string;
  items: SaleItemDTO[];
}

export interface ListSalesRequest extends PaginationRequest {
  search: string;
  status: string;
  saleType: string;
  customerId: string;
  from: string;
  to: string;
  onlyUnpaid: boolean;
}

export interface SaleLineRequest {
  productId: string;
  quantity: number;
  unitPrice: number;
}

export interface CreateSaleRequest {
  customerId: string;
  saleType: 'stock' | 'client_order';
  date: string;
  dueDate: string;
  paymentMethod: 'cash' | 'transfer' | 'other';
  notes: string;
  initialPayment: number;
  items: SaleLineRequest[];
}

export interface CancelSaleRequest {
  id: string;
  reason: string;
}

export interface SalePaymentRequest {
  saleId: string;
  amount: number;
  paymentMethod: 'cash' | 'transfer' | 'other';
  reference: string;
  date: string;
}

export interface CustomerPaymentDTO {
  id: string;
  customerId: string;
  number: string;
  paymentDate: string;
  amount: number;
  paymentMethod: string;
  reference: string;
  status: string;
}

export interface SaleCollectionDTO {
  saleId: string;
  paymentDate: string;
  amount: number;
}

export interface PurchaseItemDTO {
  id: string;
  productId: string;
  lineNumber: number;
  description: string;
  unitCode: string;
  quantity: number;
  quantityReceived: number;
  unitCostUsd: number;
  lineTotalUsd: number;
  salePricePen: number;
}

export interface PurchaseOrderDTO {
  id: string;
  number: string;
  orderDate: string;
  expectedDate: string;
  receivedDate: string;
  arrivalDate: string;
  status: 'pending' | 'received' | 'cancelled';
  currencyCode: string;
  paymentMethod: 'card' | 'cash' | 'digital_wallet';
  exchangeRate: number;
  notes: string;
  customerId: string;
  supplierId: string;
  supplierName: string;
  productsText: string;
  creditCardId: string;
  costUsd: number;
  salePricePen: number;
  realCostPen: number;
  refundAmount: number;
  faulty: boolean;
  faultyReason: string;
  cancelledAt: string;
  cancelledReason: string;
  items: PurchaseItemDTO[];
}

export interface PurchaseFilterRequest extends PaginationRequest {
  search: string;
  status: string;
  creditCardId: string;
  from: string;
  to: string;
}

export interface PurchaseItemRequest {
  productId: string;
  description: string;
  quantity: number;
  unitCostUsd: number;
  salePricePen: number;
}

export interface CreatePurchaseRequest {
  number?: string;
  customerId: string;
  supplierId: string;
  paymentMethod: 'card' | 'cash' | 'digital_wallet';
  creditCardId: string;
  exchangeRate: number;
  orderDate: string;
  expectedDate: string;
  notes: string;
  items: PurchaseItemRequest[];
}

export interface CancelPurchaseRequest {
  id: string;
  reason: string;
}

export interface ExtraCostDTO {
  id: string;
  purchaseOrderId: string;
  concept: string;
  amount: number;
  currencyCode: string;
  exchangeRate: number;
}

export interface ExtraCostRequest {
  concept: string;
  amount: number;
  currencyCode: string;
  exchangeRate: number;
}

export interface ExtraCostConcept {
  concept: string;
  amount: number;
  currency: string;
}

export interface CreditCardDTO {
  id: string;
  issuer: string;
  lastFour: string;
  creditLimit: number;
  currentBalance: number;
  cutOffDay: number;
  paymentDueDay: number;
  isActive: boolean;
}

export interface SaveCreditCardRequest {
  id?: string;
  issuer: string;
  lastFour: string;
  creditLimit: number;
  cutOffDay: number;
  paymentDueDay: number;
}

export interface CardPaymentRequest {
  cardId: string;
  amount: number;
}

export interface CardProjectionDTO {
  cardId: string;
  issuer: string;
  lastFour: string;
  cycleStart: string;
  cycleEnd: string;
  paymentDue: string;
  totalUsd: number;
  refundsUsd: number;
  status: string;
  currentBalance: number;
}

export interface ExchangeRateDTO {
  rate: number;
  source: string;
  isFallback: boolean;
}

export interface ShipmentDTO {
  id: string;
  code: string;
  saleId: string;
  customerId: string;
  description: string;
  notes: string;
  status: 'pending' | 'shipped' | 'delivered';
  createdAt: string;
  updatedAt: string;
}

export interface SaveShipmentRequest {
  id?: string;
  saleId: string;
  customerId: string;
  description: string;
  notes: string;
  status: string;
}

export interface AppBindings {
  GetLocalAuthState(): Promise<LocalAuthState>;
  GetLocalProfile(): Promise<LocalProfile>;
  UpdateLocalProfile(req: UpdateLocalProfileRequest): Promise<LocalProfile>;
  SetupWorkspace(req: SetupWorkspaceRequest): Promise<LocalProfile>;
  UnlockLocalProfile(password: string): Promise<LocalProfile>;
  GetSecurityQuestion(): Promise<string>;
  SetSecurityQuestion(req: SetSecurityQuestionRequest): Promise<void>;
  ClearSecurityQuestion(): Promise<void>;
  RecoverWithAnswer(req: RecoverWithAnswerRequest): Promise<LocalProfile>;
  SetLocalPassword(req: SetLocalPasswordRequest): Promise<void>;
  RemoveLocalPassword(current: string): Promise<void>;
  LockLocalProfile(): Promise<void>;

  GetPreferences(): Promise<Preferences>;
  UpdatePreference(key: string, value: number | string): Promise<Preferences>;

  GetSyncConfig(): Promise<SyncConfig>;
  SaveSyncConfig(cfg: SyncConfig): Promise<void>;
  TestSyncConnection(cfg: SyncConfig): Promise<void>;
  SyncNow(): Promise<void>;

  ChooseBackupFolder(): Promise<string>;
  SetBackupFolder(folder: string): Promise<void>;
  SetBackupFrequency(frequency: string): Promise<void>;
  CreateBackup(): Promise<BackupResult>;

  ListCustomers(req: PaginationRequest, search: string): Promise<PageResult<CustomerDTO>>;
  CustomerOptions(): Promise<CustomerDTO[]>;
  CreateCustomer(req: SaveCustomerRequest): Promise<CustomerDTO>;
  UpdateCustomer(req: SaveCustomerRequest): Promise<CustomerDTO>;
  RemoveCustomer(id: string): Promise<void>;
  GetCustomerByDocument(docType: string, docNumber: string): Promise<CustomerDTO>;

  ListSuppliers(req: PaginationRequest, search: string): Promise<PageResult<SupplierDTO>>;
  SupplierOptions(): Promise<SupplierDTO[]>;
  CreateSupplier(req: SaveSupplierRequest): Promise<SupplierDTO>;
  UpdateSupplier(req: SaveSupplierRequest): Promise<SupplierDTO>;
  RemoveSupplier(id: string): Promise<void>;

  ListProducts(req: PaginationRequest, search: string): Promise<PageResult<ProductDTO>>;
  ProductOptions(): Promise<ProductDTO[]>;
  GetProduct(id: string): Promise<ProductDTO>;
  CreateProduct(req: SaveProductRequest): Promise<ProductDTO>;
  UpdateProduct(req: SaveProductRequest): Promise<ProductDTO>;
  RemoveProduct(id: string): Promise<void>;
  SetProductActive(id: string, active: boolean): Promise<void>;
  GetProductStock(id: string): Promise<number>;

  ListInventoryBatches(req: PaginationRequest, status: string, search: string): Promise<PageResult<InventoryBatchDTO>>;
  ListInventoryMovements(req: PaginationRequest, productId: string): Promise<PageResult<InventoryMovementDTO>>;
  ReceiveStock(req: ReceiveStockRequest): Promise<InventoryBatchDTO>;
  AdjustStock(req: AdjustStockRequest): Promise<void>;
  VoidStock(req: VoidStockRequest): Promise<void>;
  ListClearanceProducts(): Promise<InventoryBatchDTO[]>;

  ListSales(req: ListSalesRequest): Promise<PageResult<SaleDTO>>;
  GetSale(id: string): Promise<SaleDTO>;
  CreateSale(req: CreateSaleRequest): Promise<SaleDTO>;
  CancelSale(req: CancelSaleRequest): Promise<SaleDTO>;
  RegisterSalePayment(req: SalePaymentRequest): Promise<SaleDTO>;
  ListSalePayments(req: PaginationRequest, customerId: string, saleId: string): Promise<PageResult<CustomerPaymentDTO>>;
  ListSaleCollections(from: string, to: string): Promise<SaleCollectionDTO[]>;

  ListPurchaseOrders(req: PurchaseFilterRequest): Promise<PageResult<PurchaseOrderDTO>>;
  GetPurchaseOrder(id: string): Promise<PurchaseOrderDTO>;
  CreatePurchase(req: CreatePurchaseRequest): Promise<PurchaseOrderDTO>;
  MarkPurchaseReceived(id: string, receivedDate: string): Promise<void>;
  CancelPurchase(req: CancelPurchaseRequest): Promise<PurchaseOrderDTO>;
  MarkPurchaseFaulty(req: CancelPurchaseRequest): Promise<PurchaseOrderDTO>;
  UpdatePurchaseNumber(id: string, number: string): Promise<PurchaseOrderDTO>;
  ListPurchaseExtraCosts(purchaseId: string): Promise<ExtraCostDTO[]>;
  AddPurchaseExtraCost(purchaseId: string, req: ExtraCostRequest): Promise<ExtraCostDTO>;
  UpdatePurchaseExtraCost(purchaseId: string, costId: string, req: ExtraCostRequest): Promise<ExtraCostDTO>;
  DeletePurchaseExtraCost(purchaseId: string, costId: string): Promise<void>;
  GetExtraCostConcepts(): Promise<ExtraCostConcept[]>;
  SaveExtraCostConcept(concept: ExtraCostConcept): Promise<void>;

  ListCreditCards(): Promise<CreditCardDTO[]>;
  IssueCreditCard(req: SaveCreditCardRequest): Promise<CreditCardDTO>;
  UpdateCreditCard(req: SaveCreditCardRequest): Promise<CreditCardDTO>;
  DeleteCreditCard(id: string): Promise<void>;
  PayCreditCard(req: CardPaymentRequest): Promise<CreditCardDTO>;
  GetCardProjections(): Promise<CardProjectionDTO[]>;
  LatestExchangeRate(): Promise<ExchangeRateDTO>;

  ListShipments(req: PaginationRequest, search: string, status: string): Promise<PageResult<ShipmentDTO>>;
  GetShipment(id: string): Promise<ShipmentDTO>;
  CreateShipment(req: SaveShipmentRequest): Promise<ShipmentDTO>;
  UpdateShipment(req: SaveShipmentRequest): Promise<ShipmentDTO>;
  DeleteShipment(id: string): Promise<void>;
}
