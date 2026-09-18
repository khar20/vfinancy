package sync

import (
	"fmt"
	"strings"
)

// TableMeta describes one replicated table: its primary key, the
// column that carries the last-writer-wins timestamp, and the columns
// whose values need cross-engine coercion (booleans stored as integers
// on SQLite, DATE values scanned as timestamps by both drivers).
type TableMeta struct {
	Name       string
	PKs        []string
	TimeColumn string
	Bools      []string
	Dates      []string
}

var syncedTables = []TableMeta{
	{Name: "application_settings", PKs: []string{"id"}, TimeColumn: "updated_at"},
	{Name: "exchange_rates", PKs: []string{"id"}, TimeColumn: "created_at", Dates: []string{"rate_date"}},
	{Name: "customers", PKs: []string{"id"}, TimeColumn: "updated_at"},
	{Name: "products", PKs: []string{"id"}, TimeColumn: "updated_at", Bools: []string{"is_active"}},
	{Name: "credit_cards", PKs: []string{"id"}, TimeColumn: "updated_at", Bools: []string{"is_active"}},
	{Name: "suppliers", PKs: []string{"id"}, TimeColumn: "updated_at", Bools: []string{"is_active"}},
	{Name: "purchase_orders", PKs: []string{"id"}, TimeColumn: "updated_at", Bools: []string{"faulty"}},
	{Name: "purchase_order_items", PKs: []string{"id"}, TimeColumn: "created_at"},
	{Name: "inventory_batches", PKs: []string{"id"}, TimeColumn: "updated_at", Bools: []string{"is_clearance"}},
	{Name: "inventory_movements", PKs: []string{"id"}, TimeColumn: "created_at"},
	{Name: "sales", PKs: []string{"id"}, TimeColumn: "updated_at"},
	{Name: "sale_items", PKs: []string{"id"}, TimeColumn: "created_at"},
	{Name: "customer_payments", PKs: []string{"id"}, TimeColumn: "updated_at"},
	{Name: "customer_payment_allocations", PKs: []string{"id"}, TimeColumn: "created_at"},
	{Name: "shipments", PKs: []string{"id"}, TimeColumn: "updated_at"},
}

// SyncedTables returns the replicated tables in FK-safe order:
// referenced tables before referencing ones.
func SyncedTables() []TableMeta {
	return syncedTables
}

func (m TableMeta) singlePK() bool {
	return len(m.PKs) == 1
}

// IsBoolCol reports whether col holds a boolean that SQLite stores as
// an integer.
func (m TableMeta) IsBoolCol(col string) bool {
	for _, c := range m.Bools {
		if c == col {
			return true
		}
	}
	return false
}

// IsDateCol reports whether col holds a DATE value.
func (m TableMeta) IsDateCol(col string) bool {
	for _, c := range m.Dates {
		if c == col {
			return true
		}
	}
	return false
}

// PKOf renders the primary key of row as the opaque record id used in
// sync_tombstones: the bare value for single-column keys, colon-joined
// values for composite keys.
func (m TableMeta) PKOf(row map[string]any) (string, error) {
	vals := make([]string, 0, len(m.PKs))
	for _, c := range m.PKs {
		v, ok := row[c]
		if !ok || v == nil {
			return "", fmt.Errorf("sync: %s: row has no pk column %q", m.Name, c)
		}
		s, ok := v.(string)
		if !ok {
			return "", fmt.Errorf("sync: %s: pk column %q is %T, want string", m.Name, c, v)
		}
		vals = append(vals, s)
	}
	return strings.Join(vals, ":"), nil
}

// PKArgs splits an opaque record id back into primary-key values in
// PKs order.
func (m TableMeta) PKArgs(id string) []string {
	if m.singlePK() {
		return []string{id}
	}
	return strings.SplitN(id, ":", len(m.PKs))
}
