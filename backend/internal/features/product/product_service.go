// Package product implements the business logic for the product
// aggregate: creation, price/cost changes, lifecycle.
package product

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"

	"vfinancy/backend/infrastructure/logger"
	"vfinancy/backend/internal/domain/repositories"
	"vfinancy/backend/internal/domain/valueobjects"
	"vfinancy/backend/internal/shared/apperrors"
)

// ProductService owns the product slice.
type ProductService struct {
	repo ProductRepository
	txm  repositories.TransactionManager
	log  *logger.Logger
}

// NewService returns a ProductService ready for use.
func NewService(repo ProductRepository, txm repositories.TransactionManager, log *logger.Logger) *ProductService {
	return &ProductService{repo: repo, txm: txm, log: log}
}

// CreateInput is the payload for Create / GetOrCreate. Cost and price
// default to zero when unset; an empty UnitCode keeps the default and
// an empty SKU keeps the auto-generated one.
type CreateInput struct {
	Description string
	UnitCode    string
	SKU         string
	CostUSD     valueobjects.Money
	SalePrice   valueobjects.Money
}

// Create persists a new product. All validation happens in the domain
// constructor. The SKU is only settable at creation time; it is never
// changed by later updates.
func (s *ProductService) Create(ctx context.Context, in CreateInput) (*Product, error) {
	p, err := NewProduct(in.Description, in.CostUSD, in.SalePrice)
	if err != nil {
		return nil, err
	}
	if unit := strings.TrimSpace(in.UnitCode); unit != "" {
		p.UnitCode = unit
	}
	if sku := strings.TrimSpace(in.SKU); sku != "" {
		p.SKU, err = valueobjects.NewSKU(sku)
		if err != nil {
			return nil, err
		}
	}
	if err := p.Validate(); err != nil {
		return nil, err
	}
	err = s.txm.WithinTransaction(ctx, func(ctx context.Context) error {
		return s.repo.Create(ctx, p)
	})
	if err != nil {
		return nil, err
	}
	s.log.Info("product created", "product_id", p.ID, "sku", p.SKU.String())
	return p, nil
}

// GetOrCreate returns the non-deleted product whose description
// matches exactly, updating its cost when it changed; otherwise it
// creates a new product. Used when a purchase order registers a new
// product by name.
func (s *ProductService) GetOrCreate(ctx context.Context, in CreateInput) (*Product, error) {
	name := strings.TrimSpace(in.Description)
	existing, err := s.repo.GetByDescription(ctx, name)
	if err == nil {
		if !existing.CostUSD.Equals(in.CostUSD) {
			existing.CostUSD = in.CostUSD
			existing.Touch()
			if err := s.repo.Update(ctx, existing); err != nil {
				return nil, err
			}
		}
		return existing, nil
	}
	if !errors.Is(err, repositories.ErrNotFound) {
		return nil, err
	}
	return s.Create(ctx, in)
}

// UpdateInput is the payload for Update. An empty field keeps the
// current value; a nil pointer keeps the current value.
type UpdateInput struct {
	ID          uuid.UUID
	SKU         string
	Description string
	UnitCode    *string
	CostUSD     *valueobjects.Money
	SalePrice   *valueobjects.Money
}

// Update applies the requested changes in a single transaction.
func (s *ProductService) Update(ctx context.Context, in UpdateInput) (*Product, error) {
	if in.ID == uuid.Nil {
		return nil, errField("product id is required")
	}
	var out *Product
	err := s.txm.WithinTransaction(ctx, func(ctx context.Context) error {
		p, err := s.repo.GetByID(ctx, in.ID)
		if err != nil {
			return err
		}
		if sku := strings.TrimSpace(in.SKU); sku != "" {
			skuVal, err := valueobjects.NewSKU(sku)
			if err != nil {
				return err
			}
			p.SKU = skuVal
		}
		if in.Description != "" {
			p.Description = strings.TrimSpace(in.Description)
		}
		if in.UnitCode != nil && strings.TrimSpace(*in.UnitCode) != "" {
			p.UnitCode = strings.TrimSpace(*in.UnitCode)
		}
		if in.CostUSD != nil {
			p.CostUSD = *in.CostUSD
		}
		if in.SalePrice != nil {
			p.SalePrice = *in.SalePrice
		}
		if err := p.Validate(); err != nil {
			return err
		}
		p.Touch()
		if err := s.repo.Update(ctx, p); err != nil {
			if errors.Is(err, repositories.ErrDuplicate) {
				return apperrors.Errorf(apperrors.ErrConflict, "ya existe un producto con ese SKU")
			}
			return err
		}
		out = p
		return nil
	})
	if err != nil {
		return nil, err
	}
	s.log.Info("product updated", "product_id", out.ID)
	return out, nil
}

// mutate loads the product, applies fn, validates and persists it in a
// single transaction.
func (s *ProductService) mutate(ctx context.Context, id uuid.UUID, fn func(*Product) error) error {
	return s.txm.WithinTransaction(ctx, func(ctx context.Context) error {
		p, err := s.repo.GetByID(ctx, id)
		if err != nil {
			return err
		}
		if err := fn(p); err != nil {
			return err
		}
		if err := p.Validate(); err != nil {
			return err
		}
		p.Touch()
		return s.repo.Update(ctx, p)
	})
}

// UpdateCostUSD changes the product's standard cost in USD.
func (s *ProductService) UpdateCostUSD(ctx context.Context, id uuid.UUID, cost valueobjects.Money) error {
	err := s.mutate(ctx, id, func(p *Product) error {
		p.CostUSD = cost
		return nil
	})
	if err != nil {
		return err
	}
	s.log.Info("product cost usd updated", "product_id", id, "new_cost_usd", cost)
	return nil
}

// UpdateSalePrice changes the product's sale price.
func (s *ProductService) UpdateSalePrice(ctx context.Context, id uuid.UUID, price valueobjects.Money) error {
	err := s.mutate(ctx, id, func(p *Product) error {
		p.SalePrice = price
		return nil
	})
	if err != nil {
		return err
	}
	s.log.Info("product sale price updated", "product_id", id, "new_price", price)
	return nil
}

// Activate / Deactivate toggle the catalog visibility of the product.
func (s *ProductService) Activate(ctx context.Context, id uuid.UUID) error {
	return s.mutate(ctx, id, func(p *Product) error {
		p.IsActive = true
		return nil
	})
}

func (s *ProductService) Deactivate(ctx context.Context, id uuid.UUID) error {
	return s.mutate(ctx, id, func(p *Product) error {
		p.IsActive = false
		return nil
	})
}

// Delete soft-deletes the product. Historical references are
// preserved.
func (s *ProductService) Delete(ctx context.Context, id uuid.UUID) error {
	if err := s.repo.SoftDelete(ctx, id); err != nil {
		return err
	}
	s.log.Info("product deleted", "product_id", id)
	return nil
}

// GetByID returns a single product.
func (s *ProductService) GetByID(ctx context.Context, id uuid.UUID) (*Product, error) {
	return s.repo.GetByID(ctx, id)
}

// List returns a page of products matching the filter.
func (s *ProductService) List(ctx context.Context, filter ProductFilter) (repositories.Page[*Product], error) {
	return s.repo.List(ctx, filter)
}

// Options returns active products for the sale/purchase form selects.
func (s *ProductService) Options(ctx context.Context) ([]*Product, error) {
	active := true
	page, err := s.repo.List(ctx, ProductFilter{
		IsActive:    &active,
		PageRequest: repositories.PageRequest{Limit: 1000},
	})
	if err != nil {
		return nil, err
	}
	return page.Items, nil
}
