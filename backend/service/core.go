package service

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"a/backend/codes"
	"a/backend/money"
	"a/backend/store"
	"golang.org/x/crypto/argon2"
)

var ErrLocked = errors.New("application is locked")

type FieldError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}
type ValidationError struct {
	Fields []FieldError `json:"fields"`
}

func (e ValidationError) Error() string {
	data, err := json.Marshal(e.Fields)
	if err != nil {
		return "validation failed"
	}
	return string(data)
}

type Core struct {
	mu     sync.RWMutex
	Store  *store.Store
	locked bool
	dbPath string
}

func NewCore() *Core { return &Core{} }
func (c *Core) Open(path string) error {
	s, err := store.Open(path)
	if err != nil {
		return err
	}
	c.mu.Lock()
	c.Store = s
	c.dbPath = path
	c.mu.Unlock()
	var hash, remember string
	_ = s.DB.QueryRow(`SELECT value FROM settings WHERE key='password_hash'`).Scan(&hash)
	_ = s.DB.QueryRow(`SELECT value FROM settings WHERE key='remember_me'`).Scan(&remember)
	c.mu.Lock()
	c.locked = hash != "" && remember != "true"
	c.mu.Unlock()
	if _, err := s.DB.Exec(`INSERT OR IGNORE INTO settings(key,value) VALUES ('tc_fallback','37500'),('tc_refresh','6h'),('display_currency','PEN'),('theme','system'),('remember_me','false'),('lot_countdown_days','0'),('overdue_days','30'),('backup_keep','14'),('last_payment_method','cash'),('backup_dir',?)`, filepath.Join(filepath.Dir(path), "backups")); err != nil {
		return err
	}
	return nil
}
func (c *Core) Close() error {
	c.mu.RLock()
	s := c.Store
	c.mu.RUnlock()
	if s == nil {
		return nil
	}
	return s.Close()
}
func (c *Core) db() (*sql.DB, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.Store == nil {
		return nil, errors.New("database is not initialized")
	}
	return c.Store.DB, nil
}
func (c *Core) check() (*sql.DB, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.locked {
		return nil, ErrLocked
	}
	if c.Store == nil {
		return nil, errors.New("database is not initialized")
	}
	return c.Store.DB, nil
}
func (c *Core) SetLocked(v bool) { c.mu.Lock(); c.locked = v; c.mu.Unlock() }
func (c *Core) IsLocked() bool   { c.mu.RLock(); defer c.mu.RUnlock(); return c.locked }

