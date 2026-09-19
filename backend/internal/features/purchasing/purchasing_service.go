// Package purchasing implements the business logic for the purchase
// workflow: order creation (with automatic card charge), receipt into
// inventory, cancellation with card-charge release and cycle-settled
// refunds, and the landed-cost factor applied to every order.
package purchasing

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"vfinancy/backend/infrastructure/logger"
	"vfinancy/backend/internal/domain/enums"
	derrors "vfinancy/backend/internal/domain/errors"
	"vfinancy/backend/internal/domain/repositories"
	"vfinancy/backend/internal/domain/valueobjects"
	"vfinancy/backend/internal/features/inventory"
	"vfinancy/backend/internal/features/product"
	"vfinancy/backend/internal/features/supplier"
	"vfinancy/backend/internal/shared/apperrors"
)

// defaultImportFactor is the additive USD surcharge (customs, freight,
// logistics) applied to every order when no provider is configured.
const defaultImportFactor = 0.07

// cardCharger is the narrow treasury contract consumed by the purchase
// slice. It is satisfied by *treasury.TreasuryService.
type cardCharger interface {
	ChargeCard(ctx context.Context, cardID uuid.UUID, amount valueobjects.Money) error
	ReleaseCardCharge(ctx context.Context, cardID uuid.UUID, amount valueobjects.Money) error
	CurrentCycleStart(ctx context.Context, cardID uuid.UUID) (time.Time, error)
}

// productCreator creates (or finds) products from a line description.
type productCreator interface {
	GetOrCreate(ctx context.Context, in product.CreateInput) (*product.Product, error)
}

// productGetter loads an existing product by id.
type productGetter interface {
	GetByID(ctx context.Context, id uuid.UUID) (*product.Product, error)
}

// stockReceiver is the narrow inventory contract consumed by the
// purchase slice. It is satisfied by *inventory.InventoryService.
type stockReceiver interface {
	ReceiveFromPurchase(ctx context.Context, in inventory.ReceiveFromPurchaseInput) (*inventory.InventoryBatch, error)
	VoidPurchaseReceipt(ctx context.Context, purchaseLineIDs []uuid.UUID) error
}

// supplierGetter loads an existing supplier by id.
type supplierGetter interface {
	GetByID(ctx context.Context, id uuid.UUID) (*supplier.Supplier, error)
}

// PurchasingService owns the purchase slice.
type PurchasingService struct {
	orders       PurchaseRepository
	stock        stockReceiver
	products     productCreator
	productByID  productGetter
	cards        cardCharger
	suppliers    supplierGetter
	txm          repositories.TransactionManager
	log          *logger.Logger
	importFactor func(context.Context) float64
}

// New returns a PurchasingService ready for use. The inventory
// service is taken through the narrow stockReceiver interface;
// *inventory.InventoryService satisfies it.
func New(repo PurchaseRepository, inventorySvc stockReceiver, txm repositories.TransactionManager, log *logger.Logger) *PurchasingService {
	return &PurchasingService{
		orders: repo,
		stock:  inventorySvc,
		txm:    txm,
		log:    log,
	}
}

// SetProducts injects the product service used to auto-create products
// from line descriptions and to resolve existing ones.
func (s *PurchasingService) SetProducts(creator productCreator, getter productGetter) {
	s.products = creator
	s.productByID = getter
}

// SetTreasury injects the treasury service used to charge and release
// credit-card charges.
func (s *PurchasingService) SetTreasury(cards cardCharger) {
	s.cards = cards
}

// SetSuppliers injects the supplier service used to validate the
// supplier of a manual order.
func (s *PurchasingService) SetSuppliers(suppliers supplierGetter) {
	s.suppliers = suppliers
}

// SetImportFactor injects a provider for the additive USD factor
// (customs, freight, logistics) per order. When unset, the package
// default importFactor is used.
func (s *PurchasingService) SetImportFactor(fn func(context.Context) float64) {
	s.importFactor = fn
}

