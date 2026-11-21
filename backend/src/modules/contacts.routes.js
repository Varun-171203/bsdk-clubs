import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { sendError, generateUniqueAlias, generateInviteCode, normalizePhoneE164, hashPhoneNumber } from '../common/utils.js';

// Rate limiting in-memory map: user_id -> { count, windowStart }
const lookupLimiter = new Map();
const MAX_LOOKUPS_PER_MINUTE = 60;
const MAX_HASHES_PER_REQUEST = 1000;

function checkLookupRateLimit(userId) {
  const now = Date.now();
  const entry = lookupLimiter.get(userId) || { count: 0, windowStart: now };
  if (now - entry.windowStart > 60000) {
    entry.count = 1;
    entry.windowStart = now;
  } else {
    entry.count += 1;
  }
  lookupLimiter.set(userId, entry);
  return entry.count <= MAX_LOOKUPS_PER_MINUTE;
}

export function createContactsRouter(db, requireAuth) {
  const router = express.Router();

  // ========================================================================
  // GET /users/search?phone=<e164_or_local>
  // Fast, debounced manual number search for any registered user on BSDK Clubs
  // ========================================================================
  router.get('/users/search', requireAuth, (req, res) => {
    const raw = String(req.query.phone || req.query.q || '').trim();
    if (!raw) {
      return sendError(res, 400, 'MISSING_PARAM', 'phone query parameter is required.');
    }

    const norm = normalizePhoneE164(raw, '+91');
    if (!norm) {
      return sendError(res, 400, 'INVALID_FORMAT', 'Invalid phone number format.');
    }

    const hash = hashPhoneNumber(norm);
    const user = db.prepare(`
      SELECT id, user_id, real_name, profile_photo_url, about, last_seen
      FROM users
      WHERE (phone_e164 = ? OR phone_hash = ? OR phone = ?)
        AND is_banned = 0
        AND is_registered = 1
      LIMIT 1
    `).get(norm, hash, norm);

    if (user) {
      return res.json({
        found: true,
        phone_e164: norm,
        user: {
          id: user.id,
          user_id: user.user_id,
          real_name: user.real_name || 'BSDK Member',
          profile_photo_url: user.profile_photo_url || `https://api.dicebear.com/9.x/shapes/svg?seed=${encodeURIComponent(user.user_id)}&backgroundColor=075e54`,
          about: user.about || 'Hey there! I am on BSDK Clubs',
          last_seen: user.last_seen
        }
      });
    }

    return res.json({
      found: false,
      phone_e164: norm,
      message: 'This number is not registered on BSDK Clubs yet.'
    });
  });

  // ========================================================================
  // POST /users/lookup { phone_e164 }
  // ========================================================================
  router.post('/users/lookup', requireAuth, (req, res) => {
    const raw = String(req.body?.phone_e164 || req.body?.phone || '').trim();
    if (!raw) {
      return sendError(res, 400, 'MISSING_PHONE', 'phone_e164 is required.');
    }

    const norm = normalizePhoneE164(raw, '+91');
    if (!norm) {
      return sendError(res, 400, 'INVALID_FORMAT', 'Invalid phone format.');
    }

    const hash = hashPhoneNumber(norm);
    const user = db.prepare(`
      SELECT id, user_id, real_name, profile_photo_url, about, last_seen
      FROM users
      WHERE (phone_e164 = ? OR phone_hash = ? OR phone = ?)
        AND is_banned = 0
        AND is_registered = 1
      LIMIT 1
    `).get(norm, hash, norm);

    if (user) {
      return res.json({
        found: true,
        phone_e164: norm,
        user: {
          id: user.id,
          user_id: user.user_id,
          real_name: user.real_name || 'BSDK Member',
          profile_photo_url: user.profile_photo_url || `https://api.dicebear.com/9.x/shapes/svg?seed=${encodeURIComponent(user.user_id)}&backgroundColor=075e54`,
          about: user.about || 'Hey there! I am on BSDK Clubs',
          last_seen: user.last_seen
        }
      });
    }

    return res.json({
      found: false,
      phone_e164: norm,
      message: 'This number is not registered on BSDK Clubs yet.'
    });
  });

  // ========================================================================
  // POST /contacts/lookup
  // Hashed contact discovery without exposing raw phone numbers or plain identities.
  // Input: { hashed_numbers: [ sha256_hash1, sha256_hash2, ... ] }
  // ========================================================================
  router.post('/contacts/lookup', requireAuth, (req, res) => {
    let rawList = req.body?.hashed_numbers ?? req.body?.hashes ?? req.body?.phone_hashes;
    if (req.body?.hash && typeof req.body.hash === 'string') {
      rawList = [req.body.hash];
    }

    if (!Array.isArray(rawList)) {
      return sendError(res, 400, 'INVALID_INPUT', 'hashes (or hashed_numbers) must be an array of phone hashes.');
    }

    if (rawList.length === 0) {
      return res.json({ success: true, registered_users: [], contacts: [], matched_count: 0, count: 0 });
    }

    if (rawList.length > MAX_HASHES_PER_REQUEST) {
      return sendError(
        res,
        400,
        'TOO_MANY_HASHES',
        `Maximum ${MAX_HASHES_PER_REQUEST} hashes allowed per lookup request.`
      );
    }

    if (!checkLookupRateLimit(req.user.id)) {
      return sendError(
        res,
        429,
        'RATE_LIMITED',
        'Contact lookup rate limit exceeded. Please wait a minute before trying again.'
      );
    }

    // Filter valid hex SHA-256 hashes (64 hex characters)
    const validHashes = Array.from(
      new Set(
        rawList
          .map((h) => String(h || '').trim().toLowerCase())
          .filter((h) => /^[a-f0-9]{64}$/.test(h))
      )
    );

    if (validHashes.length === 0) {
      return res.json({ success: true, registered_users: [], contacts: [], matched_count: 0, count: 0 });
    }

    // Query matched users using SQLite parameterized IN clause
    const excludeSelf = Boolean(req.body?.exclude_self);
    const placeholders = validHashes.map(() => '?').join(',');
    const query = `
      SELECT id, user_id, real_name, profile_photo_url, phone_hash, about, last_seen
      FROM users
      WHERE phone_hash IN (${placeholders})
        AND is_banned = 0
        ${excludeSelf ? 'AND id != ?' : ''}
    `;

    const queryParams = excludeSelf ? [...validHashes, req.user.id] : [...validHashes];
    const matchedUsers = db.prepare(query).all(...queryParams);

    // Optional: check which hashes have been invited by this user
    const invitedMap = new Map();
    try {
      const invites = db.prepare(`
        SELECT phone_hash, joined_at, invited_at
        FROM invite_tracking
        WHERE inviter_id = ? AND phone_hash IN (${placeholders})
      `).all(req.user.id, ...validHashes);
      for (const inv of invites) {
        invitedMap.set(inv.phone_hash, inv);
      }
    } catch {}

    const registeredUsers = matchedUsers.map((u) => {
      const inv = invitedMap.get(u.phone_hash);
      return {
        id: u.id,
        user_id: u.user_id,
        real_name: u.real_name || u.user_id,
        profile_photo_url: u.profile_photo_url,
        phone_hash: u.phone_hash,
        about: u.about || 'Hey there! I am on BSDK Clubs',
        last_seen: u.last_seen,
        is_self: u.id === req.user.id,
        invited: Boolean(inv),
        invite_status: inv ? (inv.joined_at ? 'joined' : 'pending') : null
      };
    });

    return res.json({
      success: true,
      registered_users: registeredUsers,
      contacts: registeredUsers,
      matched_count: registeredUsers.length,
      count: registeredUsers.length
    });
  });

  // ========================================================================
  // POST /contacts/invite-track
  // Track that the current user sent an SMS or WhatsApp invite to a hashed number
  // ========================================================================
  router.post('/contacts/invite-track', requireAuth, (req, res) => {
    const { phone_hash, invite_method = 'sms' } = req.body || {};
    const cleanHash = String(phone_hash || '').trim().toLowerCase();

    if (!/^[a-f0-9]{64}$/.test(cleanHash)) {
      return sendError(res, 400, 'INVALID_HASH', 'Invalid SHA-256 phone hash.');
    }

    const nowIso = new Date().toISOString();
    const id = `inv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    try {
      db.prepare(`
        INSERT INTO invite_tracking (id, inviter_id, phone_hash, invite_method, invited_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, req.user.id, cleanHash, invite_method, nowIso);
    } catch {
      // If already tracked, update reminded_at
      db.prepare(`
        UPDATE invite_tracking
        SET reminded_at = ?, invite_method = ?
        WHERE inviter_id = ? AND phone_hash = ?
      `).run(nowIso, invite_method, req.user.id, cleanHash);
    }

    return res.json({
      success: true,
      phone_hash: cleanHash,
      invited_at: nowIso
    });
  });

  // ========================================================================
  // POST /contacts/start-chat
  // Starts or retrieves a 1-on-1 direct club between current user and target contact
  // ========================================================================
  router.post('/contacts/start-chat', requireAuth, (req, res) => {
    const targetUserId = req.body?.contact_user_id || req.body?.target_user_id;
    if (!targetUserId) {
      return sendError(res, 400, 'VALIDATION', 'contact_user_id is required.');
    }

    if (targetUserId === req.user.id) {
      return sendError(res, 400, 'SELF_CHAT', 'Cannot start a direct chat with yourself.');
    }

    const targetUser = db.prepare('SELECT id, user_id, real_name, profile_photo_url FROM users WHERE id = ?').get(targetUserId);
    if (!targetUser) {
      return sendError(res, 404, 'USER_NOT_FOUND', 'Target user was not found.');
    }

    // Find existing direct 2-member club between these two users
    const existingClub = db.prepare(`
      SELECT c.id, c.name, c.photo_url, c.invite_code, c.disappearing_seconds
      FROM clubs c
      JOIN club_members cm1 ON cm1.club_id = c.id AND cm1.user_id = ?
      JOIN club_members cm2 ON cm2.club_id = c.id AND cm2.user_id = ?
      WHERE (SELECT COUNT(*) FROM club_members WHERE club_id = c.id) = 2
      LIMIT 1
    `).get(req.user.id, targetUserId);

    if (existingClub) {
      const myMembership = db.prepare('SELECT alias_name, alias_color, role FROM club_members WHERE club_id = ? AND user_id = ?').get(existingClub.id, req.user.id);
      return res.json({
        club: {
          ...existingClub,
          my_alias: myMembership?.alias_name,
          my_alias_color: myMembership?.alias_color,
          my_role: myMembership?.role || 'member'
        }
      });
    }

    // Create a new direct chat club
    const clubId = uuidv4();
    const inviteCode = generateInviteCode();
    const now = new Date().toISOString();
    const clubName = `${targetUser.real_name || targetUser.user_id}`;
    const photo = targetUser.profile_photo_url || `https://api.dicebear.com/9.x/shapes/svg?seed=${encodeURIComponent(clubName)}&backgroundColor=075e54`;

    db.prepare(`
      INSERT INTO clubs (id, name, photo_url, description, created_by, invite_code, disappearing_seconds, created_at)
      VALUES (?, ?, ?, 'Direct Chat', ?, ?, 604800, ?)
    `).run(clubId, clubName, photo, req.user.id, inviteCode, now);

    // Add creator
    const creatorAlias = generateUniqueAlias(new Set());
    const memberIdCreator = uuidv4();
    db.prepare(`
      INSERT INTO club_members (id, club_id, user_id, role, alias_name, alias_color, joined_at)
      VALUES (?, ?, ?, 'admin', ?, ?, ?)
    `).run(memberIdCreator, clubId, req.user.id, creatorAlias.alias_name, creatorAlias.alias_color, now);

    // Add target contact
    const targetAlias = generateUniqueAlias(new Set([creatorAlias.alias_name]));
    const memberIdTarget = uuidv4();
    db.prepare(`
      INSERT INTO club_members (id, club_id, user_id, role, alias_name, alias_color, joined_at)
      VALUES (?, ?, ?, 'member', ?, ?, ?)
    `).run(memberIdTarget, clubId, targetUserId, targetAlias.alias_name, targetAlias.alias_color, now);

    // Insert user prefs for both
    db.prepare(`INSERT INTO club_user_prefs (user_id, club_id, is_pinned, is_muted, is_archived, last_read_at) VALUES (?, ?, 0, 0, 0, ?)`).run(req.user.id, clubId, now);
    db.prepare(`INSERT INTO club_user_prefs (user_id, club_id, is_pinned, is_muted, is_archived, last_read_at) VALUES (?, ?, 0, 0, 0, ?)`).run(targetUserId, clubId, now);

    // Welcome system message
    db.prepare(`
      INSERT INTO messages (id, club_id, sender_member_id, type, body, created_at, expires_at)
      VALUES (?, ?, ?, 'system', 'Direct Chat started. Messages are end-to-end encrypted and disappear after 7 days.', ?, ?)
    `).run(uuidv4(), clubId, memberIdCreator, now, new Date(Date.now() + 604800 * 1000).toISOString());

    const createdClub = db.prepare('SELECT * FROM clubs WHERE id = ?').get(clubId);
    return res.status(201).json({
      club: {
        ...createdClub,
        member_count: 2,
        my_alias: creatorAlias.alias_name,
        my_alias_color: creatorAlias.alias_color,
        my_role: 'admin'
      }
    });
  });

  return router;
}
