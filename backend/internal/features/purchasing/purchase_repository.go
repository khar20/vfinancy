package purchasing

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"vfinancy/backend/internal/domain/repositories"
	"vfinancy/backend/internal/domain/valueobjects"
)

// PurchaseFilter is the input to PurchaseRepository.List.
type PurchaseFilter struct {
	Search         string
	Status         string
	CreditCardID   *uuid.UUID
	From           *time.Time
	To             *time.Time
	IncludeDeleted bool
	repositories.PageRequest
}

// PurchaseLineSummary is one order line rendered in the list's
// "Productos" column: a decimal quantity and a product name.
type PurchaseLineSummary struct {
	Quantity string
	Name     string
}

// SummarizeLines renders the ordered quantities and line names of an
// order into the "3× Mouse, 1× Teclado" summary used by the list and
// the detail drawer.
func SummarizeLines(lines []PurchaseLineSummary) string {
	parts := make([]string, 0, len(lines))
	for _, l := range lines {
		q, err := decimal.NewFromString(strings.TrimSpace(l.Quantity))
		if err != nil {
			q = decimal.Zero
		}
		if q.Equal(q.Truncate(0)) {
			q = q.Truncate(0)
		}
		parts = append(parts, q.String()+"× "+l.Name)
	}
	return strings.Join(parts, ", ")
}

// PurchaseRepository persists purchase orders and their line items.
type PurchaseRepository interface {
	// Create inserts the order and all of its items.
	Create(ctx context.Context, po *PurchaseOrder, items []*PurchaseOrderItem) error
	// Update persists the mutable order fields.
	Update(ctx context.Context, po *PurchaseOrder) error
	// SoftDelete marks the order as deleted.
	SoftDelete(ctx context.Context, id uuid.UUID) error
	// GetByID loads a single order without its items.
	GetByID(ctx context.Context, id uuid.UUID) (*PurchaseOrder, error)
	// ListItems returns the lines of an order ordered by line number.
	ListItems(ctx context.Context, purchaseOrderID uuid.UUID) ([]*PurchaseOrderItem, error)
	// UpdateItemReceipt records the received quantity of a line.
	UpdateItemReceipt(ctx context.Context, itemID uuid.UUID, received valueobjects.Quantity) error
	// NextNumber returns the next "PO-" zero-padded sequence number.
	NextNumber(ctx context.Context) (string, error)
	// List returns the orders matching the filter.
	List(ctx context.Context, filter PurchaseFilter) (repositories.Page[*PurchaseOrder], error)
	// ListLineSummaries returns the product lines of the given orders,
	// keyed by order id and ordered by line number, for the list's
	// products column.
	ListLineSummaries(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID][]PurchaseLineSummary, error)
}
