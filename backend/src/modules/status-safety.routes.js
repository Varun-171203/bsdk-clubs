import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { sendError, assertNoIdentityLeak, mergeSettings } from '../common/utils.js';

export function createStatusSafetyRouter(db, requireAuth, io) {
  const router = express.Router();

  function getMembership(clubId, userId) {
    return db.prepare('SELECT * FROM club_members WHERE club_id = ? AND user_id = ?').get(clubId, userId);
  }

  // GET /api/v1/statuses - All active 24h statuses grouped by club (Updates tab)
  router.get('/statuses', requireAuth, (req, res) => {
    const nowIso = new Date().toISOString();
    const blockedIds = db.prepare('SELECT blocked_user_id FROM blocks WHERE blocker_user_id = ?').all(req.user.id).map((b) => b.blocked_user_id);

    const myClubs = db.prepare(`
      SELECT c.id, c.name, c.photo_url, cm.id as my_member_id, cm.alias_name as my_alias, cm.alias_color as my_alias_color,
             COALESCE(p.is_muted, 0) as is_muted
      FROM club_members cm
      JOIN clubs c ON c.id = cm.club_id
      LEFT JOIN club_user_prefs p ON p.club_id = c.id AND p.user_id = cm.user_id
      WHERE cm.user_id = ?
      ORDER BY c.name ASC
    `).all(req.user.id);

    const clubGroups = myClubs.map((club) => {
      const rows = db.prepare(`
        SELECT s.id, s.club_id, s.member_id, s.type, s.media_url, s.caption, s.bg_color, s.expires_at, s.created_at,
               cm.alias_name, cm.alias_color, cm.user_id as _filter_uid,
               (SELECT COUNT(*) FROM status_views sv WHERE sv.status_id = s.id) as view_count,
               EXISTS(SELECT 1 FROM status_views sv WHERE sv.status_id = s.id AND sv.member_id = ?) as viewed_by_me
        FROM statuses s
        JOIN club_members cm ON cm.id = s.member_id
        WHERE s.club_id = ? AND s.expires_at > ?
        ORDER BY s.created_at DESC
      `).all(club.my_member_id, club.id, nowIso);

      const statuses = rows
        .filter((r) => !blockedIds.includes(r._filter_uid))
        .map((r) => {
          const isMine = r.member_id === club.my_member_id;
          return assertNoIdentityLeak({
            id: r.id,
            club_id: r.club_id,
            alias_name: r.alias_name,
            alias_color: r.alias_color,
            type: r.type,
            media_url: r.media_url,
            caption: r.caption,
            bg_color: r.bg_color || '#075E54',
            expires_at: r.expires_at,
            created_at: r.created_at,
            is_mine: isMine,
            viewed_by_me: Boolean(r.viewed_by_me),
            // View count ONLY shown to poster, never viewer names (Section 3.5.5)
            view_count: isMine ? r.view_count : undefined
          });
        });

      return {
        club_id: club.id,
        club_name: club.name,
        club_photo: club.photo_url,
        my_alias: club.my_alias,
        my_alias_color: club.my_alias_color,
        is_muted: Boolean(club.is_muted),
        statuses
      };
    });

    return res.json({ clubs: clubGroups });
  });

  // GET /api/v1/clubs/:id/statuses - Club-wise active statuses (alias only)
  router.get('/clubs/:id/statuses', requireAuth, (req, res) => {
    const membership = getMembership(req.params.id, req.user.id);
    if (!membership) return sendError(res, 403, 'NOT_MEMBER', 'You are not a member of this club.');

    const nowIso = new Date().toISOString();
    const rows = db.prepare(`
      SELECT s.id, s.club_id, s.member_id, s.type, s.media_url, s.caption, s.bg_color, s.expires_at, s.created_at,
             cm.alias_name, cm.alias_color,
             (SELECT COUNT(*) FROM status_views sv WHERE sv.status_id = s.id) as view_count
      FROM statuses s
      JOIN club_members cm ON cm.id = s.member_id
      WHERE s.club_id = ? AND s.expires_at > ?
      ORDER BY s.created_at DESC
    `).all(req.params.id, nowIso);

    const statuses = rows.map((r) => {
      const isMine = r.member_id === membership.id;
      return assertNoIdentityLeak({
        id: r.id,
        club_id: r.club_id,
        alias_name: r.alias_name,
        alias_color: r.alias_color,
        type: r.type,
        media_url: r.media_url,
        caption: r.caption,
        bg_color: r.bg_color || '#075E54',
        expires_at: r.expires_at,
        created_at: r.created_at,
        is_mine: isMine,
        view_count: isMine ? r.view_count : undefined
      });
    });

    return res.json({ statuses });
  });

  // POST /api/v1/clubs/:id/statuses - Post 24h anonymous status for a club
  router.post('/clubs/:id/statuses', requireAuth, (req, res) => {
    const membership = getMembership(req.params.id, req.user.id);
    if (!membership) return sendError(res, 403, 'NOT_MEMBER', 'You are not a member of this club.');

    const { type = 'text', media_url = null, caption = '', bg_color = '#075E54' } = req.body || {};
    if (!['text', 'image'].includes(type)) {
      return sendError(res, 400, 'VALIDATION', 'Status must be text or image.');
    }
    const cleanCaption = String(caption || '').trim().slice(0, 500);
    if (type === 'text' && !cleanCaption) {
      return sendError(res, 400, 'VALIDATION', 'Status cannot be empty.');
    }
    if (type === 'image' && !media_url) {
      return sendError(res, 400, 'VALIDATION', 'Camera photo is required.');
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const statusId = uuidv4();

    db.prepare(`
      INSERT INTO statuses (id, club_id, member_id, type, media_url, caption, bg_color, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(statusId, req.params.id, membership.id, type, media_url, cleanCaption, bg_color, expiresAt, now.toISOString());

    const payload = assertNoIdentityLeak({
      id: statusId,
      club_id: req.params.id,
      alias_name: membership.alias_name,
      alias_color: membership.alias_color,
      type,
      media_url,
      caption: cleanCaption,
      bg_color,
      expires_at: expiresAt,
      created_at: now.toISOString(),
      is_mine: true,
      view_count: 0
    });

    if (io) {
      io.to(`club:${req.params.id}`).emit('status.new', {
        club_id: req.params.id,
        status: assertNoIdentityLeak({ ...payload, is_mine: false, view_count: undefined })
      });
    }

    return res.status(201).json({ status: payload });
  });

  // POST /api/v1/statuses/:id/view - Record anonymous view count
  router.post('/statuses/:id/view', requireAuth, (req, res) => {
    const status = db.prepare('SELECT * FROM statuses WHERE id = ?').get(req.params.id);
    if (!status) return sendError(res, 404, 'NOT_FOUND', 'Status not found or expired.');
    const membership = getMembership(status.club_id, req.user.id);
    if (!membership) return sendError(res, 403, 'NOT_MEMBER', 'You are not a member of this club.');

    if (status.member_id !== membership.id) {
      db.prepare('INSERT OR IGNORE INTO status_views (status_id, member_id, viewed_at) VALUES (?, ?, ?)')
        .run(status.id, membership.id, new Date().toISOString());
    }
    return res.json({ viewed: true });
  });

  // POST /api/v1/reports - Report message or user (reporter identity never shown to target)
  router.post('/reports', requireAuth, (req, res) => {
    const { reported_user_id = null, message_id = null, club_id = null, reason, details = '' } = req.body || {};
    const cleanReason = String(reason || '').trim();
    if (!cleanReason) {
      return sendError(res, 400, 'VALIDATION', 'Please select a reason for reporting.');
    }

    // Server-side resolution of reported_user_id from message_id (stored ONLY in moderation table, never returned to reporter!)
    let resolvedReportedUser = reported_user_id;
    let resolvedClubId = club_id;
    if (message_id && !resolvedReportedUser) {
      const msgRow = db.prepare(`
        SELECT m.club_id, cm.user_id
        FROM messages m JOIN club_members cm ON cm.id = m.sender_member_id
        WHERE m.id = ?
      `).get(message_id);
      if (msgRow) {
        resolvedReportedUser = msgRow.user_id;
        resolvedClubId = resolvedClubId || msgRow.club_id;
      }
    }

    const id = uuidv4();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO reports (id, reporter_user_id, reported_user_id, club_id, message_id, reason, details, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'Under Review', ?)
    `).run(id, req.user.id, resolvedReportedUser, resolvedClubId, message_id, cleanReason.slice(0, 120), String(details).slice(0, 500), now);

    return res.status(201).json({
      report: {
        id,
        club_id: resolvedClubId,
        reason: cleanReason,
        status: 'Under Review',
        created_at: now
      },
      message: 'Report submitted successfully. Your identity remains confidential.'
    });
  });

  // GET /api/v1/reports - My submitted reports history (Settings -> Privacy -> Report History)
  router.get('/reports', requireAuth, (req, res) => {
    const rows = db.prepare(`
      SELECT r.id, r.reason, r.details, r.status, r.created_at, c.name as club_name
      FROM reports r
      LEFT JOIN clubs c ON c.id = r.club_id
      WHERE r.reporter_user_id = ?
      ORDER BY r.created_at DESC
    `).all(req.user.id);
    return res.json({ reports: rows });
  });

  // GET /api/v1/blocks - My blocked users list
  router.get('/blocks', requireAuth, (req, res) => {
    const rows = db.prepare(`
      SELECT b.blocked_user_id as user_id, b.created_at, u.real_name, u.profile_photo_url, u.user_id as handle
      FROM blocks b
      JOIN users u ON u.id = b.blocked_user_id
      WHERE b.blocker_user_id = ?
      ORDER BY b.created_at DESC
    `).all(req.user.id);
    return res.json({ blocks: rows });
  });

  // POST /api/v1/blocks - Block user (platform level)
  router.post('/blocks', requireAuth, (req, res) => {
    const { blocked_user_id } = req.body || {};
    if (!blocked_user_id || blocked_user_id === req.user.id) {
      return sendError(res, 400, 'VALIDATION', 'Please select a valid user.');
    }
    const target = db.prepare('SELECT id FROM users WHERE id = ?').get(blocked_user_id);
    if (!target) return sendError(res, 404, 'NOT_FOUND', 'User not found.');

    db.prepare(`
      INSERT OR IGNORE INTO blocks (id, blocker_user_id, blocked_user_id, created_at) VALUES (?, ?, ?, ?)
    `).run(uuidv4(), req.user.id, blocked_user_id, new Date().toISOString());

    return res.status(201).json({ message: 'User blocked. You will no longer see their content.' });
  });

  // DELETE /api/v1/blocks/:userId - Unblock user
  router.delete('/blocks/:userId', requireAuth, (req, res) => {
    db.prepare('DELETE FROM blocks WHERE blocker_user_id = ? AND blocked_user_id = ?').run(req.user.id, req.params.userId);
    return res.json({ message: 'User unblocked.' });
  });

  // GET /api/v1/settings - Get user's WhatsApp-style persisted settings
  router.get('/settings', requireAuth, (req, res) => {
    const row = db.prepare('SELECT settings_json FROM user_settings WHERE user_id = ?').get(req.user.id);
    return res.json({ settings: mergeSettings(row?.settings_json) });
  });

  // PATCH /api/v1/settings - Update & persist settings
  router.patch('/settings', requireAuth, (req, res) => {
    const existingRow = db.prepare('SELECT settings_json FROM user_settings WHERE user_id = ?').get(req.user.id);
    const current = mergeSettings(existingRow?.settings_json);
    const patch = req.body || {};

    const updated = {
      account: { ...current.account, ...(patch.account || {}) },
      privacy: { ...current.privacy, ...(patch.privacy || {}) },
      chats: { ...current.chats, ...(patch.chats || {}) },
      notifications: { ...current.notifications, ...(patch.notifications || {}) },
      storage: { ...current.storage, ...(patch.storage || {}) },
      language: patch.language || current.language
    };

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO user_settings (user_id, settings_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at
    `).run(req.user.id, JSON.stringify(updated), now);

    return res.json({ settings: updated });
  });

  // GET /api/v1/storage-stats - Per-club storage usage for Settings -> Storage & Data
  router.get('/storage-stats', requireAuth, (req, res) => {
    const rows = db.prepare(`
      SELECT c.id, c.name, c.photo_url,
             COUNT(m.id) as message_count,
             SUM(CASE WHEN m.media_url IS NOT NULL THEN 1 ELSE 0 END) as media_count
      FROM club_members cm
      JOIN clubs c ON c.id = cm.club_id
      LEFT JOIN messages m ON m.club_id = c.id
      WHERE cm.user_id = ?
      GROUP BY c.id
    `).all(req.user.id);

    const clubs = rows.map((r) => ({
      ...r,
      estimated_kb: Math.max(12, r.message_count * 2 + (r.media_count || 0) * 180)
    }));
    const total_kb = clubs.reduce((sum, c) => sum + c.estimated_kb, 0);
    return res.json({ total_kb, clubs });
  });

  // POST /api/v1/notifications/token - Register push token
  router.post('/notifications/token', requireAuth, (req, res) => {
    const { fcm_token, device = 'web' } = req.body || {};
    if (!fcm_token) return sendError(res, 400, 'VALIDATION', 'Push notification token is required.');
    db.prepare(`
      INSERT INTO notifications_tokens (id, user_id, fcm_token, device, updated_at) VALUES (?, ?, ?, ?, ?)
    `).run(uuidv4(), req.user.id, String(fcm_token), String(device), new Date().toISOString());
    return res.json({ registered: true });
  });

  return router;
}
