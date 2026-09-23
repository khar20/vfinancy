package bindings

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"time"

	"vfinancy/backend/infrastructure/config"
	"vfinancy/backend/infrastructure/database"
	"vfinancy/backend/infrastructure/logger"
	"vfinancy/backend/infrastructure/migrations"
	"vfinancy/backend/infrastructure/persistence"
	"vfinancy/backend/infrastructure/sqlite"
	"vfinancy/backend/internal/domain/valueobjects"
	"vfinancy/backend/internal/features/administration"
	adminpostgres "vfinancy/backend/internal/features/administration/postgres"
	"vfinancy/backend/internal/features/customer"
	customerpostgres "vfinancy/backend/internal/features/customer/postgres"
	"vfinancy/backend/internal/features/inventory"
	inventorypostgres "vfinancy/backend/internal/features/inventory/postgres"
	"vfinancy/backend/internal/features/product"
	productpostgres "vfinancy/backend/internal/features/product/postgres"
	"vfinancy/backend/internal/features/purchasing"
	purchasingpostgres "vfinancy/backend/internal/features/purchasing/postgres"
	"vfinancy/backend/internal/features/sales"
	salespostgres "vfinancy/backend/internal/features/sales/postgres"
	"vfinancy/backend/internal/features/shipment"
	shipmentpostgres "vfinancy/backend/internal/features/shipment/postgres"
	"vfinancy/backend/internal/features/supplier"
	supplierpostgres "vfinancy/backend/internal/features/supplier/postgres"
	"vfinancy/backend/internal/features/sync"
	syncpostgres "vfinancy/backend/internal/features/sync/postgres"
	"vfinancy/backend/internal/features/treasury"
	treasurypostgres "vfinancy/backend/internal/features/treasury/postgres"
	"vfinancy/backend/internal/features/workspace"
	workspacepostgres "vfinancy/backend/internal/features/workspace/postgres"
)

// App is the struct bound to the Wails frontend. Exported methods form
// the whole JavaScript-callable API.
type App struct {
	ctx context.Context
	db  *database.DB
	cfg *config.Config
	log *logger.Logger

	sqliteMigrationsFS fs.FS
	pgMigrationsFS     fs.FS

	workspaceSvc  *workspace.Service
	settingsSvc   *administration.SettingsService
	treasurySvc   *treasury.TreasuryService
	salesSvc      *sales.SalesService
	inventorySvc  *inventory.InventoryService
	purchasingSvc *purchasing.PurchasingService
	customersSvc  *customer.CustomerService
	productsSvc   *product.ProductService
	suppliersSvc  *supplier.Service
	syncSvc       *sync.Service
	shipmentSvc   *shipment.ShipmentService

	clearanceCancel context.CancelFunc
	syncCancel      context.CancelFunc
	backupCancel    context.CancelFunc
}

// New builds the binding container. The migration filesystems are the
// embedded local (SQLite) and mirror (PostgreSQL) schema sets.
func New(cfg *config.Config, log *logger.Logger, sqliteMigrationsFS, pgMigrationsFS fs.FS) *App {
	return &App{cfg: cfg, log: log, sqliteMigrationsFS: sqliteMigrationsFS, pgMigrationsFS: pgMigrationsFS}
}

// Startup captures the Wails runtime context.
func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx
}

// Shutdown stops the workers and closes the local database. The
// on-close backup runs before the connection drops.
func (a *App) Shutdown(ctx context.Context) {
	a.stopWorkers()
	a.backupOnClose()
	a.closeSync()
	if a.db != nil {
		_ = a.db.Close()
	}
}

// Context returns the runtime context, cancelled while the local
// profile is locked so every gated binding fails fast.
func (a *App) Context() context.Context {
	ctx := a.rawContext()
	if a.workspaceSvc != nil && !a.workspaceSvc.IsUnlocked() {
		locked, cancel := context.WithCancel(ctx)
		cancel()
		return locked
	}
	return ctx
}

func (a *App) rawContext() context.Context {
	if a.ctx == nil {
		return context.Background()
	}
	return a.ctx
}