// factor returns the active import factor.
func (s *PurchasingService) factor(ctx context.Context) float64 {
	if s.importFactor != nil {
		if f := s.importFactor(ctx); f > 0 {
			return f
		}
	}
	return defaultImportFactor
}

// realCostPEN computes the landed cost in PEN for an order bought in
// USD: (cost_usd + factor) * exchange_rate.
func (s *PurchasingService) realCostPEN(ctx context.Context, costUSD valueobjects.Money, rate valueobjects.ExchangeRate) valueobjects.Money {
	m, _ := valueobjects.MoneyFromDecimal(
		costUSD.Decimal().Add(decimal.NewFromFloat(s.factor(ctx))).Mul(rate.Decimal()),
	)
	return m
}

// CreateItemInput is one line of a new purchase order. When ProductID
// is nil the product is auto-created from the description.
type CreateItemInput struct {
	ProductID    *uuid.UUID
	Description  string
	Quantity     valueobjects.Quantity
	UnitCostUSD  valueobjects.Money
	SalePricePen valueobjects.Money
}

// CreateInput is the payload for Create. Every order is recorded in
// USD and paid with the given credit card. A non-empty Number sets the
// order number (fixed, like every generated one, it is only editable
// through UpdateNumber); an empty Number auto-generates the next
// sequence. Manual orders require a supplier; client orders set none.
type CreateInput struct {
	Number        string
	CustomerID    *uuid.UUID
	SupplierID    *uuid.UUID
	PaymentMethod PurchasePaymentMethod
	CreditCardID  *uuid.UUID
	ExchangeRate  valueobjects.ExchangeRate
	OrderDate     time.Time
	ExpectedDate  *time.Time
	Notes         string
	Items         []CreateItemInput
}

