package service

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"a/backend/tc"
)

type SettingsService struct {
	core           *Core
	stopRefresh    func()
	restartRefresh func()
}

func (s *SettingsService) GetSettings() (map[string]string, error) {
	db, e := s.core.check()
	if e != nil {
		return nil, e
	}
	rows, e := db.Query(`SELECT key,value FROM settings ORDER BY key`)
	if e != nil {
		return nil, e
	}
	out := map[string]string{}
	for rows.Next() {
		var k, v string
		if e = rows.Scan(&k, &v); e != nil {
			return nil, e
		}
		if k != "password_hash" {
			out[k] = v
		}
	}
	rowsErr := rows.Err()
	if e = rows.Close(); e != nil {
		return nil, e
	}
	var hash string
	_ = db.QueryRow(`SELECT value FROM settings WHERE key='password_hash'`).Scan(&hash)
	out["has_password"] = strconv.FormatBool(hash != "")
	return out, rowsErr
}
func (s *SettingsService) SetSetting(key, value string) error {
	db, e := s.core.check()
	if e != nil {
		return e
	}
	allowed := map[string]bool{"theme": true, "display_currency": true, "tc_fallback": true, "tc_refresh": true, "lot_countdown_days": true, "overdue_days": true, "backup_dir": true, "backup_keep": true, "last_payment_method": true}
	if !allowed[key] {
		return fmt.Errorf("setting %q cannot be changed through this method", key)
	}
	switch key {
	case "display_currency":
		if value != "PEN" && value != "USD" {
			return fmt.Errorf("display_currency must be PEN or USD")
		}
	case "theme":
		if value != "light" && value != "dark" && value != "system" {
			return fmt.Errorf("theme must be light, dark, or system")
		}
	case "tc_refresh":
		if value != "manual" && value != "1h" && value != "6h" && value != "12h" && value != "24h" {
			return fmt.Errorf("tc_refresh must be manual, 1h, 6h, 12h, or 24h")
		}
	case "last_payment_method":
		if value != "card" && value != "cash" && value != "wallet" {
			return fmt.Errorf("last_payment_method must be card, cash, or wallet")
		}
	case "tc_fallback":
		n, err := strconv.ParseInt(value, 10, 64)
		if err != nil || n < 5000 || n > 200000 {
			return fmt.Errorf("tc_fallback must be between 5000 and 200000")
		}
	case "lot_countdown_days", "overdue_days", "backup_keep":
		n, err := strconv.Atoi(value)
		if err != nil || n < 0 || key == "backup_keep" && n < 1 {
			return fmt.Errorf("%s must be a valid non-negative integer", key)
		}
	}
	_, e = db.Exec(`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value)
	if e == nil && key == "tc_refresh" && s.restartRefresh != nil {
		if s.stopRefresh != nil {
			s.stopRefresh()
		}
		s.restartRefresh()
	}
	return e
}
func (s *SettingsService) ConfigurePassword(password string, remember bool) error {
	db, e := s.core.check()
	if e != nil {
		return e
	}
	hash := ""
	if password != "" {
		hash = secureHash(password)
		if hash == "" {
			return fmt.Errorf("could not create password hash")
		}
	}
	r := "false"
	if remember {
		r = "true"
	}
	if _, e = db.Exec(`INSERT INTO settings(key,value) VALUES('password_hash',?),('remember_me',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, hash, r); e != nil {
		return e
	}
	s.core.SetLocked(false)
	return nil
}
func (s *SettingsService) SetRememberMe(remember bool) error {
	db, e := s.core.check()
	if e != nil {
		return e
	}
	var hash string
	if e = db.QueryRow(`SELECT value FROM settings WHERE key='password_hash'`).Scan(&hash); e != nil {
		return e
	}
	if hash == "" && remember {
		return fmt.Errorf("remember_me requires a configured password")
	}
	value := strconv.FormatBool(remember)
	_, e = db.Exec(`INSERT INTO settings(key,value) VALUES('remember_me',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, value)
	return e
}
func (s *SettingsService) Lock() error {
	db, e := s.core.db()
	if e != nil {
		return e
	}
	var hash string
	if e = db.QueryRow(`SELECT value FROM settings WHERE key='password_hash'`).Scan(&hash); e != nil {
		return e
	}
	if hash == "" {
		return fmt.Errorf("a password must be configured before locking")
	}
	s.core.SetLocked(true)
	return nil
}
func (s *SettingsService) Unlock(password string) error {
	if !s.core.passwordMatches(password) {
		return fmt.Errorf("password: incorrect password")
	}
	db, e := s.core.db()
	if e != nil {
		return e
	}
	var remember string
	_ = db.QueryRow(`SELECT value FROM settings WHERE key='remember_me'`).Scan(&remember)
	if _, e = db.Exec(`INSERT INTO settings(key,value) VALUES('remember_me',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, remember); e != nil {
		return e
	}
	s.core.SetLocked(false)
	return nil
}
func (s *SettingsService) IsLocked() bool { return s.core.IsLocked() }
func (s *SettingsService) PasswordSecurityNotice() string {
	return "The database and backups are not encrypted."
}
func (s *SettingsService) FetchTC() (int64, error) {
	if _, err := s.core.check(); err != nil {
		return 0, err
	}
	return tc.Fetch(context.Background())
}
func (s *SettingsService) DefaultTC() (int64, error) {
	db, e := s.core.check()
	if e != nil {
		return 0, e
	}
	return defaultTC(db)
}
func (s *SettingsService) SetRefreshFrequency(value string) error {
	return s.SetSetting("tc_refresh", strings.TrimSpace(value))
}
