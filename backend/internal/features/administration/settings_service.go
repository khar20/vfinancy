package administration

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"

	"vfinancy/backend/infrastructure/logger"
	derrors "vfinancy/backend/internal/domain/errors"
)

const keyPrefix = "preferences."

const (
	keyClearanceDays        = keyPrefix + "clearance_days"
	keyClearanceWarningDays = keyPrefix + "clearance_warning_days"
	keyImportCostFactor     = keyPrefix + "import_cost_factor"
	keyFallbackExchangeRate = keyPrefix + "fallback_exchange_rate"
	keyPurchaseLimitUSD     = keyPrefix + "purchase_limit_usd"
	keyBackupFolder         = keyPrefix + "backup_folder"
	keyBackupFrequency      = keyPrefix + "backup_frequency"
)

// SystemPreferences is the typed view of the stored device preferences.
type SystemPreferences struct {
	ClearanceDays        int
	ClearanceWarningDays int
	ImportCostFactor     float64
	FallbackExchangeRate float64
	PurchaseLimitUSD     float64
	BackupFolder         string
	BackupFrequency      string
}

type SettingsService struct {
	settings SettingRepository
	log      *logger.Logger
}

// NewSettingsService builds the settings service over the setting
// repository and the application logger.
func NewSettingsService(settings SettingRepository, log *logger.Logger) *SettingsService {
	if settings == nil {
		panic("administration: nil settings repository")
	}
	if log == nil {
		panic("administration: nil logger")
	}
	return &SettingsService{settings: settings, log: log}
}

// GetPreferences returns the stored preferences layered over their defaults.
func (s *SettingsService) GetPreferences(ctx context.Context) (*SystemPreferences, error) {
	prefs := &SystemPreferences{
		ClearanceDays:        25,
		ClearanceWarningDays: 3,
		ImportCostFactor:     0.07,
		FallbackExchangeRate: 3.75,
		PurchaseLimitUSD:     200,
		BackupFrequency:      "off",
	}
	settings, err := s.settings.List(ctx)
	if err != nil {
		return nil, err
	}
	for _, setting := range settings {
		switch setting.Key {
		case keyClearanceDays:
			prefs.ClearanceDays = setting.IntValue()
		case keyClearanceWarningDays:
			prefs.ClearanceWarningDays = setting.IntValue()
		case keyImportCostFactor:
			prefs.ImportCostFactor = setting.Float64Value()
		case keyFallbackExchangeRate:
			prefs.FallbackExchangeRate = setting.Float64Value()
		case keyPurchaseLimitUSD:
			prefs.PurchaseLimitUSD = setting.Float64Value()
		case keyBackupFolder:
			prefs.BackupFolder = setting.StringValue()
		case keyBackupFrequency:
			prefs.BackupFrequency = setting.StringValue()
		}
	}
	return prefs, nil
}

// UpdatePreference validates and stores one preference value. The key
// is the bare preference name; unknown keys are rejected.
func (s *SettingsService) UpdatePreference(ctx context.Context, key string, value interface{}) error {
	fullKey := keyPrefix + key
	switch fullKey {
	case keyClearanceDays:
		n, ok := coerceInt(value)
		if !ok || n < 1 || n > 365 {
			return derrors.New("INVALID", "clearance days must be between 1 and 365")
		}
		value = n
	case keyClearanceWarningDays:
		n, ok := coerceInt(value)
		if !ok || n < 0 {
			return derrors.New("INVALID", "clearance warning days must be zero or greater")
		}
		value = n
	case keyImportCostFactor:
		f, ok := coerceFloat(value)
		if !ok {
			return derrors.New("INVALID", "import cost factor must be a decimal number")
		}
		value = f
	case keyFallbackExchangeRate:
		f, ok := coerceFloat(value)
		if !ok || f < 0.01 || f > 100 {
			return derrors.New("INVALID", "fallback exchange rate must be between 0.01 and 100")
		}
		value = f
	case keyPurchaseLimitUSD:
		f, ok := coerceFloat(value)
		if !ok || f < 0 || f > 1_000_000 {
			return derrors.New("INVALID", "purchase limit must be between 0 and 1000000")
		}
		value = f
	case keyBackupFolder:
		str, ok := coerceString(value)
		if !ok {
			return derrors.New("INVALID", "backup folder must be a string")
		}
		value = str
	case keyBackupFrequency:
		str, ok := coerceString(value)
		if !ok || !allowedBackupFrequency(str) {
			return derrors.New("INVALID", "backup frequency must be one of: off, on_close, daily, weekly")
		}
		value = str
	default:
		return derrors.New("INVALID", "unknown preference: "+key)
	}

	jsonValue, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("administration: marshaling preference value: %w", err)
	}
	if err := s.settings.Upsert(ctx, NewApplicationSetting(fullKey, jsonValue)); err != nil {
		return err
	}
	s.log.InfoContext(ctx, "preference updated", "key", fullKey)
	return nil
}

// GetAllSettings returns every stored setting keyed by its full key.
func (s *SettingsService) GetAllSettings(ctx context.Context) (map[string]json.RawMessage, error) {
	settings, err := s.settings.List(ctx)
	if err != nil {
		return nil, err
	}
	result := make(map[string]json.RawMessage, len(settings))
	for _, setting := range settings {
		result[setting.Key] = setting.Value
	}
	return result, nil
}

// allowedBackupFrequency reports whether v is a supported backup schedule.
func allowedBackupFrequency(v string) bool {
	switch v {
	case "off", "on_close", "daily", "weekly":
		return true
	}
	return false
}

// coerceInt converts a string, int, or whole float to an int.
func coerceInt(value interface{}) (int, bool) {
	switch v := value.(type) {
	case int:
		return v, true
	case float64:
		return int(v), float64(int(v)) == v
	case string:
		n, err := strconv.Atoi(v)
		return n, err == nil
	default:
		return 0, false
	}
}

// coerceFloat converts a string, int, or float to a float64.
func coerceFloat(value interface{}) (float64, bool) {
	switch v := value.(type) {
	case int:
		return float64(v), true
	case float64:
		return v, true
	case string:
		f, err := strconv.ParseFloat(v, 64)
		return f, err == nil
	default:
		return 0, false
	}
}

// coerceString extracts a string value.
func coerceString(value interface{}) (string, bool) {
	v, ok := value.(string)
	return v, ok
}
