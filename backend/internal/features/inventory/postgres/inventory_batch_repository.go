package postgres

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"vfinancy/backend/infrastructure/persistence"
	"vfinancy/backend/internal/domain/enums"
	"vfinancy/backend/internal/domain/repositories"
	"vfinancy/backend/internal/domain/valueobjects"
	"vfinancy/backend/internal/features/inventory"
)

var _ inventory.InventoryBatchRepository = (*inventoryBatchRepository)(nil)

type inventoryBatchRepository struct {
	q persistence.Querier
}

// NewInventoryBatchRepository returns an InventoryBatchRepository
// backed by *sql.DB.
func NewInventoryBatchRepository(db *sql.DB) *inventoryBatchRepository {
	return &inventoryBatchRepository{q: persistence.FromDB(db)}
}

const batchColumns = `
	id, product_id, purchase_order_item_id, arrival_date, quantity,
	original_quantity, unit_cost, exchange_rate, status, is_clearance,
	created_at, updated_at
`

func (r *inventoryBatchRepository) Create(ctx context.Context, b *inventory.InventoryBatch) error {
	const q = `INSERT INTO inventory_batches (
		id, product_id, purchase_order_item_id, arrival_date, quantity,
		original_quantity, unit_cost, exchange_rate, status, is_clearance,
		created_at, updated_at
	) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`
	_, err := persistence.Q(ctx, r.q).ExecContext(ctx, q,
		b.ID, b.ProductID, persistence.NullIfEmptyUUID(b.PurchaseOrderItemID),
		b.ArrivalDate, b.Quantity.String(), b.OriginalQuantity.String(),
		b.UnitCost.String(), b.ExchangeRate.String(), b.Status.String(),
		b.IsClearanceOn(inventory.ClearanceDays, time.Now().UTC()),
		b.CreatedAt, b.UpdatedAt,
	)
	return persistence.Translate(err)
}