// Create validates the input, resolves the line products, and persists
// the order with its items — all in one transaction. CostUSD is the sum
// of the line totals, RealCostPen is (CostUSD + import factor) * rate,
// and, when paid by credit card, the full order cost is charged to it.
func (s *PurchasingService) Create(ctx context.Context, in CreateInput) (*PurchaseOrder, error) {
	if len(in.Items) == 0 {
		return nil, apperrors.Errorf(apperrors.ErrValidation, "purchase order must have at least one item")
	}
	if in.PaymentMethod == "" {
		in.PaymentMethod = DefaultPaymentMethod
	}
	if !in.PaymentMethod.Valid() {
		return nil, apperrors.Errorf(apperrors.ErrValidation, "payment method is invalid")
	}
	if in.PaymentMethod == PaymentCard && (in.CreditCardID == nil || *in.CreditCardID == uuid.Nil) {
		return nil, apperrors.Errorf(apperrors.ErrValidation, "credit card is required")
	}
	if in.CustomerID != nil && *in.CustomerID == uuid.Nil {
		return nil, apperrors.Errorf(apperrors.ErrValidation, "customer id is invalid")
	}
	if in.SupplierID == nil || *in.SupplierID == uuid.Nil {
		return nil, apperrors.Errorf(apperrors.ErrValidation, "supplier is required")
	}
	if !in.ExchangeRate.Decimal().IsPositive() {
		return nil, apperrors.Errorf(apperrors.ErrValidation, "exchange rate must be positive")
	}
	for _, it := range in.Items {
		if !it.Quantity.IsPositive() {
			return nil, apperrors.Errorf(apperrors.ErrValidation, "quantity must be greater than zero")
		}
		if it.UnitCostUSD.IsNegative() {
			return nil, apperrors.Errorf(apperrors.ErrValidation, "unit cost cannot be negative")
		}
		if it.ProductID == nil && it.Description == "" {
			return nil, apperrors.Errorf(apperrors.ErrValidation, "description is required for new products")
		}
	}
	if s.cards == nil {
		return nil, derrors.New("INTERNAL", "treasury is not configured")
	}
	orderDate := in.OrderDate
	if orderDate.IsZero() {
		orderDate = time.Now().UTC()
	}

	var out *PurchaseOrder
	err := s.txm.WithinTransaction(ctx, func(ctx context.Context) error {
		if s.suppliers != nil {
			sup, err := s.suppliers.GetByID(ctx, *in.SupplierID)
			if err != nil {
				return err
			}
			if !sup.IsActive {
				return apperrors.Errorf(apperrors.ErrConflict, "el proveedor está inactivo")
			}
		}
		items := make([]*PurchaseOrderItem, 0, len(in.Items))
		costUSD := valueobjects.Zero()
		salePen := valueobjects.Zero()
		for i, it := range in.Items {
			productID := it.ProductID
			description := it.Description
			if productID == nil {
				if s.products == nil {
					return derrors.New("INTERNAL", "products are not configured")
				}
				prod, err := s.products.GetOrCreate(ctx, product.CreateInput{
					Description: it.Description,
					CostUSD:     it.UnitCostUSD,
					SalePrice:   it.SalePricePen,
				})
				if err != nil {
					return err
				}
				id := prod.ID
				productID = &id
			} else if description == "" {
				if s.productByID == nil {
					return derrors.New("INTERNAL", "products are not configured")
				}
				prod, err := s.productByID.GetByID(ctx, *productID)
				if err != nil {
					return err
				}
				description = prod.Description
			}
			li, err := NewPurchaseOrderItem(PurchaseOrderItemOptions{
				LineNumber:   i + 1,
				ProductID:    productID,
				Description:  description,
				Quantity:     it.Quantity,
				UnitCostUSD:  it.UnitCostUSD,
				SalePricePen: it.SalePricePen,
			})
			if err != nil {
				return err
			}
			costUSD = costUSD.Add(li.LineTotalUSD)
			salePen = salePen.Add(li.SalePricePen)
			items = append(items, li)
		}
		number := strings.TrimSpace(in.Number)
		if number == "" {
			var err error
			number, err = s.orders.NextNumber(ctx)
			if err != nil {
				return err
			}
		}
		now := time.Now().UTC()
		po := &PurchaseOrder{
			ID:            uuid.New(),
			Number:        number,
			OrderDate:     orderDate,
			ExpectedDate:  in.ExpectedDate,
			Status:        enums.PurchaseStatusPending,
			CurrencyCode:  USD,
			PaymentMethod: in.PaymentMethod,
			ExchangeRate:  in.ExchangeRate,
			Notes:         in.Notes,
			CustomerID:    in.CustomerID,
			SupplierID:    in.SupplierID,
			CreditCardID:  in.CreditCardID,
			CostUSD:       costUSD,
			SalePricePen:  salePen,
			RealCostPen:   s.realCostPEN(ctx, costUSD, in.ExchangeRate),
			Items:         items,
			CreatedAt:     now,
			UpdatedAt:     now,
		}
		if err := po.Validate(); err != nil {
			return err
		}
		if err := s.orders.Create(ctx, po, items); err != nil {
			return err
		}
		if po.PaymentMethod == PaymentCard && po.CostUSD.IsPositive() {
			if err := s.cards.ChargeCard(ctx, *in.CreditCardID, po.CostUSD); err != nil {
				return err
			}
		}
		out = po
		return nil
	})
	if err != nil {
		return nil, err
	}
	s.log.Info("purchase order created",
		"po_id", out.ID,
		"number", out.Number,
		"cost_usd", out.CostUSD.String(),
	)
	return out, nil
}

