-- Launchpad cohorts, builder/mentor portal accounts, archive, visibility (docs/launchpad-cohorts.md).
-- Cohorts group projects and builders by intake. Existing rows move into one backfilled cohort.
CREATE TABLE buildspace_launchpad_cohorts (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL UNIQUE CHECK(length(trim(name)) > 0),
 starts_on TEXT NOT NULL CHECK(starts_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
 ends_on TEXT CHECK(ends_on IS NULL OR (ends_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]' AND ends_on >= starts_on)),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
--> statement-breakpoint
ALTER TABLE buildspace_launchpad_projects ADD COLUMN cohort_id TEXT REFERENCES buildspace_launchpad_cohorts(id);
--> statement-breakpoint
ALTER TABLE buildspace_launchpad_projects ADD COLUMN archived_at INTEGER;
--> statement-breakpoint
ALTER TABLE buildspace_launchpad_people ADD COLUMN cohort_id TEXT REFERENCES buildspace_launchpad_cohorts(id);
--> statement-breakpoint
ALTER TABLE buildspace_launchpad_people ADD COLUMN archived_at INTEGER;
--> statement-breakpoint
ALTER TABLE buildspace_launchpad_people ADD COLUMN designation TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE buildspace_launchpad_people ADD COLUMN pronouns TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE buildspace_launchpad_people ADD COLUMN bio TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE buildspace_launchpad_people ADD COLUMN email TEXT;
--> statement-breakpoint
INSERT INTO buildspace_launchpad_cohorts(id,name,starts_on,status,created_at,updated_at)
 SELECT 'cohort-1','Cohort 1',
  COALESCE((SELECT min(joined_on) FROM buildspace_launchpad_people), date('now')),
  'active', CAST(unixepoch('subsec')*1000 AS INTEGER), CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE EXISTS (SELECT 1 FROM buildspace_launchpad_projects);
--> statement-breakpoint
UPDATE buildspace_launchpad_projects SET cohort_id='cohort-1' WHERE cohort_id IS NULL;
--> statement-breakpoint
UPDATE buildspace_launchpad_people SET cohort_id=(SELECT p.cohort_id FROM buildspace_launchpad_projects p WHERE p.id=project_id) WHERE cohort_id IS NULL;
--> statement-breakpoint
CREATE INDEX buildspace_launchpad_projects_cohort ON buildspace_launchpad_projects(cohort_id,archived_at);
--> statement-breakpoint
CREATE INDEX buildspace_launchpad_people_cohort ON buildspace_launchpad_people(cohort_id,archived_at);
--> statement-breakpoint
-- New rows must carry a cohort, and a builder's cohort is always their project's cohort.
CREATE TRIGGER buildspace_launchpad_projects_cohort_required BEFORE INSERT ON buildspace_launchpad_projects
WHEN NEW.cohort_id IS NULL BEGIN SELECT RAISE(ABORT, 'project cohort required'); END;
--> statement-breakpoint
CREATE TRIGGER buildspace_launchpad_projects_cohort_fixed BEFORE UPDATE OF cohort_id ON buildspace_launchpad_projects
WHEN NEW.cohort_id IS NOT OLD.cohort_id BEGIN SELECT RAISE(ABORT, 'project cohort is fixed'); END;
--> statement-breakpoint
CREATE TRIGGER buildspace_launchpad_people_cohort_insert BEFORE INSERT ON buildspace_launchpad_people
WHEN NEW.cohort_id IS NULL OR NEW.cohort_id IS NOT (SELECT cohort_id FROM buildspace_launchpad_projects WHERE id=NEW.project_id)
BEGIN SELECT RAISE(ABORT, 'builder cohort must match project'); END;
--> statement-breakpoint
CREATE TRIGGER buildspace_launchpad_people_cohort_update BEFORE UPDATE OF cohort_id, project_id ON buildspace_launchpad_people
WHEN NEW.cohort_id IS NULL OR NEW.cohort_id IS NOT (SELECT cohort_id FROM buildspace_launchpad_projects WHERE id=NEW.project_id)
BEGIN SELECT RAISE(ABORT, 'builder cohort must match project'); END;
--> statement-breakpoint
-- Portal accounts for builders and mentors. Separate from users: a portal account can never
-- reach officer data, because officer sessions and APIs only ever resolve users rows.
CREATE TABLE buildspace_launchpad_accounts (
 id TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK(kind IN ('builder','mentor')),
 email TEXT NOT NULL CHECK(email = lower(trim(email)) AND email LIKE '%_@_%'),
 name TEXT NOT NULL DEFAULT '',
 cohort_id TEXT REFERENCES buildspace_launchpad_cohorts(id),
 person_id TEXT UNIQUE REFERENCES buildspace_launchpad_people(id) ON DELETE SET NULL,
 contact_id TEXT UNIQUE REFERENCES contacts(id) ON DELETE CASCADE,
 discord_id TEXT UNIQUE,
 status TEXT NOT NULL CHECK(status IN ('invited','active','disabled')),
 invite_token_hash TEXT UNIQUE,
 invite_expires_at INTEGER,
 invite_sent_at INTEGER,
 invite_error TEXT,
 invited_by TEXT REFERENCES users(id),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 accepted_at INTEGER,
 onboarded_at INTEGER,
 last_login_at INTEGER,
 CHECK((kind='builder' AND cohort_id IS NOT NULL AND contact_id IS NULL)
    OR (kind='mentor' AND contact_id IS NOT NULL AND cohort_id IS NULL AND person_id IS NULL)),
 CHECK(status='invited' OR discord_id IS NOT NULL OR status='disabled')
);
--> statement-breakpoint
CREATE UNIQUE INDEX buildspace_launchpad_accounts_builder_email ON buildspace_launchpad_accounts(cohort_id,email) WHERE kind='builder';
--> statement-breakpoint
CREATE INDEX buildspace_launchpad_accounts_cohort ON buildspace_launchpad_accounts(cohort_id,status);
--> statement-breakpoint
-- Who may read an activity entry outside the officer dashboard. Officers always see everything.
-- team: the project's builders and mentors; mentors: assigned mentors only; officers: officers only.
ALTER TABLE buildspace_launchpad_activity ADD COLUMN visibility TEXT NOT NULL DEFAULT 'officers' CHECK(visibility IN ('team','mentors','officers'));
--> statement-breakpoint
ALTER TABLE buildspace_launchpad_activity ADD COLUMN author_account_id TEXT REFERENCES buildspace_launchpad_accounts(id) ON DELETE SET NULL;
--> statement-breakpoint
-- History stays private by default; builders' own weekly updates and absences were always theirs.
UPDATE buildspace_launchpad_activity SET visibility='team' WHERE kind IN ('weekly','absence') AND person_id IS NOT NULL;
--> statement-breakpoint
UPDATE buildspace_launchpad_activity SET visibility='mentors' WHERE kind='mentor';
--> statement-breakpoint
-- Mentor roster settings. A mentor contact with no row is available with no cap.
CREATE TABLE buildspace_launchpad_mentor_settings (
 contact_id TEXT PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
 available INTEGER NOT NULL DEFAULT 1 CHECK(available IN (0,1)),
 max_projects INTEGER CHECK(max_projects IS NULL OR max_projects BETWEEN 1 AND 50),
 updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE buildspace_launchpad_sessions (
 id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES buildspace_launchpad_accounts(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 user_agent TEXT
);
--> statement-breakpoint
CREATE INDEX buildspace_launchpad_sessions_account ON buildspace_launchpad_sessions(account_id);