func (r *inventoryBatchRepository) Update(ctx context.Context, b *inventory.InventoryBatch) error {
	const q = `UPDATE inventory_batches SET
		arrival_date = $1, quantity = $2, original_quantity = $3,
		unit_cost = $4, exchange_rate = $5, status = $6, is_clearance = $7,
		updated_at = $8
	 WHERE id = $9`
	res, err := persistence.Q(ctx, r.q).ExecContext(ctx, q,
		b.ArrivalDate, b.Quantity.String(), b.OriginalQuantity.String(),
		b.UnitCost.String(), b.ExchangeRate.String(), b.Status.String(),
		b.IsClearanceOn(inventory.ClearanceDays, time.Now().UTC()),
		time.Now().UTC(), b.ID,
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

func (r *inventoryBatchRepository) GetByID(ctx context.Context, id uuid.UUID) (*inventory.InventoryBatch, error) {
	q := `SELECT ` + batchColumns + ` FROM inventory_batches WHERE id = $1`
	row := persistence.Q(ctx, r.q).QueryRowContext(ctx, q, id)
	return scanBatch(row)
}

func (r *inventoryBatchRepository) GetByIDForUpdate(ctx context.Context, id uuid.UUID) (*inventory.InventoryBatch, error) {
	// SQLite has no FOR UPDATE; its single-writer model plus the
	// BEGIN IMMEDIATE transaction gives the needed lock. Postgres
	// locks the row for the duration of the write transaction.
	lock := " FOR UPDATE"
	if persistence.IsSQLite() {
		lock = ""
	}
	q := `SELECT ` + batchColumns + ` FROM inventory_batches WHERE id = $1` + lock
	row := persistence.Q(ctx, r.q).QueryRowContext(ctx, q, id)
	return scanBatch(row)
}

func (r *inventoryBatchRepository) ExistsByPurchaseLineID(ctx context.Context, purchaseLineID uuid.UUID) (bool, error) {
	const q = `SELECT EXISTS (SELECT 1 FROM inventory_batches WHERE purchase_order_item_id = $1)`
	var exists bool
	if err := persistence.Q(ctx, r.q).QueryRowContext(ctx, q, purchaseLineID).Scan(&exists); err != nil {
		return false, persistence.Translate(err)
	}
	return exists, nil
}

func (r *inventoryBatchRepository) List(ctx context.Context, filter inventory.InventoryBatchFilter) (repositories.Page[*inventory.InventoryBatch], error) {
	var (
		clauses = []string{"TRUE"}
		args    []any
	)
	if filter.ProductID != nil {
		clauses = append(clauses, fmt.Sprintf("product_id = $%d", len(args)+1))
		args = append(args, *filter.ProductID)
	}
	if filter.PurchaseLineID != nil {
		clauses = append(clauses, fmt.Sprintf("purchase_order_item_id = $%d", len(args)+1))
		args = append(args, *filter.PurchaseLineID)
	}
	if len(filter.Statuses) > 0 {
		placeholders := make([]string, 0, len(filter.Statuses))
		for _, s := range filter.Statuses {
			placeholders = append(placeholders, fmt.Sprintf("$%d", len(args)+1))
			args = append(args, s)
		}
		clauses = append(clauses, "status IN ("+strings.Join(placeholders, ", ")+")")
	} else {
		if filter.OnlyActive {
			clauses = append(clauses, "status = 'active'")
		}
		if filter.OnlyClearance {
			clauses = append(clauses, "is_clearance = TRUE")
		}
	}
	if search := strings.TrimSpace(filter.Search); search != "" {
		pattern := "%" + strings.ToLower(search) + "%"
		clauses = append(clauses, fmt.Sprintf(
			`EXISTS (SELECT 1 FROM products p WHERE p.id = inventory_batches.product_id
				AND (LOWER(p.sku) LIKE $%d OR LOWER(p.description) LIKE $%d))`,
			len(args)+1, len(args)+2))
		args = append(args, pattern, pattern)
	}
	where := persistence.JoinClauses(clauses)
	limit, offset := persistence.LimitOffset(filter.PageRequest, 25, 200)

	var total int
	if err := persistence.Q(ctx, r.q).QueryRowContext(ctx, "SELECT count(*) FROM inventory_batches WHERE "+where, args...).Scan(&total); err != nil {
		return repositories.Page[*inventory.InventoryBatch]{}, persistence.Translate(err)
	}

	limitPos := len(args) + 1
	offsetPos := len(args) + 2
	args = append(args, limit, offset)
	rows, err := persistence.Q(ctx, r.q).QueryContext(ctx,
		fmt.Sprintf("SELECT %s FROM inventory_batches WHERE %s ORDER BY arrival_date DESC LIMIT $%d OFFSET $%d",
			batchColumns, where, limitPos, offsetPos),
		args...)
	if err != nil {
		return repositories.Page[*inventory.InventoryBatch]{}, persistence.Translate(err)
	}
	out := make([]*inventory.InventoryBatch, 0, limit)
	if err := persistence.ScanRows(rows, func(r *sql.Rows) error {
		b, err := scanBatchFromRows(r)
		if err != nil {
			return err
		}
		out = append(out, b)
		return nil
	}); err != nil {
		return repositories.Page[*inventory.InventoryBatch]{}, err
	}
	return repositories.Page[*inventory.InventoryBatch]{Items: out, Total: total, Limit: limit, Offset: offset}, nil
}

func (r *inventoryBatchRepository) RefreshClearanceFlags(ctx context.Context, at time.Time, clearanceDays int) (int, error) {
	if clearanceDays < 0 {
		clearanceDays = inventory.ClearanceDays
	}
	cutoff := valueobjects.AddDays(valueobjects.NewDateFromTime(at), -clearanceDays)
	// The WHERE guard restricts the write to rows whose flag would
	// actually flip, so RowsAffected reports exactly the rows changed.
	const q = `UPDATE inventory_batches
		SET is_clearance = (arrival_date <= $1), updated_at = $2
		WHERE status = 'active' AND CAST(quantity AS REAL) > 0
		  AND is_clearance <> (arrival_date <= $1)`
	res, err := persistence.Q(ctx, r.q).ExecContext(ctx, q, cutoff, time.Now().UTC())
	if err != nil {
		return 0, persistence.Translate(err)
	}
	n, _ := res.RowsAffected()
	return int(n), nil
}

func scanBatch(row *sql.Row) (*inventory.InventoryBatch, error) {
	return scanBatchInto(row.Scan)
}

func scanBatchFromRows(rows *sql.Rows) (*inventory.InventoryBatch, error) {
	return scanBatchInto(rows.Scan)
}

func scanBatchInto(scan func(dest ...any) error) (*inventory.InventoryBatch, error) {
	b := &inventory.InventoryBatch{}
	var (
		purchaseLineID                       sql.NullString
		quantity, originalQuantity, unitCost string
		exchangeRate, status                 string
		isClearance                          bool
	)
	if err := scan(
		&b.ID, &b.ProductID, &purchaseLineID, &b.ArrivalDate,
		&quantity, &originalQuantity, &unitCost, &exchangeRate,
		&status, &isClearance, &b.CreatedAt, &b.UpdatedAt,
	); err != nil {
		return nil, persistence.Translate(err)
	}
	if purchaseLineID.Valid {
		id := persistence.ParseUUID(purchaseLineID.String)
		b.PurchaseOrderItemID = &id
	}
	q, err := valueobjects.QuantityFromString(quantity)
	if err != nil {
		return nil, err
	}
	b.Quantity = q
	oq, err := valueobjects.QuantityFromString(originalQuantity)
	if err != nil {
		return nil, err
	}
	b.OriginalQuantity = oq
	if v, err := persistence.ParseMoney(unitCost); err != nil {
		return nil, err
	} else {
		b.UnitCost = v
	}
	if r, err := valueobjects.ExchangeRateFromString(exchangeRate); err != nil {
		return nil, err
	} else {
		b.ExchangeRate = r
	}
	b.Status = enums.BatchStatus(status)
	b.IsClearance = isClearance
	return b, nil
}
