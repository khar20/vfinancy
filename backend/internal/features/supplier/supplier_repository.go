package supplier

import (
	"context"

	"github.com/google/uuid"

	"vfinancy/backend/internal/domain/repositories"
)

// SupplierFilter is the input to SupplierRepository.List.
type SupplierFilter struct {
	Search         string
	Status         string
	IncludeDeleted bool
	repositories.PageRequest
}

// SupplierRepository persists suppliers.
type SupplierRepository interface {
	Create(ctx context.Context, s *Supplier) error
	Update(ctx context.Context, s *Supplier) error
	SoftDelete(ctx context.Context, id uuid.UUID) error
	GetByID(ctx context.Context, id uuid.UUID) (*Supplier, error)
	List(ctx context.Context, filter SupplierFilter) (repositories.Page[*Supplier], error)
	InUse(ctx context.Context, id uuid.UUID) (bool, error)
}