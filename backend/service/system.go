package service

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"

	"a/backend/backup"
)

type SystemService struct {
	core           *Core
	restartRefresh func()
	stopRefresh    func()
}

func (s *SystemService) BackupNow() (string, error) {
	db, e := s.core.check()
	if e != nil {
		return "", e
	}
	dir := ""
	_ = db.QueryRow(`SELECT value FROM settings WHERE key='backup_dir'`).Scan(&dir)
	if dir == "" {
		dir = filepath.Join(filepath.Dir(s.core.dbPath), "backups")
	}
	keep := 14
	var setting string
	if db.QueryRow(`SELECT value FROM settings WHERE key='backup_keep'`).Scan(&setting) == nil {
		if n, err := strconv.Atoi(setting); err == nil && n > 0 {
			keep = n
		}
	}
	return backup.Create(s.core.dbPath, dir, keep)
}
func (s *SystemService) RestoreBackup(path string) error {
	if s.core.IsLocked() {
		return ErrLocked
	}
	s.core.mu.Lock()
	dbpath := s.core.dbPath
	st := s.core.Store
	s.core.mu.Unlock()
	if dbpath == "" || st == nil {
		return fmt.Errorf("database is not initialized")
	}
	if s.stopRefresh != nil {
		s.stopRefresh()
	}
	if err := st.Close(); err != nil {
		return err
	}
	if err := backup.Restore(dbpath, path); err != nil {
		reopenErr := s.core.Open(dbpath)
		if reopenErr != nil {
			return fmt.Errorf("restore failed: %v; database reopen failed: %w", err, reopenErr)
		}
		if s.restartRefresh != nil {
			s.restartRefresh()
		}
		return err
	}
	if err := s.core.Open(dbpath); err != nil {
		return err
	}
	if s.restartRefresh != nil {
		s.restartRefresh()
	}
	return nil
}
func (s *SystemService) ListBackups() ([]string, error) {
	db, e := s.core.check()
	if e != nil {
		return nil, e
	}
	var dir string
	_ = db.QueryRow(`SELECT value FROM settings WHERE key='backup_dir'`).Scan(&dir)
	if dir == "" {
		dir = filepath.Join(filepath.Dir(s.core.dbPath), "backups")
	}
	entries, e := os.ReadDir(dir)
	if os.IsNotExist(e) {
		return []string{}, nil
	}
	if e != nil {
		return nil, e
	}
	out := []string{}
	for _, entry := range entries {
		if !entry.IsDir() && filepath.Ext(entry.Name()) == ".db" {
			out = append(out, filepath.Join(dir, entry.Name()))
		}
	}
	return out, nil
}