// MarkAsReceived transitions a pending order to received, records the
// receipt date, and injects the ordered quantities into inventory as
// batches at the PEN landed unit cost.
func (s *PurchasingService) MarkAsReceived(ctx context.Context, id uuid.UUID, at valueobjects.Date) error {
	if at.IsZero() {
		return apperrors.Errorf(apperrors.ErrValidation, "receipt date is required")
	}
	if at.After(time.Now()) {
		return apperrors.Errorf(apperrors.ErrValidation, "receipt date cannot be in the future")
	}
	err := s.txm.WithinTransaction(ctx, func(ctx context.Context) error {
		po, err := s.orders.GetByID(ctx, id)
		if err != nil {
			return err
		}
		items, err := s.orders.ListItems(ctx, id)
		if err != nil {
			return err
		}
		if err := po.MarkReceived(at); err != nil {
			return err
		}
		po.UpdatedAt = time.Now().UTC()
		if err := s.orders.Update(ctx, po); err != nil {
			return err
		}
		for _, li := range items {
			if err := s.orders.UpdateItemReceipt(ctx, li.ID, li.QuantityOrdered); err != nil {
				return err
			}
			if li.ProductID == nil || s.stock == nil {
				continue
			}
			if _, err := s.stock.ReceiveFromPurchase(ctx, inventory.ReceiveFromPurchaseInput{
				ProductID:      *li.ProductID,
				PurchaseLineID: li.ID,
				ArrivalDate:    at,
				Quantity:       li.QuantityOrdered,
				UnitCost:       li.LineRealCostPen(po.ExchangeRate),
				ExchangeRate:   po.ExchangeRate,
			}); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	s.log.Info("purchase received", "po_id", id, "at", at)
	return nil
}

// Cancel voids a pending or received order. Received stock is voided,
// the card charge is released, and when the order belonged to an
// already-settled card cycle the cost is recorded as refund_amount
// (saldo a favor) without touching historical cycle balances.
func (s *PurchasingService) Cancel(ctx context.Context, id uuid.UUID, reason string) (*PurchaseOrder, error) {
	if reason == "" {
		return nil, apperrors.Errorf(apperrors.ErrValidation, "cancel reason is required")
	}
	var out *PurchaseOrder
	err := s.txm.WithinTransaction(ctx, func(ctx context.Context) error {
		po, err := s.orders.GetByID(ctx, id)
		if err != nil {
			return err
		}
		if err := s.cancelOrder(ctx, po, reason); err != nil {
			return err
		}
		out = po
		return nil
	})
	if err != nil {
		return nil, err
	}
	s.log.Info("purchase cancelled", "po_id", id, "reason", reason)
	return out, nil
}

// FaultyInput is the payload for MarkFaulty.
type FaultyInput struct {
	ID     uuid.UUID
	Reason string
}

// MarkFaulty runs the "llegó en mal estado" workflow: it flags the
// order as faulty and cancels it exactly like Cancel.
func (s *PurchasingService) MarkFaulty(ctx context.Context, in FaultyInput) (*PurchaseOrder, error) {
	if in.ID == uuid.Nil {
		return nil, apperrors.Errorf(apperrors.ErrValidation, "purchase id is required")
	}
	if in.Reason == "" {
		return nil, apperrors.Errorf(apperrors.ErrValidation, "faulty reason is required")
	}
	var out *PurchaseOrder
	err := s.txm.WithinTransaction(ctx, func(ctx context.Context) error {
		po, err := s.orders.GetByID(ctx, in.ID)
		if err != nil {
			return err
		}
		if po.IsCancelled() {
			return derrors.Wrap(derrors.ErrPurchaseCancelled, errField("purchase is already cancelled"))
		}
		po.Faulty = true
		po.FaultyReason = in.Reason
		if err := s.cancelOrder(ctx, po, "Llegó en mal estado: "+in.Reason); err != nil {
			return err
		}
		out = po
		return nil
	})
	if err != nil {
		return nil, err
	}
	s.log.Info("purchase marked faulty", "po_id", in.ID, "refund", out.RefundAmount.String())
	return out, nil
}

// cancelOrder applies the shared cancellation flow to a loaded order.
func (s *PurchasingService) cancelOrder(ctx context.Context, po *PurchaseOrder, reason string) error {
	items, err := s.orders.ListItems(ctx, po.ID)
	if err != nil {
		return err
	}
	if po.Status == enums.PurchaseStatusReceived && s.stock != nil && len(items) > 0 {
		lineIDs := make([]uuid.UUID, 0, len(items))
		for _, li := range items {
			lineIDs = append(lineIDs, li.ID)
		}
		if err := s.stock.VoidPurchaseReceipt(ctx, lineIDs); err != nil {
			return err
		}
	}
	now := time.Now().UTC()
	if err := po.Cancel(reason, now); err != nil {
		return err
	}
	po.UpdatedAt = now
	if err := s.releaseCardCharge(ctx, po); err != nil {
		return err
	}
	return s.orders.Update(ctx, po)
}

// releaseCardCharge removes the order cost from the card's unpaid
// balance and records a refund when the order date falls before the
// current billing cycle (the cycle it belonged to was already settled).
func (s *PurchasingService) releaseCardCharge(ctx context.Context, po *PurchaseOrder) error {
	if po.CreditCardID == nil || s.cards == nil || !po.CostUSD.IsPositive() {
		return nil
	}
	if err := s.cards.ReleaseCardCharge(ctx, *po.CreditCardID, po.CostUSD); err != nil {
		return err
	}
	cycleStart, err := s.cards.CurrentCycleStart(ctx, *po.CreditCardID)
	if err == nil && po.OrderDate.Before(cycleStart) {
		po.RefundAmount = po.CostUSD
	}
	return nil
}

// ClientOrderLine is one line of a sale-linked client order.
type ClientOrderLine struct {
	ProductID    uuid.UUID
	Description  string
	Quantity     valueobjects.Quantity
	SalePricePen valueobjects.Money
}

// CreateClientOrder creates the internal purchase order behind a sale:
// linked to the customer, no credit card (the sale flow assigns cost and
// rate later), per-line cost taken from the product's USD cost, and
// the USD->PEN rate snapshotted by the caller. It runs in the caller's
// transaction (the sales service).
func (s *PurchasingService) CreateClientOrder(ctx context.Context, customerID, saleID uuid.UUID, rate valueobjects.ExchangeRate, lines []ClientOrderLine) error {
	if customerID == uuid.Nil {
		return apperrors.Errorf(apperrors.ErrValidation, "customer is required")
	}
	if saleID == uuid.Nil {
		return apperrors.Errorf(apperrors.ErrValidation, "sale id is required")
	}
	if len(lines) == 0 {
		return apperrors.Errorf(apperrors.ErrValidation, "client order must have at least one line")
	}
	if s.productByID == nil {
		return derrors.New("INTERNAL", "products are not configured")
	}
	if !rate.Decimal().IsPositive() {
		rate = valueobjects.One()
	}
	return s.txm.WithinTransaction(ctx, func(ctx context.Context) error {
		number, err := s.orders.NextNumber(ctx)
		if err != nil {
			return err
		}
		now := time.Now().UTC()
		po := &PurchaseOrder{
			ID:            uuid.New(),
			Number:        number,
			OrderDate:     now,
			Status:        enums.PurchaseStatusPending,
			CurrencyCode:  USD,
			PaymentMethod: DefaultPaymentMethod,
			ExchangeRate:  rate,
			CustomerID:    &customerID,
			Notes:         "pedido de cliente (venta " + saleID.String() + ")",
			Items:         []*PurchaseOrderItem{},
			CreatedAt:     now,
			UpdatedAt:     now,
		}
		for i, line := range lines {
			prod, err := s.productByID.GetByID(ctx, line.ProductID)
			if err != nil {
				return err
			}
			description := line.Description
			if description == "" {
				description = prod.Description
			}
			li, err := NewPurchaseOrderItem(PurchaseOrderItemOptions{
				PurchaseOrderID: po.ID,
				LineNumber:      i + 1,
				ProductID:       &line.ProductID,
				Description:     description,
				Quantity:        line.Quantity,
				UnitCostUSD:     prod.CostUSD,
				SalePricePen:    line.SalePricePen,
			})
			if err != nil {
				return err
			}
			po.Items = append(po.Items, li)
		}
		for _, li := range po.Items {
			po.CostUSD = po.CostUSD.Add(li.LineTotalUSD)
			po.SalePricePen = po.SalePricePen.Add(li.SalePricePen)
		}
		po.RealCostPen = s.realCostPEN(ctx, po.CostUSD, po.ExchangeRate)
		if err := po.Validate(); err != nil {
			return err
		}
		return s.orders.Create(ctx, po, po.Items)
	})
}

// GetByID returns the purchase order with its items.
func (s *PurchasingService) GetByID(ctx context.Context, id uuid.UUID) (*PurchaseOrder, error) {
	po, err := s.orders.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	items, err := s.orders.ListItems(ctx, id)
	if err != nil {
		return nil, err
	}
	po.Items = items
	po.ProductsText = s.summarizeItems(items)
	return po, nil
}

// summarizeItems renders the order lines as the products-column text.
func (s *PurchasingService) summarizeItems(items []*PurchaseOrderItem) string {
	lines := make([]PurchaseLineSummary, 0, len(items))
	for _, li := range items {
		lines = append(lines, PurchaseLineSummary{Quantity: li.QuantityOrdered.String(), Name: li.Description})
	}
	return SummarizeLines(lines)
}

// List returns purchase orders matching the filter, enriched with the
// supplier and products columns.
func (s *PurchasingService) List(ctx context.Context, filter PurchaseFilter) (repositories.Page[*PurchaseOrder], error) {
	page, err := s.orders.List(ctx, filter)
	if err != nil {
		return repositories.Page[*PurchaseOrder]{}, err
	}
	if len(page.Items) > 0 {
		ids := make([]uuid.UUID, 0, len(page.Items))
		for _, po := range page.Items {
			ids = append(ids, po.ID)
		}
		summaries, err := s.orders.ListLineSummaries(ctx, ids)
		if err != nil {
			return repositories.Page[*PurchaseOrder]{}, err
		}
		for _, po := range page.Items {
			po.ProductsText = SummarizeLines(summaries[po.ID])
		}
	}
	return page, nil
}

// ListItems returns the lines of a purchase order.
func (s *PurchasingService) ListItems(ctx context.Context, purchaseOrderID uuid.UUID) ([]*PurchaseOrderItem, error) {
	return s.orders.ListItems(ctx, purchaseOrderID)
}

// UpdateNumber changes the order number. Sequence numbers are
// generated once and can be corrected through this method.
func (s *PurchasingService) UpdateNumber(ctx context.Context, id uuid.UUID, number string) (*PurchaseOrder, error) {
	number = strings.TrimSpace(number)
	if number == "" {
		return nil, apperrors.Errorf(apperrors.ErrValidation, "order number is required")
	}
	var out *PurchaseOrder
	err := s.txm.WithinTransaction(ctx, func(ctx context.Context) error {
		po, err := s.orders.GetByID(ctx, id)
		if err != nil {
			return err
		}
		po.Number = number
		po.UpdatedAt = time.Now().UTC()
		if err := po.Validate(); err != nil {
			return err
		}
		if err := s.orders.Update(ctx, po); err != nil {
			if errors.Is(err, repositories.ErrDuplicate) {
				return apperrors.Errorf(apperrors.ErrConflict, "ya existe una orden con ese número")
			}
			return err
		}
		out = po
		return nil
	})
	if err != nil {
		return nil, err
	}
	s.log.Info("purchase number updated", "po_id", id, "number", number)
	return out, nil
}
