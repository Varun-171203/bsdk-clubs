import express from 'express';
import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { sendError, hashPhoneNumber } from '../common/utils.js';

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

function generateShortCode(prefix = 'GANG') {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let rand = '';
  for (let i = 0; i < 4; i++) {
    rand += chars.charAt(crypto.randomInt(0, chars.length));
  }
  return prefix ? `${prefix}-${rand}` : rand;
}

export function createInvitesRouter(db, requireAuth) {
  const router = express.Router();

  // Helper to resolve invite from invites table or clubs table
  function resolveInviteHandler(req, res) {
    const code = String(req.params.code || '').trim().toUpperCase();

    // 1. Check invites table
    const invite = db.prepare(`
      SELECT id, code, owner_id, type, club_id, qr_data, use_count, created_at, revoked_at
      FROM invites
      WHERE code = ?
    `).get(code);

    if (invite) {
      if (invite.revoked_at) {
        return sendError(res, 410, 'INVITE_REVOKED', 'This invite link has been revoked or reset.');
      }

      // Increment use_count
      db.prepare('UPDATE invites SET use_count = use_count + 1 WHERE id = ?').run(invite.id);

      if (invite.type === 'club' && invite.club_id) {
        const club = db.prepare(`
          SELECT id, name, photo_url, description, disappearing_seconds
          FROM clubs WHERE id = ?
        `).get(invite.club_id);

        if (!club) {
          return sendError(res, 404, 'CLUB_NOT_FOUND', 'The associated club is no longer available.');
        }

        const memberCount = db.prepare('SELECT COUNT(*) as count FROM club_members WHERE club_id = ?').get(invite.club_id)?.count || 0;

        return res.json({
          valid: true,
          type: 'club',
          code: invite.code,
          qr_data: invite.qr_data,
          club: {
            id: club.id,
            name: club.name,
            photo_url: club.photo_url,
            description: club.description,
            member_count: memberCount,
            disappearing_seconds: club.disappearing_seconds
          }
        });
      }

      // Type === 'user'
      const owner = db.prepare(`
        SELECT id, user_id, real_name, profile_photo_url, about
        FROM users WHERE id = ?
      `).get(invite.owner_id);

      if (!owner) {
        return sendError(res, 404, 'USER_NOT_FOUND', 'User account not found.');
      }

      return res.json({
        valid: true,
        type: 'user',
        code: invite.code,
        qr_data: invite.qr_data,
        user: {
          id: owner.id,
          user_id: owner.user_id,
          real_name: owner.real_name || owner.user_id,
          profile_photo_url: owner.profile_photo_url,
          about: owner.about
        }
      });
    }

    // 2. If not found in invites table, check clubs table directly (e.g. HOSTEL42, GOA2026)
    const directClub = db.prepare(`
      SELECT id, name, photo_url, description, invite_code, disappearing_seconds
      FROM clubs WHERE UPPER(invite_code) = ?
    `).get(code);

    if (directClub) {
      const memberCount = db.prepare('SELECT COUNT(*) as count FROM club_members WHERE club_id = ?').get(directClub.id)?.count || 0;

      return res.json({
        valid: true,
        type: 'club',
        code: directClub.invite_code,
        qr_data: `bsdk:invite:${directClub.invite_code}`,
        club: {
          id: directClub.id,
          name: directClub.name,
          photo_url: directClub.photo_url,
          description: directClub.description,
          member_count: memberCount,
          disappearing_seconds: directClub.disappearing_seconds
        }
      });
    }

    // 3. Check users table directly (e.g. user_id or personal invite_code)
    const directUser = db.prepare(`
      SELECT id, user_id, real_name, profile_photo_url, about
      FROM users WHERE UPPER(user_id) = ?
    `).get(code);

    if (directUser) {
      return res.json({
        valid: true,
        type: 'user',
        code: directUser.user_id,
        qr_data: `bsdk:user:${directUser.id}:${directUser.user_id}`,
        user: {
          id: directUser.id,
          user_id: directUser.user_id,
          real_name: directUser.real_name || directUser.user_id,
          profile_photo_url: directUser.profile_photo_url,
          about: directUser.about
        }
      });
    }

    return sendError(res, 404, 'INVITE_NOT_FOUND', 'This invite code does not exist.');
  }

  // ========================================================================
  // POST /invites/code
  // Get or regenerate personal gang invite code + QR payload
  // ========================================================================
  router.post('/invites/code', requireAuth, (req, res) => {
    const { regenerate = false } = req.body || {};

    if (!regenerate) {
      const existing = db.prepare(`
        SELECT id, code, owner_id, type, qr_data, use_count, created_at
        FROM invites
        WHERE owner_id = ? AND type = 'user' AND revoked_at IS NULL
        ORDER BY created_at DESC LIMIT 1
      `).get(req.user.id);

      if (existing) {
        return res.json({
          code: existing.code,
          qr_data: existing.qr_data,
          type: existing.type,
          use_count: existing.use_count,
          created_at: existing.created_at
        });
      }
    }

    // Revoke old active user codes
    if (regenerate) {
      db.prepare(`
        UPDATE invites
        SET revoked_at = ?
        WHERE owner_id = ? AND type = 'user' AND revoked_at IS NULL
      `).run(new Date().toISOString(), req.user.id);
    }

    const id = uuidv4();
    const code = generateShortCode('GANG');
    const qrData = `bsdk:user:${req.user.id}:${code}`;
    const nowIso = new Date().toISOString();

    db.prepare(`
      INSERT INTO invites (id, code, owner_id, type, club_id, qr_data, use_count, created_at)
      VALUES (?, ?, ?, 'user', NULL, ?, 0, ?)
    `).run(id, code, req.user.id, qrData, nowIso);

    return res.status(201).json({
      code,
      qr_data: qrData,
      type: 'user',
      use_count: 0,
      created_at: nowIso
    });
  });

  // ========================================================================
  // POST /invites/reset-user-code
  // Immediately revokes old QR code and issues a fresh one
  // ========================================================================
  router.post('/invites/reset-user-code', requireAuth, (req, res) => {
    const nowIso = new Date().toISOString();

    // Revoke all previous active user invites
    db.prepare(`
      UPDATE invites
      SET revoked_at = ?
      WHERE owner_id = ? AND type = 'user' AND revoked_at IS NULL
    `).run(nowIso, req.user.id);

    const id = uuidv4();
    const code = generateShortCode('GANG');
    const qrData = `bsdk:user:${req.user.id}:${code}`;

    db.prepare(`
      INSERT INTO invites (id, code, owner_id, type, club_id, qr_data, use_count, created_at)
      VALUES (?, ?, ?, 'user', NULL, ?, 0, ?)
    `).run(id, code, req.user.id, qrData, nowIso);

    return res.json({
      success: true,
      code,
      qr_data: qrData,
      revoked_at: nowIso
    });
  });

  // ========================================================================
  // GET /invites/resolve/:code & GET /invites/preview/:code
  // ========================================================================
  router.get('/invites/resolve/:code', resolveInviteHandler);
  router.get('/invites/preview/:code', resolveInviteHandler);

  // ========================================================================
  // POST /invites/club/:club_id/code
  // ========================================================================
  router.post('/invites/club/:club_id/code', requireAuth, (req, res) => {
    const { club_id } = req.params;
    const { regenerate = false } = req.body || {};

    const membership = db.prepare(`
      SELECT role FROM club_members WHERE club_id = ? AND user_id = ?
    `).get(club_id, req.user.id);

    if (!membership) {
      return sendError(res, 403, 'FORBIDDEN', 'You must be a member of this club to generate invites.');
    }

    if (!regenerate) {
      const existing = db.prepare(`
        SELECT id, code, owner_id, type, club_id, qr_data, use_count, created_at
        FROM invites
        WHERE club_id = ? AND type = 'club' AND revoked_at IS NULL
        ORDER BY created_at DESC LIMIT 1
      `).get(club_id);

      if (existing) {
        return res.json({
          code: existing.code,
          qr_data: existing.qr_data,
          type: 'club',
          club_id: existing.club_id,
          use_count: existing.use_count,
          created_at: existing.created_at
        });
      }
    }

    if (regenerate) {
      db.prepare(`
        UPDATE invites
        SET revoked_at = ?
        WHERE club_id = ? AND type = 'club' AND revoked_at IS NULL
      `).run(new Date().toISOString(), club_id);
    }

    const id = uuidv4();
    const code = generateShortCode('CLUB');
    const qrData = `bsdk:invite:${code}`;
    const nowIso = new Date().toISOString();

    db.prepare(`
      INSERT INTO invites (id, code, owner_id, type, club_id, qr_data, use_count, created_at)
      VALUES (?, ?, ?, 'club', ?, ?, 0, ?)
    `).run(id, code, req.user.id, club_id, qrData, nowIso);

    return res.status(201).json({
      code,
      qr_data: qrData,
      type: 'club',
      club_id,
      use_count: 0,
      created_at: nowIso
    });
  });

  // ========================================================================
  // POST /invites/revoke
  // ========================================================================
  router.post('/invites/revoke', requireAuth, (req, res) => {
    const { code } = req.body || {};
    const cleanCode = String(code || '').trim().toUpperCase();

    const invite = db.prepare(`
      SELECT id, owner_id, club_id, type, revoked_at
      FROM invites WHERE code = ?
    `).get(cleanCode);

    if (!invite) {
      return sendError(res, 404, 'INVITE_NOT_FOUND', 'Invite code not found.');
    }

    if (invite.revoked_at) {
      return res.json({ success: true, code: cleanCode, already_revoked: true });
    }

    let authorized = invite.owner_id === req.user.id;
    if (!authorized && invite.club_id) {
      const adminCheck = db.prepare(`
        SELECT role FROM club_members WHERE club_id = ? AND user_id = ? AND role = 'admin'
      `).get(invite.club_id, req.user.id);
      authorized = Boolean(adminCheck);
    }

    if (!authorized) {
      return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to revoke this invite.');
    }

    const nowIso = new Date().toISOString();
    db.prepare('UPDATE invites SET revoked_at = ? WHERE id = ?').run(nowIso, invite.id);

    return res.json({
      success: true,
      code: cleanCode,
      revoked_at: nowIso
    });
  });

  // ========================================================================
  // POST /invites/track
  // Tracks an invite in invite_tracking table (with phone hash)
  // ========================================================================
  router.post('/invites/track', requireAuth, (req, res) => {
    const { phone, phone_hash, invite_method = 'whatsapp' } = req.body || {};
    const phoneHash = phone_hash || (phone ? hashPhoneNumber(phone) : null);
    if (!phoneHash) {
      return sendError(res, 400, 'VALIDATION', 'Phone number or phone_hash is required to track invite.');
    }
    const nowIso = new Date().toISOString();

    const existing = db.prepare(`
      SELECT id, inviter_id, phone_hash, invite_method, invited_at, joined_at, reminded_at
      FROM invite_tracking
      WHERE inviter_id = ? AND phone_hash = ?
    `).get(req.user.id, phoneHash);

    if (existing) {
      db.prepare(`
        UPDATE invite_tracking
        SET invite_method = ?, reminded_at = ?
        WHERE id = ?
      `).run(invite_method, nowIso, existing.id);

      return res.json({
        success: true,
        phone_hash: phoneHash,
        status: existing.joined_at ? 'joined' : 'invited',
        invited_at: existing.invited_at,
        reminded_at: nowIso
      });
    }

    const id = uuidv4();
    db.prepare(`
      INSERT INTO invite_tracking (id, inviter_id, phone_hash, invite_method, invited_at, joined_at, reminded_at)
      VALUES (?, ?, ?, ?, ?, NULL, NULL)
    `).run(id, req.user.id, phoneHash, invite_method, nowIso);

    return res.status(201).json({
      success: true,
      phone_hash: phoneHash,
      status: 'invited',
      invited_at: nowIso
    });
  });

  // ========================================================================
  // POST /invites/remind
  // Enforces 3-day reminder rule!
  // ========================================================================
  router.post('/invites/remind', requireAuth, (req, res) => {
    const { phone, phone_hash, invite_method = 'whatsapp' } = req.body || {};
    const phoneHash = phone_hash || (phone ? hashPhoneNumber(phone) : null);
    if (!phoneHash) {
      return sendError(res, 400, 'VALIDATION', 'Phone number or phone_hash is required.');
    }
    const record = db.prepare(`
      SELECT id, inviter_id, phone_hash, invited_at, joined_at, reminded_at
      FROM invite_tracking
      WHERE inviter_id = ? AND phone_hash = ?
    `).get(req.user.id, phoneHash);

    if (!record) {
      return sendError(res, 404, 'NOT_INVITED', 'This contact has not been invited yet.');
    }

    if (record.joined_at) {
      return sendError(res, 400, 'ALREADY_JOINED', 'This contact has already joined BSDK Clubs.');
    }

    const lastTime = new Date(record.reminded_at || record.invited_at).getTime();
    const elapsed = Date.now() - lastTime;

    if (elapsed < THREE_DAYS_MS) {
      const remainingMs = THREE_DAYS_MS - elapsed;
      const daysRemaining = Math.max(1, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
      return sendError(
        res,
        429,
        'COOLDOWN_ACTIVE',
        `3-day reminder cooldown active. Please wait ${daysRemaining} more day(s) before reminding.`
      );
    }

    const nowIso = new Date().toISOString();
    db.prepare(`
      UPDATE invite_tracking
      SET reminded_at = ?, invite_method = ?
      WHERE id = ?
    `).run(nowIso, invite_method, record.id);

    return res.json({
      success: true,
      reminded: true,
      reminded_at: nowIso
    });
  });

  return router;
}
