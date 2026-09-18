package inventory

import (
	"context"
	"time"

	"github.com/google/uuid"

	"vfinancy/backend/internal/domain/repositories"
)

// InventoryBatchFilter is the input to InventoryBatchRepository.List.
type InventoryBatchFilter struct {
	ProductID      *uuid.UUID
	PurchaseLineID *uuid.UUID
	Statuses       []string // exact batch statuses; takes precedence over OnlyActive/OnlyClearance
	OnlyActive     bool     // exclude depleted / voided
	OnlyClearance  bool     // batches past their maximum sale date
	Search         string
	repositories.PageRequest
}

// InventoryBatchRepository persists inventory batches. A batch is the
// per-arrival group of units of a single product; quantity is
// denormalized for fast lookup and maintained by the service through
// the movement ledger.
type InventoryBatchRepository interface {
	Create(ctx context.Context, b *InventoryBatch) error
	Update(ctx context.Context, b *InventoryBatch) error

	GetByID(ctx context.Context, id uuid.UUID) (*InventoryBatch, error)
	// GetByIDForUpdate locks the batch row (SELECT ... FOR UPDATE) for
	// use inside a write transaction. The row must be read only inside
	// repositories.TransactionManager.WithinTransaction.
	GetByIDForUpdate(ctx context.Context, id uuid.UUID) (*InventoryBatch, error)

	// ExistsByPurchaseLineID reports whether a batch has already been
	// created for the given purchase order line. Used to make purchase
	// receipts idempotent across Create / Approve / MarkAsReceived.
	ExistsByPurchaseLineID(ctx context.Context, purchaseLineID uuid.UUID) (bool, error)

	List(ctx context.Context, filter InventoryBatchFilter) (repositories.Page[*InventoryBatch], error)

	// RefreshClearanceFlags reconciles the persisted is_clearance
	// column with the clearance rule as of `at`, for every active
	// batch holding stock. Returns how many rows changed.
	RefreshClearanceFlags(ctx context.Context, at time.Time, clearanceDays int) (int, error)
}
