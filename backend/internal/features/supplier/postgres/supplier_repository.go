package postgres

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"

	"vfinancy/backend/infrastructure/persistence"
	"vfinancy/backend/internal/domain/repositories"
	"vfinancy/backend/internal/features/supplier"
)

// supplierRepository is the SQL implementation of
// supplier.SupplierRepository.
type supplierRepository struct {
	q persistence.Querier
}

// NewSupplierRepository returns an auto-commit implementation.
func NewSupplierRepository(db *sql.DB) *supplierRepository {
	return &supplierRepository{q: persistence.FromDB(db)}
}

const supplierColumns = `
	id, name, contact_name, phone, email, address, is_active,
	created_at, updated_at, deleted_at
`

func (r *supplierRepository) Create(ctx context.Context, s *supplier.Supplier) error {
	const q = `INSERT INTO suppliers (
		id, name, contact_name, phone, email, address, is_active,
		created_at, updated_at, deleted_at
	) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`
	_, err := persistence.Q(ctx, r.q).ExecContext(ctx, q,
		s.ID,
		s.Name,
		s.ContactName,
		s.Phone,
		s.Email,
		persistence.NullIfEmpty(s.Address),
		s.IsActive,
		s.CreatedAt, s.UpdatedAt,
		persistence.NullIfZeroTime(s.DeletedAt),
	)
	return persistence.Translate(err)
}

func (r *supplierRepository) Update(ctx context.Context, s *supplier.Supplier) error {
	const q = `UPDATE suppliers SET
		name = $1, contact_name = $2, phone = $3, email = $4, address = $5, is_active = $6,
		updated_at = $7
	 WHERE id = $8 AND deleted_at IS NULL`
	res, err := persistence.Q(ctx, r.q).ExecContext(ctx, q,
		s.Name,
		s.ContactName,
		s.Phone,
		s.Email,
		persistence.NullIfEmpty(s.Address),
		s.IsActive,
		time.Now().UTC(),
		s.ID,
	)
	if err != nil {
		return persistence.Translate(err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return repositories.ErrNotFound
	}
	return nil
}

func (r *supplierRepository) SoftDelete(ctx context.Context, id uuid.UUID) error {
	const q = `UPDATE suppliers SET deleted_at = $1 WHERE id = $2 AND deleted_at IS NULL`
	res, err := persistence.Q(ctx, r.q).ExecContext(ctx, q, time.Now().UTC(), id)
	if err != nil {
		return persistence.Translate(err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return repositories.ErrNotFound
	}
	return nil
}

func (r *supplierRepository) GetByID(ctx context.Context, id uuid.UUID) (*supplier.Supplier, error) {
	q := `SELECT ` + supplierColumns + ` FROM suppliers WHERE id = $1 AND deleted_at IS NULL`
	row := persistence.Q(ctx, r.q).QueryRowContext(ctx, q, id)
	return scanSupplier(row)
}

func (r *supplierRepository) List(ctx context.Context, filter supplier.SupplierFilter) (repositories.Page[*supplier.Supplier], error) {
	var clauses []string
	if !filter.IncludeDeleted {
		clauses = append(clauses, "deleted_at IS NULL")
	}
	var args []any
	if filter.Status != "" {
		clauses = append(clauses, fmt.Sprintf("is_active = $%d", len(args)+1))
		args = append(args, filter.Status == "active")
	}
	if filter.Search != "" {
		clauses = append(clauses, fmt.Sprintf(
			"(LOWER(name) LIKE LOWER($%d) OR LOWER(contact_name) LIKE LOWER($%d))",
			len(args)+1, len(args)+2,
		))
		like := "%" + filter.Search + "%"
		args = append(args, like, like)
	}
	where := ""
	if len(clauses) > 0 {
		where = " WHERE " + persistence.JoinClauses(clauses)
	}
	limit, offset := persistence.LimitOffset(filter.PageRequest, 25, 1000)

	var total int
	if err := persistence.Q(ctx, r.q).QueryRowContext(ctx, "SELECT count(*) FROM suppliers"+where, args...).Scan(&total); err != nil {
		return repositories.Page[*supplier.Supplier]{}, persistence.Translate(err)
	}

	limitPos := len(args) + 1
	offsetPos := len(args) + 2
	args = append(args, limit, offset)
	rows, err := persistence.Q(ctx, r.q).QueryContext(ctx,
		fmt.Sprintf("SELECT %s FROM suppliers%s ORDER BY name LIMIT $%d OFFSET $%d",
			supplierColumns, where, limitPos, offsetPos),
		args...)
	if err != nil {
		return repositories.Page[*supplier.Supplier]{}, persistence.Translate(err)
	}
	out := make([]*supplier.Supplier, 0, limit)
	if err := persistence.ScanRows(rows, func(r *sql.Rows) error {
		s, err := scanSupplierFromRows(r)
		if err != nil {
			return err
		}
		out = append(out, s)
		return nil
	}); err != nil {
		return repositories.Page[*supplier.Supplier]{}, err
	}
	return repositories.Page[*supplier.Supplier]{Items: out, Total: total, Limit: limit, Offset: offset}, nil
}

// InUse reports whether any non-deleted purchase order references the
// supplier.
func (r *supplierRepository) InUse(ctx context.Context, id uuid.UUID) (bool, error) {
	var n int
	if err := persistence.Q(ctx, r.q).QueryRowContext(ctx,
		`SELECT 1 FROM purchase_orders WHERE supplier_id = $1 AND deleted_at IS NULL LIMIT 1`, id).Scan(&n); err != nil {
		if persistence.IsPgNoRows(err) {
			return false, nil
		}
		return false, persistence.Translate(err)
	}
	return n == 1, nil
}

func scanSupplier(row *sql.Row) (*supplier.Supplier, error) {
	s := &supplier.Supplier{}
	sr := &supplierRow{}
	if err := persistence.ScanRow(row,
		&s.ID, &sr.name, &sr.contactName, &sr.phone, &sr.email, &sr.address, &sr.isActive,
		&s.CreatedAt, &s.UpdatedAt, &sr.deletedAt,
	); err != nil {
		return nil, err
	}
	return sr.fill(s)
}

func scanSupplierFromRows(rows *sql.Rows) (*supplier.Supplier, error) {
	s := &supplier.Supplier{}
	sr := &supplierRow{}
	if err := rows.Scan(
		&s.ID, &sr.name, &sr.contactName, &sr.phone, &sr.email, &sr.address, &sr.isActive,
		&s.CreatedAt, &s.UpdatedAt, &sr.deletedAt,
	); err != nil {
		return nil, persistence.Translate(err)
	}
	return sr.fill(s)
}

type supplierRow struct {
	name, contactName, phone, email string
	address                         sql.NullString
	isActive                        bool
	deletedAt                       sql.NullTime
}

func (sr *supplierRow) fill(s *supplier.Supplier) (*supplier.Supplier, error) {
	s.Name = sr.name
	s.ContactName = sr.contactName
	s.Phone = sr.phone
	s.Email = sr.email
	s.Address = sr.address.String
	s.IsActive = sr.isActive
	if sr.deletedAt.Valid {
		t := sr.deletedAt.Time
		s.DeletedAt = &t
	}
	return s, nil
}