func now() string   { return time.Now().UTC().Format(time.RFC3339) }
func today() string { return time.Now().Format("2006-01-02") }
func validateDate(field, value string) error {
	if _, err := time.Parse("2006-01-02", value); err != nil {
		return ValidationError{Fields: []FieldError{{field, "Date must use YYYY-MM-DD"}}}
	}
	return nil
}
func multiplyMoney(qty, unit int64) (int64, error) {
	if qty < 0 || unit < 0 || unit > int64(money.Max) {
		return 0, fmt.Errorf("quantity and unit amount are outside supported limits")
	}
	max := int64(^uint64(0) >> 1)
	if qty != 0 && unit > max/qty {
		return 0, fmt.Errorf("amount overflow")
	}
	return qty * unit, nil
}
func sumMoney(total, amount int64) (int64, error) {
	max := int64(^uint64(0) >> 1)
	if amount > 0 && total > max-amount {
		return 0, fmt.Errorf("amount overflow")
	}
	if amount < 0 && total < (-max-1)-amount {
		return 0, fmt.Errorf("amount overflow")
	}
	return total + amount, nil
}
func validateMoney(field string, amount int64, currency string, tc int64) []FieldError {
	var out []FieldError
	if amount < 0 || amount > int64(money.Max) {
		out = append(out, FieldError{field, "Amount must be between 0 and 99,999,999.99"})
	}
	if !money.Currency(currency).Valid() {
		out = append(out, FieldError{field + "Currency", "Currency must be PEN or USD"})
	}
	if tc < 5000 || tc > 200000 {
		out = append(out, FieldError{"tc", "Exchange rate must be between 0.5000 and 20.0000"})
	}
	return out
}
func validation(errs []FieldError) error {
	if len(errs) == 0 {
		return nil
	}
	return ValidationError{Fields: errs}
}
func constraintError(field string, err error) error {
	if err != nil && strings.Contains(strings.ToLower(err.Error()), "unique constraint failed") {
		return ValidationError{Fields: []FieldError{{field, "This value is already in use"}}}
	}
	return err
}
func requireText(field, value string) error {
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("%s: required", field)
	}
	return nil
}
func secureHash(password string) string {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return ""
	}
	h := argon2.IDKey([]byte(password), salt, 2, 32*1024, 1, 32)
	return fmt.Sprintf("argon2id$v=19$m=32768,t=2,p=1$%s$%s", hex.EncodeToString(salt), hex.EncodeToString(h))
}
func (c *Core) passwordMatches(password string) bool {
	db, err := c.db()
	if err != nil {
		return false
	}
	var hash string
	if db.QueryRow(`SELECT value FROM settings WHERE key='password_hash'`).Scan(&hash) != nil || hash == "" {
		return false
	}
	parts := strings.Split(hash, "$")
	if len(parts) != 5 {
		return false
	}
	salt, e1 := hex.DecodeString(parts[3])
	expected, e2 := hex.DecodeString(parts[4])
	if e1 != nil || e2 != nil {
		return false
	}
	actual := argon2.IDKey([]byte(password), salt, 2, 32*1024, 1, uint32(len(expected)))
	return subtle.ConstantTimeCompare(actual, expected) == 1
}
func nextCode(ctx context.Context, db *sql.DB, entity string) (string, error) {
	return codes.Next(ctx, db, entity)
}

func bumpCodeDB(ctx context.Context, db *sql.DB, code string) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err = codes.Bump(ctx, tx, code); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}
func defaultTC(db *sql.DB) (int64, error) {
	var last string
	if err := db.QueryRow(`SELECT value FROM settings WHERE key='tc_last'`).Scan(&last); err == nil {
		if value, e := strconv.ParseInt(last, 10, 64); e == nil && value >= 5000 && value <= 200000 {
			return value, nil
		}
	}
	var fallback int64
	if err := db.QueryRow(`SELECT CAST(value AS INTEGER) FROM settings WHERE key='tc_fallback'`).Scan(&fallback); err != nil {
		return 0, err
	}
	if fallback < 5000 || fallback > 200000 {
		return 0, fmt.Errorf("configured fallback exchange rate is invalid")
	}
	return fallback, nil
}

type Filter struct {
	Field string `json:"field"`
	Op    string `json:"op"`
	Value any    `json:"value"`
	End   any    `json:"end,omitempty"`
}
type ListQuery struct {
	Filters         []Filter `json:"filters"`
	DisplayCurrency string   `json:"displayCurrency"`
	MonthsLimit     int      `json:"monthsLimit"`
	CursorMonth     string   `json:"cursorMonth"`
}
type MonthGroup struct {
	Month string           `json:"month"`
	Count int              `json:"count"`
	Total int64            `json:"total"`
	Rows  []map[string]any `json:"rows"`
}
type Page struct {
	Months     []MonthGroup `json:"months"`
	NextCursor string       `json:"nextCursor,omitempty"`
}

func (c *Core) rows(query string, args ...any) ([]map[string]any, error) {
	db, err := c.check()
	if err != nil {
		return nil, err
	}
	rs, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rs.Close()
	cols, err := rs.Columns()
	if err != nil {
		return nil, err
	}
	out := []map[string]any{}
	for rs.Next() {
		vals := make([]any, len(cols))
		ptr := make([]any, len(cols))
		for i := range vals {
			ptr[i] = &vals[i]
		}
		if err := rs.Scan(ptr...); err != nil {
			return nil, err
		}
		row := map[string]any{}
		for i, k := range cols {
			switch v := vals[i].(type) {
			case []byte:
				row[k] = string(v)
			default:
				row[k] = v
			}
		}
		out = append(out, row)
	}
	return out, rs.Err()
}
