package backup

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

func Create(dbPath, dir string, keep int) (string, error) {
	if keep < 1 {
		keep = 14
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return "", err
	}
	defer db.Close()
	if _, err = db.Exec(`PRAGMA busy_timeout=5000`); err != nil {
		return "", err
	}
	stamp := time.Now()
	dst := filepath.Join(dir, "vfinancy-"+stamp.Format("20060102-1504")+".db")
	for n := 0; ; n++ {
		if _, err := os.Stat(dst); os.IsNotExist(err) {
			break
		}
		stamp = stamp.Add(time.Minute)
		dst = filepath.Join(dir, "vfinancy-"+stamp.Format("20060102-1504")+".db")
		if n >= 1440 {
			return "", fmt.Errorf("no free backup filename")
		}
	}
	escaped := strings.ReplaceAll(dst, "'", "''")
	if _, err = db.Exec(`VACUUM INTO '` + escaped + `'`); err != nil {
		return "", err
	}
	if err = os.Chmod(dst, 0600); err != nil {
		return "", err
	}
	if err = Prune(dir, keep); err != nil {
		return dst, err
	}
	return dst, nil
}
func Prune(dir string, keep int) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	paths := []string{}
	for _, e := range entries {
		if !e.IsDir() && strings.HasPrefix(e.Name(), "vfinancy-") && strings.HasSuffix(e.Name(), ".db") {
			paths = append(paths, filepath.Join(dir, e.Name()))
		}
	}
	sort.Sort(sort.Reverse(sort.StringSlice(paths)))
	if len(paths) > keep {
		for _, p := range paths[keep:] {
			if err := os.Remove(p); err != nil {
				return fmt.Errorf("remove old backup %s: %w", p, err)
			}
		}
	}
	return nil
}
func Restore(dbPath, source string) error {
	info, err := os.Stat(source)
	if err != nil {
		return err
	}
	if info.IsDir() {
		return fmt.Errorf("backup source is not a file")
	}
	check, err := sql.Open("sqlite", source)
	if err != nil {
		return err
	}
	var integrity string
	err = check.QueryRow(`PRAGMA quick_check`).Scan(&integrity)
	closeErr := check.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if integrity != "ok" {
		return fmt.Errorf("backup failed SQLite integrity check")
	}
	if _, err = Create(dbPath, filepath.Dir(dbPath), 14); err != nil {
		return fmt.Errorf("create safety backup: %w", err)
	}
	tmp := dbPath + ".restore.tmp"
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	if _, err = out.ReadFrom(in); err != nil {
		out.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err = out.Sync(); err != nil {
		out.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err = out.Close(); err != nil {
		return err
	}
	old := dbPath + ".restore.old"
	_ = os.Remove(old)
	if err = os.Rename(dbPath, old); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if err = os.Rename(tmp, dbPath); err != nil {
		_ = os.Remove(tmp)
		_ = os.Rename(old, dbPath)
		return err
	}
	_ = os.Remove(old)
	return nil
}
