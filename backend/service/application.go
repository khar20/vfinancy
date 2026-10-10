package service

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"a/backend/backup"
	"a/backend/tc"
)

type Application struct {
	Core      *Core
	Catalog   *CatalogService
	Purchases *PurchaseService
	Inventory *InventoryService
	Sales     *SalesService
	Payments  *PaymentService
	Cards     *CardService
	Settings  *SettingsService
	Dashboard *DashboardService
	System    *SystemService
	cancel    context.CancelFunc
}

func NewApplication() *Application {
	c := NewCore()
	a := &Application{Core: c, Catalog: &CatalogService{c}, Purchases: &PurchaseService{c}, Inventory: &InventoryService{c}, Sales: &SalesService{c}, Payments: &PaymentService{c}, Cards: &CardService{c}, Settings: &SettingsService{core: c}, Dashboard: &DashboardService{c}, System: &SystemService{core: c}}
	a.System.restartRefresh = a.Startup
	a.System.stopRefresh = func() {
		if a.cancel != nil {
			a.cancel()
		}
	}
	a.Settings.stopRefresh = a.System.stopRefresh
	a.Settings.restartRefresh = a.Startup
	return a
}
func (a *Application) Bindings() []interface{} {
	return []interface{}{a.Catalog, a.Purchases, a.Inventory, a.Sales, a.Payments, a.Cards, a.Settings, a.Dashboard, a.System}
}
func (a *Application) OpenDefault() error {
	dir, err := os.UserConfigDir()
	if err != nil {
		return err
	}
	dir = filepath.Join(dir, "vfinancy")
	if err = os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	return a.Core.Open(filepath.Join(dir, "vfinancy.db"))
}
func (a *Application) Startup() {
	if a.cancel != nil {
		a.cancel()
	}
	db, err := a.Core.db()
	if err != nil {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	a.cancel = cancel
	go a.refreshTC(ctx, db)
}
func (a *Application) refreshTC(ctx context.Context, db *sql.DB) {
	nextRefresh := time.Now()
	lastFrequency := ""
	first := true
	for {
		var frequency string
		_ = db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key='tc_refresh'`).Scan(&frequency)
		interval := map[string]time.Duration{"1h": time.Hour, "6h": 6 * time.Hour, "12h": 12 * time.Hour, "24h": 24 * time.Hour}[frequency]
		if frequency != lastFrequency {
			if lastFrequency != "" && frequency != "manual" {
				nextRefresh = time.Now()
			}
			lastFrequency = frequency
		}
		if first || (!time.Now().Before(nextRefresh) && frequency != "manual") {
			if value, err := tc.Fetch(ctx); err == nil {
				_, _ = db.ExecContext(ctx, `INSERT INTO settings(key,value) VALUES('tc_last',?),('tc_last_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, fmt.Sprint(value), time.Now().UTC().Format(time.RFC3339))
			}
			first = false
			if interval > 0 {
				nextRefresh = time.Now().Add(interval)
			} else {
				nextRefresh = time.Now().AddDate(10, 0, 0)
			}
		}
		wait := time.Minute
		if frequency != "manual" && interval > 0 {
			wait = time.Until(nextRefresh)
			if wait > time.Minute {
				wait = time.Minute
			}
			if wait < 0 {
				wait = 0
			}
		}
		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}
func (a *Application) Shutdown() error {
	if a.cancel != nil {
		a.cancel()
	}
	var err error
	if db, e := a.Core.db(); e == nil {
		var date string
		_ = db.QueryRow(`SELECT value FROM settings WHERE key='last_backup_date'`).Scan(&date)
		if date != time.Now().Format("20060102") {
			var dir string
			_ = db.QueryRow(`SELECT value FROM settings WHERE key='backup_dir'`).Scan(&dir)
			if dir == "" {
				dir = filepath.Join(filepath.Dir(a.Core.dbPath), "backups")
			}
			keep := 14
			var keepText string
			if db.QueryRow(`SELECT value FROM settings WHERE key='backup_keep'`).Scan(&keepText) == nil {
				if parsed, e := strconv.Atoi(keepText); e == nil && parsed > 0 {
					keep = parsed
				}
			}
			if _, e = backup.Create(a.Core.dbPath, dir, keep); e == nil {
				_, _ = db.Exec(`INSERT INTO settings(key,value) VALUES('last_backup_date',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, time.Now().Format("20060102"))
			} else {
				err = e
			}
		}
	}
	if e := a.Core.Close(); err == nil {
		err = e
	}
	return err
}
