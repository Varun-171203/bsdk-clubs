import { DatabaseSync } from 'node:sqlite';

export function repairDatabaseSchema(db) {
  // Check if any table contains references to users_old
  const tablesWithOld = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND sql LIKE '%users_old%'").all();
  if (tablesWithOld.length === 0) return;

  console.log(`[Schema Repair] Found ${tablesWithOld.length} tables referencing users_old. Repairing...`);

  db.exec('PRAGMA foreign_keys = OFF;');

  // Table definitions with clean references to users(id)
  const cleanDefinitions = {
    password_resets: `
      CREATE TABLE password_resets_new (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT
      );
    `,
    clubs: `
      CREATE TABLE clubs_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        photo_url TEXT,
        description TEXT DEFAULT '',
        created_by TEXT NOT NULL REFERENCES users(id),
        invite_code TEXT UNIQUE NOT NULL,
        disappearing_seconds INTEGER NOT NULL DEFAULT 604800,
        created_at TEXT NOT NULL
      );
    `,
    club_members: `
      CREATE TABLE club_members_new (
        id TEXT PRIMARY KEY,
        club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
        alias_name TEXT NOT NULL,
        alias_color TEXT NOT NULL,
        joined_at TEXT NOT NULL,
        muted_until TEXT,
        UNIQUE(club_id, user_id),
        UNIQUE(club_id, alias_name)
      );
    `,
    reports: `
      CREATE TABLE reports_new (
        id TEXT PRIMARY KEY,
        reporter_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reported_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        club_id TEXT REFERENCES clubs(id) ON DELETE SET NULL,
        message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
        reason TEXT NOT NULL,
        details TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'Under Review',
        created_at TEXT NOT NULL,
        actioned_by TEXT REFERENCES users(id) ON DELETE SET NULL
      );
    `,
    blocks: `
      CREATE TABLE blocks_new (
        id TEXT PRIMARY KEY,
        blocker_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        blocked_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        UNIQUE(blocker_user_id, blocked_user_id)
      );
    `,
    notifications_tokens: `
      CREATE TABLE notifications_tokens_new (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        fcm_token TEXT NOT NULL,
        device TEXT,
        updated_at TEXT NOT NULL
      );
    `,
    user_settings: `
      CREATE TABLE user_settings_new (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        settings_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
    club_user_prefs: `
      CREATE TABLE club_user_prefs_new (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
        is_pinned INTEGER NOT NULL DEFAULT 0,
        is_muted INTEGER NOT NULL DEFAULT 0,
        is_archived INTEGER NOT NULL DEFAULT 0,
        last_read_at TEXT,
        PRIMARY KEY (user_id, club_id)
      );
    `,
    sessions: `
      CREATE TABLE sessions_new (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_id TEXT NOT NULL,
        refresh_token_hash TEXT,
        created_at TEXT NOT NULL,
        revoked_at TEXT
      );
    `
  };

  for (const t of tablesWithOld) {
    const tableName = t.name;
    const def = cleanDefinitions[tableName];
    if (def) {
      const newTable = `${tableName}_new`;
      db.exec(def);
      db.exec(`INSERT INTO ${newTable} SELECT * FROM ${tableName};`);
      db.exec(`DROP TABLE ${tableName};`);
      db.exec(`ALTER TABLE ${newTable} RENAME TO ${tableName};`);
      console.log(`  - Repaired table: ${tableName}`);
    }
  }

  // Re-create necessary indices
  db.exec('CREATE INDEX IF NOT EXISTS idx_club_members_club_id ON club_members(club_id);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_device ON sessions(user_id, device_id);');

  db.exec('PRAGMA foreign_keys = ON;');
  console.log('[Schema Repair] All foreign keys cleanly restored to users(id)!');
}

// Run if called directly
const isMain = process.argv[1] && process.argv[1].endsWith('repair_db.js');
if (isMain) {
  const db = new DatabaseSync('backend/data/bsdk-clubs.sqlite');
  repairDatabaseSchema(db);
}