// Init opens the local database, migrates, wires the services and
// starts the background workers.
func (a *App) Init() error {
	ctx := a.Context()

	if a.cfg.Database.Driver != "sqlite" {
		return fmt.Errorf("bindings: DB_DRIVER must be sqlite for the desktop runtime, got %q", a.cfg.Database.Driver)
	}
	if err := a.openDB(); err != nil {
		return err
	}
	if err := a.initializeServices(ctx); err != nil {
		return err
	}

	a.startClearanceWorker(ctx)
	a.startSyncWorker()
	a.startBackupWorker(ctx)

	a.log.Info("bindings initialized")
	return nil
}

func (a *App) openDB() error {
	db, err := sqlite.Open(a.cfg.Database.Path, database.Options{
		MaxOpenConns:    a.cfg.Database.MaxOpen,
		MaxIdleConns:    a.cfg.Database.MaxIdle,
		ConnMaxLifetime: a.cfg.Database.MaxLifetime,
	})
	if err != nil {
		return fmt.Errorf("connect sqlite: %w", err)
	}
	a.db = db
	persistence.SetDialect(persistence.DialectSQLite)

	runner := migrations.NewRunnerFS(a.sqliteMigrationsFS, db.DB, a.log, "sqlite")
	if err := runner.Up(a.rawContext()); err != nil {
		a.log.Error("migrate failed; continuing with degraded schema", "error", err.Error())
	}
	return nil
}

func (a *App) initializeServices(ctx context.Context) error {
	db := a.db
	txm := persistence.NewTxManager(db)

	settingsRepo := adminpostgres.NewSettingRepository(db.DB)
	a.workspaceSvc = workspace.NewService(workspacepostgres.NewRepository(db.DB), txm)
	if _, err := a.workspaceSvc.Initialize(ctx); err != nil && !errors.Is(err, workspace.ErrProfileNotFound) {
		a.log.Warn("load local profile failed; starting unconfigured", "error", err.Error())
	}
	a.settingsSvc = administration.NewSettingsService(settingsRepo, a.log)

	customersRepo := customerpostgres.NewCustomerRepository(db.DB)
	productsRepo := productpostgres.NewProductRepository(db.DB)
	cardsRepo := treasurypostgres.NewCreditCardRepository(db.DB)
	ratesRepo := treasurypostgres.NewExchangeRateRepository(db.DB)
	batchesRepo := inventorypostgres.NewInventoryBatchRepository(db.DB)
	movementsRepo := inventorypostgres.NewInventoryMovementRepository(db.DB)
	ordersRepo := salespostgres.NewSaleRepository(db.DB)
	paymentsRepo := salespostgres.NewCustomerPaymentRepository(db.DB)
	purchaseRepo := purchasingpostgres.NewPurchaseRepository(db.DB)
	suppliersRepo := supplierpostgres.NewSupplierRepository(db.DB)

	a.customersSvc = customer.NewService(customersRepo, txm, a.log)
	a.productsSvc = product.NewService(productsRepo, txm, a.log)
	a.inventorySvc = inventory.New(batchesRepo, movementsRepo, txm, a.log)
	a.inventorySvc.SetClearanceSettings(a.clearanceSettings)
	a.treasurySvc = treasury.New(cardsRepo, ratesRepo, txm, a.log)
	a.treasurySvc.SetFallbackRate(a.fallbackRate)
	a.suppliersSvc = supplier.NewService(suppliersRepo, txm, a.log)
	a.purchasingSvc = purchasing.New(purchaseRepo, a.inventorySvc, txm, a.log)
	a.purchasingSvc.SetSuppliers(a.suppliersSvc)
	a.purchasingSvc.SetProducts(a.productsSvc, a.productsSvc)
	a.purchasingSvc.SetTreasury(a.treasurySvc)
	a.purchasingSvc.SetImportFactor(a.importFactor)
	a.purchasingSvc.SetRateProvider(a.usdPenRate)
	a.salesSvc = sales.New(ordersRepo, paymentsRepo, a.customersSvc, a.productsSvc, a.inventorySvc, a.purchasingSvc, txm, a.log)
	a.salesSvc.SetClientOrderRateProvider(a.usdPenRate)

	a.shipmentSvc = shipment.New(shipmentpostgres.NewShipmentRepository(db.DB), txm, a.log)

	return nil
}

