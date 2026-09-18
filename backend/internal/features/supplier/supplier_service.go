// Package supplier implements the supplier business logic: creation,
// updates, soft deletion and the queries used by the purchasing module.
package supplier

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"

	"vfinancy/backend/infrastructure/logger"
	derrors "vfinancy/backend/internal/domain/errors"
	"vfinancy/backend/internal/domain/repositories"
	"vfinancy/backend/internal/shared/apperrors"
)

// Service is the entry point for all supplier-related business
// operations.
type Service struct {
	repo SupplierRepository
	txm  repositories.TransactionManager
	log  *logger.Logger
}

// NewService builds a supplier service.
func NewService(repo SupplierRepository, txm repositories.TransactionManager, log *logger.Logger) *Service {
	if repo == nil {
		panic("supplier: nil supplier repository")
	}
	if log == nil {
		panic("supplier: nil logger")
	}
	return &Service{repo: repo, txm: txm, log: log}
}

// CreateInput is the payload for Create.
type CreateInput struct {
	Name        string
	ContactName string
	Phone       string
	Email       string
	Address     string
}

// UpdateInput is the payload for Update. A non-empty Name is applied;
// Status "" keeps the current value, otherwise it must be active or
// inactive.
type UpdateInput struct {
	ID          uuid.UUID
	Name        string
	ContactName string
	Phone       string
	Email       string
	Address     string
	Status      string
}

// conflict is the user-facing error for a duplicated supplier name.
func conflict() error {
	return apperrors.Errorf(apperrors.ErrConflict, "ya existe un proveedor con ese nombre")
}

// Create validates and persists a new supplier.
func (s *Service) Create(ctx context.Context, in CreateInput) (*Supplier, error) {
	sup, err := NewSupplier(in.Name)
	if err != nil {
		return nil, err
	}
	sup.ContactName = strings.TrimSpace(in.ContactName)
	sup.Phone = strings.TrimSpace(in.Phone)
	sup.Email = strings.TrimSpace(in.Email)
	sup.Address = strings.TrimSpace(in.Address)

	if err := s.create(ctx, sup); err != nil {
		return nil, err
	}
	s.log.Info("supplier created", "supplier_id", sup.ID)
	return sup, nil
}

func (s *Service) create(ctx context.Context, sup *Supplier) error {
	return s.txm.WithinTransaction(ctx, func(ctx context.Context) error {
		if err := sup.Validate(); err != nil {
			return err
		}
		if err := s.repo.Create(ctx, sup); err != nil {
			if errors.Is(err, repositories.ErrDuplicate) {
				return conflict()
			}
			return err
		}
		return nil
	})
}

// Update applies the requested changes to a supplier inside a
// transaction.
func (s *Service) Update(ctx context.Context, in UpdateInput) (*Supplier, error) {
	if in.ID == uuid.Nil {
		return nil, derrors.Wrap(derrors.ErrRequired, derrors.ErrField("supplier id is required"))
	}
	var out *Supplier
	err := s.txm.WithinTransaction(ctx, func(ctx context.Context) error {
		sup, err := s.repo.GetByID(ctx, in.ID)
		if err != nil {
			return err
		}
		if strings.TrimSpace(in.Name) != "" {
			sup.Name = strings.TrimSpace(in.Name)
		}
		sup.ContactName = strings.TrimSpace(in.ContactName)
		sup.Phone = strings.TrimSpace(in.Phone)
		sup.Email = strings.TrimSpace(in.Email)
		sup.Address = strings.TrimSpace(in.Address)
		if in.Status != "" {
			switch in.Status {
			case "active":
				sup.IsActive = true
			case "inactive":
				sup.IsActive = false
			default:
				return derrors.Wrap(derrors.ErrInvalidEnum, derrors.ErrField("supplier status is invalid: "+in.Status))
			}
		}
		if err := sup.Validate(); err != nil {
			return err
		}
		sup.Touch()
		if err := s.repo.Update(ctx, sup); err != nil {
			if errors.Is(err, repositories.ErrDuplicate) {
				return conflict()
			}
			return err
		}
		out = sup
		return nil
	})
	if err != nil {
		return nil, err
	}
	s.log.Info("supplier updated", "supplier_id", out.ID)
	return out, nil
}

// Delete soft-deletes a supplier. A supplier referenced by a purchase
// order cannot be removed.
func (s *Service) Delete(ctx context.Context, id uuid.UUID) error {
	inUse, err := s.repo.InUse(ctx, id)
	if err != nil {
		return err
	}
	if inUse {
		return apperrors.Errorf(apperrors.ErrConflict, "no se puede eliminar un proveedor con órdenes de compra asociadas")
	}
	if err := s.repo.SoftDelete(ctx, id); err != nil {
		return err
	}
	s.log.Info("supplier deleted", "supplier_id", id)
	return nil
}

// GetByID returns a single supplier.
func (s *Service) GetByID(ctx context.Context, id uuid.UUID) (*Supplier, error) {
	return s.repo.GetByID(ctx, id)
}

// List returns suppliers matching the filter.
func (s *Service) List(ctx context.Context, filter SupplierFilter) (repositories.Page[*Supplier], error) {
	return s.repo.List(ctx, filter)
}

// Options returns active suppliers for the purchase form select.
func (s *Service) Options(ctx context.Context) ([]*Supplier, error) {
	page, err := s.repo.List(ctx, SupplierFilter{
		Status:      "active",
		PageRequest: repositories.PageRequest{Limit: 1000},
	})
	if err != nil {
		return nil, err
	}
	return page.Items, nil
}