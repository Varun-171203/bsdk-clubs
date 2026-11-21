import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { DEFAULT_USER_SETTINGS, hashPhoneNumber, normalizePhoneE164 } from '../common/utils.js';
import { repairDatabaseSchema } from './repair_db.js';

export function initDatabase(dbPath) {
  const resolvedPath = dbPath || path.resolve(process.cwd(), 'data', 'bsdk-clubs.sqlite');
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(resolvedPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  // Automatic Migration for Legacy SQLite Databases:
  // Adds any missing columns before table/index declarations to prevent 'no such column' errors
  try {
    const hasUsers = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
    if (hasUsers) {
      const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
      if (!cols.includes('country_code')) {
        db.exec("ALTER TABLE users ADD COLUMN country_code TEXT DEFAULT '+91';");
      }
      if (!cols.includes('phone')) {
        db.exec('ALTER TABLE users ADD COLUMN phone TEXT;');
      }
      if (!cols.includes('phone_e164')) {
        db.exec('ALTER TABLE users ADD COLUMN phone_e164 TEXT;');
      }
      if (!cols.includes('phone_hash')) {
        db.exec('ALTER TABLE users ADD COLUMN phone_hash TEXT;');
      }
      if (!cols.includes('is_registered')) {
        db.exec('ALTER TABLE users ADD COLUMN is_registered INTEGER NOT NULL DEFAULT 1;');
      }
      if (!cols.includes('two_step_pin_hash')) {
        db.exec('ALTER TABLE users ADD COLUMN two_step_pin_hash TEXT;');
      }
      if (!cols.includes('last_seen')) {
        db.exec('ALTER TABLE users ADD COLUMN last_seen TEXT;');
      }
      if (!cols.includes('delete_requested_at')) {
        db.exec('ALTER TABLE users ADD COLUMN delete_requested_at TEXT;');
      }

      try {
        db.exec(`
          UPDATE users SET
            phone_e164 = COALESCE(phone_e164, CASE WHEN phone LIKE '+%' THEN phone ELSE '+91' || phone END),
            country_code = COALESCE(country_code, '+91')
          WHERE phone_e164 IS NULL AND phone IS NOT NULL;
        `);
      } catch {}
    }

    const hasMessages = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='messages'").get();
    if (hasMessages) {
      const mCols = db.prepare('PRAGMA table_info(messages)').all().map((c) => c.name);
      if (!mCols.includes('client_message_id')) {
        db.exec('ALTER TABLE messages ADD COLUMN client_message_id TEXT;');
      }
    }

    const hasClubs = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='clubs'").get();
    if (hasClubs) {
      const cCols = db.prepare('PRAGMA table_info(clubs)').all().map((c) => c.name);
      if (!cCols.includes('disappearing_seconds')) {
        db.exec('ALTER TABLE clubs ADD COLUMN disappearing_seconds INTEGER NOT NULL DEFAULT 604800;');
      }
    }

    const hasMembers = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='club_members'").get();
    if (hasMembers) {
      const memCols = db.prepare('PRAGMA table_info(club_members)').all().map((c) => c.name);
      if (!memCols.includes('muted_until')) {
        db.exec('ALTER TABLE club_members ADD COLUMN muted_until TEXT;');
      }
    }
  } catch (migErr) {
    console.warn('[DB Migration Warning]', migErr);
  }

  // Create tables matching Section 5 Database Schema + WhatsApp Phone/OTP & Session Management
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE,
      country_code TEXT DEFAULT '+91',
      phone TEXT UNIQUE,
      phone_e164 TEXT UNIQUE,
      phone_hash TEXT,
      password_hash TEXT,
      email TEXT,
      real_name TEXT NOT NULL DEFAULT '',
      profile_photo_url TEXT,
      about TEXT DEFAULT 'Hey there! I am on BSDK Clubs',
      two_step_pin_hash TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      is_registered INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      last_seen TEXT,
      is_banned INTEGER NOT NULL DEFAULT 0,
      delete_requested_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
    CREATE INDEX IF NOT EXISTS idx_users_phone_e164 ON users(phone_e164);

    CREATE TABLE IF NOT EXISTS otp_codes (
      phone TEXT PRIMARY KEY,
      country_code TEXT DEFAULT '+91',
      otp_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      request_count INTEGER NOT NULL DEFAULT 1,
      window_start TEXT NOT NULL,
      locked_until TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL,
      refresh_token_hash TEXT,
      created_at TEXT NOT NULL,
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_device ON sessions(user_id, device_id);

    CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT
    );

    CREATE TABLE IF NOT EXISTS clubs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      photo_url TEXT,
      description TEXT DEFAULT '',
      created_by TEXT NOT NULL REFERENCES users(id),
      invite_code TEXT UNIQUE NOT NULL,
      disappearing_seconds INTEGER NOT NULL DEFAULT 604800,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS club_members (
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
    CREATE INDEX IF NOT EXISTS idx_club_members_club_id ON club_members(club_id);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      sender_member_id TEXT NOT NULL REFERENCES club_members(id) ON DELETE CASCADE,
      client_message_id TEXT,
      type TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'image', 'poll', 'system')),
      body TEXT DEFAULT '',
      media_url TEXT,
      reply_to_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_messages_club_created ON messages(club_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_client_id ON messages(client_message_id);

    CREATE TABLE IF NOT EXISTS message_reactions (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      member_id TEXT NOT NULL REFERENCES club_members(id) ON DELETE CASCADE,
      emoji TEXT NOT NULL,
      UNIQUE(message_id, member_id, emoji)
    );

    CREATE TABLE IF NOT EXISTS polls (
      id TEXT PRIMARY KEY,
      message_id TEXT UNIQUE NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      question TEXT NOT NULL,
      multi_choice INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS poll_options (
      id TEXT PRIMARY KEY,
      poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      vote_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS poll_votes (
      id TEXT PRIMARY KEY,
      poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
      option_id TEXT NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
      member_id TEXT NOT NULL REFERENCES club_members(id) ON DELETE CASCADE,
      UNIQUE(poll_id, member_id, option_id)
    );

    CREATE TABLE IF NOT EXISTS statuses (
      id TEXT PRIMARY KEY,
      club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      member_id TEXT NOT NULL REFERENCES club_members(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'image')),
      media_url TEXT,
      caption TEXT DEFAULT '',
      bg_color TEXT DEFAULT '#075E54',
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_statuses_expires ON statuses(expires_at);

    CREATE TABLE IF NOT EXISTS status_views (
      status_id TEXT NOT NULL REFERENCES statuses(id) ON DELETE CASCADE,
      member_id TEXT NOT NULL REFERENCES club_members(id) ON DELETE CASCADE,
      viewed_at TEXT NOT NULL,
      PRIMARY KEY (status_id, member_id)
    );

    CREATE TABLE IF NOT EXISTS reports (
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

    CREATE TABLE IF NOT EXISTS blocks (
      id TEXT PRIMARY KEY,
      blocker_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      UNIQUE(blocker_user_id, blocked_user_id)
    );

    CREATE TABLE IF NOT EXISTS notifications_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      fcm_token TEXT NOT NULL,
      device TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS read_receipts (
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      member_id TEXT NOT NULL REFERENCES club_members(id) ON DELETE CASCADE,
      read_at TEXT NOT NULL,
      PRIMARY KEY (message_id, member_id)
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      settings_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS club_user_prefs (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      is_muted INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0,
      last_read_at TEXT,
      PRIMARY KEY (user_id, club_id)
    );

    CREATE TABLE IF NOT EXISTS moderation_audit_logs (
      id TEXT PRIMARY KEY,
      moderator_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_club_id TEXT,
      target_member_id TEXT,
      reason TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prekeys (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      identity_key TEXT NOT NULL,
      signed_prekey TEXT NOT NULL,
      signed_prekey_sig TEXT NOT NULL,
      one_time_prekeys_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS direct_conversations (
      id TEXT PRIMARY KEY,
      user1_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user2_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user1_id, user2_id)
    );
    CREATE INDEX IF NOT EXISTS idx_direct_conv_u1 ON direct_conversations(user1_id);
    CREATE INDEX IF NOT EXISTS idx_direct_conv_u2 ON direct_conversations(user2_id);

    CREATE TABLE IF NOT EXISTS e2ee_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      club_id TEXT,
      sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ciphertext TEXT NOT NULL,
      iv TEXT NOT NULL,
      ephemeral_key TEXT,
      type TEXT NOT NULL DEFAULT 'text',
      media_blob_ref TEXT,
      status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'read')),
      expires_at TEXT,
      created_at TEXT NOT NULL,
      delivered_at TEXT,
      read_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_e2ee_conv_created ON e2ee_messages(conversation_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_e2ee_recipient_status ON e2ee_messages(recipient_id, status);

    CREATE TABLE IF NOT EXISTS encrypted_media (
      id TEXT PRIMARY KEY,
      uploader_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      byte_size INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invites (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'user' CHECK (type IN ('user', 'club')),
      club_id TEXT REFERENCES clubs(id) ON DELETE CASCADE,
      qr_data TEXT NOT NULL,
      use_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_invites_code ON invites(code);
    CREATE INDEX IF NOT EXISTS idx_invites_owner ON invites(owner_id);

    CREATE TABLE IF NOT EXISTS invite_tracking (
      id TEXT PRIMARY KEY,
      inviter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      phone_hash TEXT NOT NULL,
      invite_method TEXT NOT NULL DEFAULT 'sms',
      invited_at TEXT NOT NULL,
      joined_at TEXT,
      reminded_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_invite_track_hash ON invite_tracking(phone_hash);
    CREATE INDEX IF NOT EXISTS idx_invite_track_inviter ON invite_tracking(inviter_id);
  `);

  // Migrate columns for existing SQLite DBs
  try { db.exec('ALTER TABLE messages ADD COLUMN client_message_id TEXT;'); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_messages_client_id ON messages(client_message_id);'); } catch {}
  try { db.exec('ALTER TABLE users ADD COLUMN country_code TEXT DEFAULT "+91";'); } catch {}
  try { db.exec('ALTER TABLE users ADD COLUMN phone_e164 TEXT;'); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_users_phone_e164 ON users(phone_e164);'); } catch {}
  try { db.exec('ALTER TABLE users ADD COLUMN phone_hash TEXT;'); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_users_phone_hash ON users(phone_hash);'); } catch {}
  try { db.exec('ALTER TABLE users ADD COLUMN is_registered INTEGER DEFAULT 1;'); } catch {}
  try { db.exec('ALTER TABLE users ADD COLUMN two_step_pin_hash TEXT;'); } catch {}
  try { db.exec('ALTER TABLE users ADD COLUMN status TEXT DEFAULT "active";'); } catch {}
  try { db.exec('ALTER TABLE users ADD COLUMN last_seen TEXT;'); } catch {}

  // Populate phone_e164 and phone_hash for existing records if missing
  try {
    const unhashedUsers = db.prepare('SELECT id, phone, country_code, phone_e164, phone_hash FROM users WHERE phone IS NOT NULL').all();
    if (unhashedUsers.length > 0) {
      const updateStmt = db.prepare('UPDATE users SET phone_e164 = COALESCE(phone_e164, ?), phone_hash = COALESCE(phone_hash, ?), is_registered = 1 WHERE id = ?');
      for (const u of unhashedUsers) {
        const e164 = normalizePhoneE164(u.phone, u.country_code || '+91');
        const ph = hashPhoneNumber(e164 || u.phone, u.country_code || '+91');
        updateStmt.run(e164 || u.phone, ph, u.id);
      }
    }
  } catch (err) {
    console.error('[DB Migration] Error populating phone_e164 / phone_hash:', err);
  }

  // Ensure any orphaned users_old references are cleanly repaired
  try {
    repairDatabaseSchema(db);
  } catch {}
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS otp_codes (
        phone TEXT PRIMARY KEY,
        country_code TEXT DEFAULT '+91',
        otp_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        request_count INTEGER NOT NULL DEFAULT 1,
        window_start TEXT NOT NULL,
        locked_until TEXT
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_id TEXT NOT NULL,
        refresh_token_hash TEXT,
        created_at TEXT NOT NULL,
        revoked_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    `);
  } catch {}

  seedDemoData(db);
  return db;
}

function seedDemoData(db) {
  const count = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (count > 0) return;

  const now = Date.now();
  const iso = (offsetMs = 0) => new Date(now + offsetMs).toISOString();
  const passHash = bcrypt.hashSync('bsdk1234', 10);

  const demoUsers = [
    {
      id: uuidv4(),
      user_id: 'piyush',
      real_name: 'Piyush Saxena',
      email: 'piyush@bsdkclubs.app',
      phone: '+91 9876543210',
      photo: 'https://api.dicebear.com/9.x/avataaars/svg?seed=Piyush&backgroundColor=c0aede',
      about: 'Your Gang. Your Bang. 🚀'
    },
    {
      id: uuidv4(),
      user_id: 'rohan',
      real_name: 'Rohan Verma',
      email: 'rohan@bsdkclubs.app',
      phone: '+91 9876543211',
      photo: 'https://api.dicebear.com/9.x/avataaars/svg?seed=Rohan&backgroundColor=b6e3f4',
      about: 'Chai + late night hostel scenes'
    },
    {
      id: uuidv4(),
      user_id: 'ananya',
      real_name: 'Ananya Sharma',
      email: 'ananya@bsdkclubs.app',
      phone: '+91 9876543212',
      photo: 'https://api.dicebear.com/9.x/avataaars/svg?seed=Ananya&backgroundColor=ffd5dc',
      about: 'Hey there! I am on BSDK Clubs'
    },
    {
      id: uuidv4(),
      user_id: 'kabir',
      real_name: 'Kabir Malhotra',
      email: 'kabir@bsdkclubs.app',
      phone: '+91 9876543213',
      photo: 'https://api.dicebear.com/9.x/avataaars/svg?seed=Kabir&backgroundColor=d1d4f9',
      about: 'Goa plan cancel mat karna'
    },
    {
      id: uuidv4(),
      user_id: 'meera',
      real_name: 'Meera Nair',
      email: 'meera@bsdkclubs.app',
      phone: '+91 9876543214',
      photo: 'https://api.dicebear.com/9.x/avataaars/svg?seed=Meera&backgroundColor=ffdfbf',
      about: 'Anonymous bakcodi specialist'
    }
  ];

  const insertUser = db.prepare(`
    INSERT INTO users (id, user_id, password_hash, phone, phone_hash, email, real_name, profile_photo_url, about, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSettings = db.prepare(`
    INSERT INTO user_settings (user_id, settings_json, updated_at) VALUES (?, ?, ?)
  `);

  for (const u of demoUsers) {
    const ph = hashPhoneNumber(u.phone, '+91');
    insertUser.run(u.id, u.user_id, passHash, u.phone, ph, u.email, u.real_name, u.photo, u.about, iso(-86400000 * 14));
    insertSettings.run(u.id, JSON.stringify(DEFAULT_USER_SETTINGS), iso(-86400000 * 14));
  }

  const [piyush, rohan, ananya, kabir, meera] = demoUsers;

  // Create 3 demo Clubs
  const clubHostel = {
    id: uuidv4(),
    name: 'Hostel Bakcodi',
    photo: 'https://api.dicebear.com/9.x/shapes/svg?seed=HostelBakcodi&backgroundColor=075e54',
    description: 'Wing 4 ka official unofficial adda. Real dost Group Info mein, andar sirf aliases! 🔥',
    created_by: piyush.id,
    invite_code: 'HOSTEL42',
    disappearing_seconds: 604800
  };
  const clubGoa = {
    id: uuidv4(),
    name: 'Goa Trip Squad',
    photo: 'https://api.dicebear.com/9.x/shapes/svg?seed=GoaTrip&backgroundColor=128c7e',
    description: 'Is saal pakka jayenge. Bina naam ke sach bolo budget kitna hai 🌴',
    created_by: piyush.id,
    invite_code: 'GOA2026',
    disappearing_seconds: 604800
  };
  const clubExams = {
    id: uuidv4(),
    name: 'Exam Survivors 2026',
    photo: 'https://api.dicebear.com/9.x/shapes/svg?seed=ExamSquad&backgroundColor=1f2c34',
    description: 'One night before exam confession room. Messages disappear in 24 hours.',
    created_by: rohan.id,
    invite_code: 'EXAM99',
    disappearing_seconds: 86400
  };

  const insertClub = db.prepare(`
    INSERT INTO clubs (id, name, photo_url, description, created_by, invite_code, disappearing_seconds, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const c of [clubHostel, clubGoa, clubExams]) {
    insertClub.run(c.id, c.name, c.photo, c.description, c.created_by, c.invite_code, c.disappearing_seconds, iso(-86400000 * 10));
  }

  // Add members with DIFFERENT aliases per club!
  const insertMember = db.prepare(`
    INSERT INTO club_members (id, club_id, user_id, role, alias_name, alias_color, joined_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertPref = db.prepare(`
    INSERT INTO club_user_prefs (user_id, club_id, is_pinned, is_muted, is_archived, last_read_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const mHostel = {
    piyush: { id: uuidv4(), alias: 'GhostByte_07', color: '#128C7E', role: 'admin' },
    rohan: { id: uuidv4(), alias: 'SilentFox_42', color: '#059669', role: 'member' },
    ananya: { id: uuidv4(), alias: 'PixelPanda_19', color: '#F472B6', role: 'member' },
    kabir: { id: uuidv4(), alias: 'TurboChai_88', color: '#D97706', role: 'member' },
    meera: { id: uuidv4(), alias: 'CosmicOwl_51', color: '#7C3AED', role: 'member' }
  };

  for (const [key, user] of Object.entries({ piyush, rohan, ananya, kabir, meera })) {
    const m = mHostel[key];
    insertMember.run(m.id, clubHostel.id, user.id, m.role, m.alias, m.color, iso(-86400000 * 9));
    insertPref.run(user.id, clubHostel.id, key === 'piyush' ? 1 : 0, 0, 0, iso(-3600000 * 4));
  }

  const mGoa = {
    piyush: { id: uuidv4(), alias: 'NeonSamosa_24', color: '#0284C7', role: 'admin' },
    rohan: { id: uuidv4(), alias: 'SwiftMango_63', color: '#EA580C', role: 'member' },
    ananya: { id: uuidv4(), alias: 'VelvetWolf_11', color: '#BE185D', role: 'member' },
    kabir: { id: uuidv4(), alias: 'LunarHawk_77', color: '#4F46E5', role: 'admin' }
  };

  for (const [key, user] of Object.entries({ piyush, rohan, ananya, kabir })) {
    const m = mGoa[key];
    insertMember.run(m.id, clubGoa.id, user.id, m.role, m.alias, m.color, iso(-86400000 * 6));
    insertPref.run(user.id, clubGoa.id, 0, 0, 0, iso(-3600000 * 6));
  }

  const mExams = {
    rohan: { id: uuidv4(), alias: 'GlitchOtter_31', color: '#0D9488', role: 'admin' },
    piyush: { id: uuidv4(), alias: 'FrostySpark_92', color: '#9333EA', role: 'member' },
    meera: { id: uuidv4(), alias: 'CrispyBoba_14', color: '#E11D48', role: 'member' }
  };

  for (const [key, user] of Object.entries({ rohan, piyush, meera })) {
    const m = mExams[key];
    insertMember.run(m.id, clubExams.id, user.id, m.role, m.alias, m.color, iso(-86400000 * 3));
    insertPref.run(user.id, clubExams.id, 0, 0, 0, iso(-3600000 * 8));
  }

  // Seed messages in Hostel Bakcodi
  const insertMsg = db.prepare(`
    INSERT INTO messages (id, club_id, sender_member_id, type, body, media_url, reply_to_id, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const msg1 = uuidv4();
  const msg2 = uuidv4();
  const msg3 = uuidv4();
  const msg4 = uuidv4();
  const msgPoll = uuidv4();
  const exp7d = iso(604800 * 1000);
  const exp24h = iso(86400 * 1000);

  insertMsg.run(msg1, clubHostel.id, mHostel.rohan.id, 'text', 'aaj ka plan confirm? kal ka match kaun jeetega?', null, null, exp7d, iso(-3600000 * 3));
  insertMsg.run(msg2, clubHostel.id, mHostel.piyush.id, 'text', 'haan, 10 baje milte hain. Poll daal, vote karte hain!', null, msg1, exp7d, iso(-3600000 * 2.5));
  insertMsg.run(msg3, clubHostel.id, mHostel.kabir.id, 'text', 'Jo bhi hostel mess ki dal ko "tasty" bolta hai, aaj sach confess karo 😂', null, null, exp7d, iso(-3600000 * 2));
  insertMsg.run(msg4, clubHostel.id, mHostel.ananya.id, 'text', 'poll daal diya hai, vote karo 👇 (kisne vote diya koi nahi dekh sakta)', null, null, exp7d, iso(-3600000 * 1.2));
  insertMsg.run(msgPoll, clubHostel.id, mHostel.ananya.id, 'poll', 'Kal raat ka plan?', null, null, exp7d, iso(-3600000 * 1.1));

  // Reactions
  const insertReaction = db.prepare(`
    INSERT INTO message_reactions (id, message_id, member_id, emoji) VALUES (?, ?, ?, ?)
  `);
  insertReaction.run(uuidv4(), msg3, mHostel.piyush.id, '😂');
  insertReaction.run(uuidv4(), msg3, mHostel.rohan.id, '😂');
  insertReaction.run(uuidv4(), msg3, mHostel.meera.id, '🔥');
  insertReaction.run(uuidv4(), msg2, mHostel.ananya.id, '🙌');

  // Seed Anonymous Poll
  const pollId = uuidv4();
  db.prepare('INSERT INTO polls (id, message_id, question, multi_choice) VALUES (?, ?, ?, ?)').run(
    pollId, msgPoll, 'Kal raat ka plan?', 0
  );
  const opt1 = uuidv4();
  const opt2 = uuidv4();
  const opt3 = uuidv4();
  const insertOpt = db.prepare('INSERT INTO poll_options (id, poll_id, text, vote_count) VALUES (?, ?, ?, ?)');
  insertOpt.run(opt1, pollId, 'Hostel terrace pe Maggi + Chai 🍜', 2);
  insertOpt.run(opt2, pollId, 'Bahar late-night drive 🚗', 1);
  insertOpt.run(opt3, pollId, 'Room mein FIFA tournament 🎮', 1);

  const insertVote = db.prepare('INSERT INTO poll_votes (id, poll_id, option_id, member_id) VALUES (?, ?, ?, ?)');
  insertVote.run(uuidv4(), pollId, opt1, mHostel.rohan.id);
  insertVote.run(uuidv4(), pollId, opt1, mHostel.meera.id);
  insertVote.run(uuidv4(), pollId, opt2, mHostel.kabir.id);
  insertVote.run(uuidv4(), pollId, opt3, mHostel.ananya.id);

  // Seed messages in Goa Trip Squad
  insertMsg.run(uuidv4(), clubGoa.id, mGoa.kabir.id, 'text', 'Honestly batao bina sharam ke — kisko parents se permission nahi milne wali? 😅', null, null, exp7d, iso(-3600000 * 5));
  insertMsg.run(uuidv4(), clubGoa.id, mGoa.ananya.id, 'text', 'Agar train ticket ₹800 ke andar hai toh main ready hoon, flight bolke mat darao', null, null, exp7d, iso(-3600000 * 4));
  insertMsg.run(uuidv4(), clubGoa.id, mGoa.piyush.id, 'text', 'Notice kiya? Yahan mera alias alag hai, Hostel Bakcodi mein alag tha! Nobody knows 😎', null, null, exp7d, iso(-3600000 * 1.5));

  // Seed messages in Exam Survivors 2026
  insertMsg.run(uuidv4(), clubExams.id, mExams.rohan.id, 'text', 'Syllabus ka Chapter 3 kisne khola bhi hai kya?', null, null, exp24h, iso(-3600000 * 2));
  insertMsg.run(uuidv4(), clubExams.id, mExams.meera.id, 'text', 'Bhai maine abhi tak PDF download nahi kiya 😭', null, null, exp24h, iso(-3600000 * 0.8));

  // Seed Group-wise Anonymous Statuses (24h expiry)
  const insertStatus = db.prepare(`
    INSERT INTO statuses (id, club_id, member_id, type, media_url, caption, bg_color, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertStatus.run(
    uuidv4(), clubHostel.id, mHostel.rohan.id, 'text', null,
    'Canteen wala samosa aaj 10/10 tha, guess karo kisne 4 khaye 👀🔥', '#075E54', exp24h, iso(-3600000 * 2)
  );
  insertStatus.run(
    uuidv4(), clubHostel.id, mHostel.ananya.id, 'text', null,
    'Someone in this group still owes ₹250 from last Friday... you know who you are 💸', '#7C3AED', exp24h, iso(-3600000 * 1)
  );
  insertStatus.run(
    uuidv4(), clubGoa.id, mGoa.kabir.id, 'text', null,
    'Baga beach sunset manifest kar raha hoon 🌅✈️', '#0284C7', exp24h, iso(-3600000 * 3)
  );
  insertStatus.run(
    uuidv4(), clubExams.id, mExams.meera.id, 'text', null,
    '3 AM coffee club active ☕📚 All-nighter gang assemble!', '#BE185D', exp24h, iso(-3600000 * 0.5)
  );
}
