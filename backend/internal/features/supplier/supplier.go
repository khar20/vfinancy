// Package supplier implements the supplier aggregate: creation,
// validation and lifecycle used by the purchasing module.
package supplier

import (
	"strings"
	"time"

	"github.com/google/uuid"

	derrors "vfinancy/backend/internal/domain/errors"
)

// Supplier is a vendor from which purchase orders are sourced.
type Supplier struct {
	ID          uuid.UUID
	Name        string
	ContactName string
	Phone       string
	Email       string
	Address     string
	IsActive    bool
	CreatedAt   time.Time
	UpdatedAt   time.Time
	DeletedAt   *time.Time
}

// NewSupplier validates the required fields and constructs an active
// supplier.
func NewSupplier(name string) (*Supplier, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, derrors.Wrap(derrors.ErrRequired, derrors.ErrField("supplier name is required"))
	}
	now := time.Now().UTC()
	return &Supplier{
		ID:        uuid.New(),
		Name:      name,
		IsActive:  true,
		CreatedAt: now,
		UpdatedAt: now,
	}, nil
}

// Touch stamps UpdatedAt with the current UTC time.
func (s *Supplier) Touch() { s.UpdatedAt = time.Now().UTC() }

// Validate checks the supplier invariants: a non-blank name.
func (s *Supplier) Validate() error {
	if strings.TrimSpace(s.Name) == "" {
		return derrors.Wrap(derrors.ErrRequired, derrors.ErrField("supplier name is required"))
	}
	return nil
}