// usdPenRate resolves the latest USD->PEN rate with a fallback to 1
// when no rate is available. It seeds client-order cost snapshots and
// the exchange-rate snapshot of purchase extra costs.
func (a *App) usdPenRate(ctx context.Context) valueobjects.ExchangeRate {
	usd, err := valueobjects.NewCurrencyCode("USD")
	if err != nil {
		return valueobjects.One()
	}
	pen, err := valueobjects.NewCurrencyCode("PEN")
	if err != nil {
		return valueobjects.One()
	}
	info, err := a.treasurySvc.LatestExchangeRate(ctx, usd, pen)
	if err != nil {
		return valueobjects.One()
	}
	rate, err := valueobjects.ExchangeRateFromDecimal(info.Rate.Decimal())
	if err != nil {
		return valueobjects.One()
	}
	return rate
}

func (a *App) stopWorkers() {
	if a.clearanceCancel != nil {
		a.clearanceCancel()
		a.clearanceCancel = nil
	}
	if a.backupCancel != nil {
		a.backupCancel()
		a.backupCancel = nil
	}
}

func (a *App) closeSync() {
	if a.syncCancel != nil {
		a.syncCancel()
		a.syncCancel = nil
	}
	if a.syncSvc != nil {
		a.syncSvc.Close()
		a.syncSvc = nil
	}
}

// clearanceSettings resolves the configured days-for-clearance and the
// early-warning window.
func (a *App) clearanceSettings(ctx context.Context) (int, int) {
	prefs, err := a.settingsSvc.GetPreferences(ctx)
	if err != nil {
		return 25, 3
	}
	return prefs.ClearanceDays, prefs.ClearanceWarningDays
}

func (a *App) fallbackRate(ctx context.Context) float64 {
	prefs, err := a.settingsSvc.GetPreferences(ctx)
	if err != nil {
		return 3.75
	}
	return prefs.FallbackExchangeRate
}

func (a *App) importFactor(ctx context.Context) float64 {
	prefs, err := a.settingsSvc.GetPreferences(ctx)
	if err != nil {
		return 0.07
	}
	return prefs.ImportCostFactor
}

// startClearanceWorker reconciles the persisted clearance flags on a
// ticker so badges stay current without a full app reload.
func (a *App) startClearanceWorker(ctx context.Context) {
	wctx, cancel := context.WithCancel(ctx)
	a.clearanceCancel = cancel
	go func() {
		run := func() {
			if a.workspaceSvc == nil || !a.workspaceSvc.IsUnlocked() {
				return
			}
			if _, err := a.inventorySvc.RefreshClearanceFlags(wctx, time.Now().UTC()); err != nil {
				a.log.Warn("clearance refresh failed", "error", err.Error())
			}
		}
		run()
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-wctx.Done():
				return
			case <-ticker.C:
				run()
			}
		}
	}()
}

// startSyncWorker launches the background replication loop when sync
// is enabled (env or the runtime settings file). Best-effort: failures
// are logged and retried on the next tick.
func (a *App) startSyncWorker() {
	a.closeSync()
	cfg, err := a.effectiveSyncConfig()
	if err != nil {
		a.log.Warn("sync config invalid; worker not started", "error", err.Error())
		return
	}
	if !cfg.Enabled || cfg.DSN() == "" {
		return
	}
	a.syncSvc = sync.NewService(
		syncpostgres.NewLocal(a.db.DB),
		syncpostgres.NewRemote(cfg.DSN(), a.log),
		sync.Config{Enabled: true, DSN: cfg.DSN(), PollInterval: cfg.PollInterval, MigrationsFS: a.pgMigrationsFS},
		a.log.Logger,
	)
	wctx, cancel := context.WithCancel(a.rawContext())
	a.syncCancel = cancel
	go func() {
		run := func() {
			if err := a.syncSvc.RunOnce(wctx); err != nil {
				a.log.Warn("sync: run failed", "error", err.Error())
			}
		}
		run()
		ticker := time.NewTicker(cfg.PollInterval)
		defer ticker.Stop()
		for {
			select {
			case <-wctx.Done():
				return
			case <-ticker.C:
				run()
			}
		}
	}()
	a.log.Info("sync worker started", "interval", cfg.PollInterval.String())
}
