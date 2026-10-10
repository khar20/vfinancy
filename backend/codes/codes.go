package codes

import (
	"context"
	"crypto/rand"
	"fmt"
	"math/big"
	"regexp"
	"strings"

	"database/sql"
)

var codePattern = regexp.MustCompile(`^([A-Z]+)-([0-9]+)$`)

func Next(ctx context.Context, db *sql.DB, entity string) (string, error) {
	return NextUsing(ctx, db, entity)
}

func NextTx(ctx context.Context, tx *sql.Tx, entity string) (string, error) {
	return NextUsing(ctx, tx, entity)
}

type rowQueryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func NextUsing(ctx context.Context, db rowQueryer, entity string) (string, error) {
	prefix, ok := prefixes[strings.ToLower(entity)]
	if !ok {
		return "", fmt.Errorf("unknown entity %q", entity)
	}
	var n int64
	err := db.QueryRowContext(ctx, `SELECT last+1 FROM sequences WHERE prefix=?`, prefix).Scan(&n)
	if err == sql.ErrNoRows {
		n = 1
	} else if err != nil {
		return "", err
	}
	return fmt.Sprintf("%s-%04d", prefix, n), nil
}

func Bump(ctx context.Context, tx *sql.Tx, code string) error {
	m := codePattern.FindStringSubmatch(code)
	if m == nil {
		return nil
	}
	var n int64
	if _, err := fmt.Sscanf(m[2], "%d", &n); err != nil {
		return nil
	}
	_, err := tx.ExecContext(ctx, `INSERT INTO sequences(prefix,last) VALUES(?,?) ON CONFLICT(prefix) DO UPDATE SET last=MAX(last,excluded.last)`, m[1], n)
	return err
}

func SecurityCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(10000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%04d", n.Int64()), nil
}

var prefixes = map[string]string{"purchase": "C", "purchases": "C", "sale": "V", "sales": "V", "shipment": "E", "shipments": "E", "lot": "L", "lots": "L", "product": "P", "products": "P", "payment": "R", "payments": "R", "receipt": "R"}
