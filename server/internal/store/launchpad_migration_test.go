package store

import (
	"context"
	"database/sql"
	"strings"
	"testing"
)

// Existing Buildspace rows move into a generated "Cohort 1"; history stays private except
// builders' own weekly updates and absences; the cohort triggers guard new rows.
func TestLaunchpadCohortMigrationBackfillsAndGuards(t *testing.T) {
	path := t.TempDir() + "/upgrade.db"
	db, err := sql.Open(driverName, "file:"+path+"?_foreign_keys=on")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	defer db.Close()
	must := func(s string, args ...any) {
		t.Helper()
		if _, err := db.Exec(s, args...); err != nil {
			t.Fatal(err)
		}
	}
	must(`CREATE TABLE schema_migrations(name TEXT PRIMARY KEY,applied_at INTEGER NOT NULL)`)
	entries, err := migrationFS.ReadDir("migrations")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.Name() >= "0024" {
			continue
		}
		raw, _ := migrationFS.ReadFile("migrations/" + entry.Name())
		for _, stmt := range strings.Split(string(raw), "--> statement-breakpoint") {
			if strings.TrimSpace(stmt) != "" {
				must(stmt)
			}
		}
		must(`INSERT INTO schema_migrations VALUES(?,0)`, entry.Name())
	}
	must(`INSERT INTO contacts(id,name,type,created_at,updated_at) VALUES('m','Mentor','mentor',1,1)`)
	must(`INSERT INTO buildspace_launchpad_projects VALUES('p','Project','','Software','Building','[]',1)`)
	must(`INSERT INTO buildspace_launchpad_people VALUES('b','Builder',NULL,NULL,'p','2026-09-14')`)
	must(`INSERT INTO buildspace_launchpad_activity VALUES('w','p','b',NULL,'weekly','2026-09-20','Progress','on-track',NULL,'manual',NULL,1)`)
	must(`INSERT INTO buildspace_launchpad_activity VALUES('r','p',NULL,NULL,'request','2026-09-20','Need','open',NULL,'manual',NULL,1)`)
	must(`INSERT INTO buildspace_launchpad_activity VALUES('n','p',NULL,'m','mentor','2026-09-20','Note','on-track',NULL,'manual',NULL,1)`)
	if err := migrate(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	var name, starts, projectCohort, personCohort string
	if err := db.QueryRow(`SELECT c.name,c.starts_on,p.cohort_id,b.cohort_id FROM buildspace_launchpad_cohorts c, buildspace_launchpad_projects p, buildspace_launchpad_people b`).Scan(&name, &starts, &projectCohort, &personCohort); err != nil {
		t.Fatal(err)
	}
	if name != "Cohort 1" || starts != "2026-09-14" || projectCohort != "cohort-1" || personCohort != "cohort-1" {
		t.Fatalf("backfill: %s %s %s %s", name, starts, projectCohort, personCohort)
	}
	for id, want := range map[string]string{"w": "team", "r": "officers", "n": "mentors"} {
		var v string
		if err := db.QueryRow(`SELECT visibility FROM buildspace_launchpad_activity WHERE id=?`, id).Scan(&v); err != nil || v != want {
			t.Errorf("%s visibility %q want %q (%v)", id, v, want, err)
		}
	}
	refused := func(label, s string) {
		t.Helper()
		if _, err := db.Exec(s); err == nil {
			t.Errorf("%s: accepted", label)
		}
	}
	refused("project without cohort", `INSERT INTO buildspace_launchpad_projects(id,name,track,stage,updated_at) VALUES('q','Q','Software','Building',1)`)
	refused("project cohort change", `UPDATE buildspace_launchpad_projects SET cohort_id='other' WHERE id='p'`)
	must(`INSERT INTO buildspace_launchpad_cohorts(id,name,starts_on,created_at,updated_at) VALUES('c2','Two','2027-01-01',1,1)`)
	refused("builder in another cohort", `INSERT INTO buildspace_launchpad_people(id,name,project_id,joined_on,cohort_id) VALUES('x','X','p','2026-10-01','c2')`)
	refused("builder cohort drift", `UPDATE buildspace_launchpad_people SET cohort_id='c2' WHERE id='b'`)
	refused("mentor account with cohort", `INSERT INTO buildspace_launchpad_accounts(id,kind,email,status,cohort_id,contact_id,created_at,updated_at) VALUES('a','mentor','m@x.org','invited','cohort-1','m',1,1)`)
	refused("active without discord", `INSERT INTO buildspace_launchpad_accounts(id,kind,email,status,cohort_id,created_at,updated_at) VALUES('a','builder','b@x.org','active','cohort-1',1,1)`)
	refused("unnormalised email", `INSERT INTO buildspace_launchpad_accounts(id,kind,email,status,cohort_id,created_at,updated_at) VALUES('a','builder','B@X.org','invited','cohort-1',1,1)`)
	must(`INSERT INTO buildspace_launchpad_accounts(id,kind,email,status,cohort_id,created_at,updated_at) VALUES('a','builder','b@x.org','invited','cohort-1',1,1)`)
	refused("duplicate builder email in cohort", `INSERT INTO buildspace_launchpad_accounts(id,kind,email,status,cohort_id,created_at,updated_at) VALUES('a2','builder','b@x.org','invited','cohort-1',1,1)`)
	if err := migrate(context.Background(), db); err != nil {
		t.Fatal(err)
	}
}

// A fresh database (no Buildspace rows) gets no backfilled cohort.
func TestLaunchpadMigrationOnEmptyDatabaseCreatesNoCohort(t *testing.T) {
	db, err := Open(t.TempDir() + "/fresh.db")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var n int
	if err := db.R.QueryRow(`SELECT count(*) FROM buildspace_launchpad_cohorts`).Scan(&n); err != nil || n != 0 {
		t.Fatalf("cohorts %d %v", n, err)
	}
}
