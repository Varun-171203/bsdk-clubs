import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  sendError,
  generateUniqueAlias,
  generateInviteCode,
  isAliasClean,
  ALIAS_COLORS
} from '../common/utils.js';

const MAX_CLUB_MEMBERS = 256; // Section 2.4 constraint

export function createClubsRouter(db, requireAuth, io) {
  const router = express.Router();

  // Helper to fetch user's membership in a club
  function getMembership(clubId, userId) {
    return db.prepare('SELECT * FROM club_members WHERE club_id = ? AND user_id = ?').get(clubId, userId);
  }

  // POST /api/v1/clubs - Create club, creator becomes admin + auto-assigned alias
  router.post('/clubs', requireAuth, (req, res) => {
    const { name, description, photo_url, disappearing_seconds } = req.body || {};
    const cleanName = String(name || '').trim();
    if (!cleanName || cleanName.length < 2 || cleanName.length > 80) {
      return sendError(res, 400, 'VALIDATION', 'Club ka naam 2-80 characters ka hona chahiye.');
    }

    const allowedDisappearing = [0, 86400, 604800];
    const disp = allowedDisappearing.includes(Number(disappearing_seconds))
      ? Number(disappearing_seconds)
      : 604800; // Default 7 days

    const clubId = uuidv4();
    const inviteCode = generateInviteCode();
    const now = new Date().toISOString();
    const photo = photo_url || `https://api.dicebear.com/9.x/shapes/svg?seed=${encodeURIComponent(cleanName + inviteCode)}&backgroundColor=075e54`;

    db.prepare(`
      INSERT INTO clubs (id, name, photo_url, description, created_by, invite_code, disappearing_seconds, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(clubId, cleanName, photo, String(description || '').trim().slice(0, 300), req.user.id, inviteCode, disp, now);

    const { alias_name, alias_color } = generateUniqueAlias(new Set());
    const memberId = uuidv4();
    db.prepare(`
      INSERT INTO club_members (id, club_id, user_id, role, alias_name, alias_color, joined_at)
      VALUES (?, ?, ?, 'admin', ?, ?, ?)
    `).run(memberId, clubId, req.user.id, alias_name, alias_color, now);

    db.prepare(`
      INSERT INTO club_user_prefs (user_id, club_id, is_pinned, is_muted, is_archived, last_read_at)
      VALUES (?, ?, 0, 0, 0, ?)
    `).run(req.user.id, clubId, now);

    // Welcome system message
    db.prepare(`
      INSERT INTO messages (id, club_id, sender_member_id, type, body, created_at, expires_at)
      VALUES (?, ?, ?, 'system', ?, ?, ?)
    `).run(
      uuidv4(),
      clubId,
      memberId,
      `Club "${cleanName}" bana diya gaya hai! Chat mein sab anonymous aliases se bolenge.`,
      now,
      disp > 0 ? new Date(Date.now() + disp * 1000).toISOString() : null
    );

    const club = db.prepare('SELECT * FROM clubs WHERE id = ?').get(clubId);
    return res.status(201).json({
      club: {
        ...club,
        member_count: 1,
        my_alias: alias_name,
        my_alias_color: alias_color,
        my_role: 'admin'
      }
    });
  });

  // GET /api/v1/clubs - My clubs + last message (alias only!) + unread count + prefs
  router.get('/clubs', requireAuth, (req, res) => {
    const rows = db.prepare(`
      SELECT
        c.id, c.name, c.photo_url, c.description, c.invite_code, c.disappearing_seconds, c.created_at,
        cm.id as my_member_id, cm.role as my_role, cm.alias_name as my_alias, cm.alias_color as my_alias_color, cm.muted_until,
        COALESCE(p.is_pinned, 0) as is_pinned,
        COALESCE(p.is_muted, 0) as is_muted,
        COALESCE(p.is_archived, 0) as is_archived,
        p.last_read_at,
        (SELECT COUNT(*) FROM club_members cm2 WHERE cm2.club_id = c.id) as member_count
      FROM club_members cm
      JOIN clubs c ON c.id = cm.club_id
      LEFT JOIN club_user_prefs p ON p.club_id = c.id AND p.user_id = cm.user_id
      WHERE cm.user_id = ?
    `).all(req.user.id);

    const nowIso = new Date().toISOString();
    const clubs = rows.map((row) => {
      // Fetch latest non-expired message with ONLY alias_name (never user_id/real_name!)
      const lastMsg = db.prepare(`
        SELECT m.id, m.type, m.body, m.deleted_at, m.created_at, cm.alias_name, cm.alias_color
        FROM messages m
        JOIN club_members cm ON cm.id = m.sender_member_id
        WHERE m.club_id = ? AND (m.expires_at IS NULL OR m.expires_at > ?)
        ORDER BY m.created_at DESC
        LIMIT 1
      `).get(row.id, nowIso);

      const unreadCount = db.prepare(`
        SELECT COUNT(*) as cnt
        FROM messages m
        WHERE m.club_id = ?
          AND m.sender_member_id != ?
          AND (m.expires_at IS NULL OR m.expires_at > ?)
          AND (? IS NULL OR m.created_at > ?)
      `).get(row.id, row.my_member_id, nowIso, row.last_read_at, row.last_read_at).cnt;

      return {
        id: row.id,
        name: row.name,
        photo_url: row.photo_url,
        description: row.description,
        invite_code: row.invite_code,
        disappearing_seconds: row.disappearing_seconds,
        created_at: row.created_at,
        member_count: row.member_count,
        my_role: row.my_role,
        my_alias: row.my_alias,
        my_alias_color: row.my_alias_color,
        muted_until: row.muted_until,
        is_pinned: Boolean(row.is_pinned),
        is_muted: Boolean(row.is_muted),
        is_archived: Boolean(row.is_archived),
        unread_count: unreadCount,
        last_message: lastMsg
          ? {
              id: lastMsg.id,
              type: lastMsg.type,
              alias_name: lastMsg.alias_name,
              alias_color: lastMsg.alias_color,
              body: lastMsg.deleted_at ? 'This message was deleted' : (lastMsg.type === 'poll' ? `[Poll] ${lastMsg.body}` : lastMsg.type === 'image' ? '📷 Snap photo' : lastMsg.body),
              created_at: lastMsg.created_at
            }
          : null
      };
    });

    // Sort pinned first, then most recent activity
    clubs.sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
      const tA = a.last_message?.created_at || a.created_at;
      const tB = b.last_message?.created_at || b.created_at;
      return tB.localeCompare(tA);
    });

    return res.json({ clubs });
  });

  // GET /api/v1/clubs/preview/:inviteCode - Join preview BEFORE accepting (Page 3 Step 5)
  router.get('/clubs/preview/:inviteCode', requireAuth, (req, res) => {
    const code = String(req.params.inviteCode || '').trim().toUpperCase();
    const club = db.prepare('SELECT id, name, photo_url, description, disappearing_seconds, created_at FROM clubs WHERE UPPER(invite_code) = ?').get(code);
    if (!club) {
      return sendError(res, 404, 'NOT_FOUND', 'Ye invite code invalid ya expire ho chuka hai.');
    }
    const members = db.prepare(`
      SELECT u.id as user_id, u.real_name, u.profile_photo_url, cm.role
      FROM club_members cm
      JOIN users u ON u.id = cm.user_id
      WHERE cm.club_id = ?
      ORDER BY cm.role ASC, u.real_name ASC
    `).all(club.id);

    const alreadyMember = members.some((m) => m.user_id === req.user.id);
    return res.json({
      club: {
        ...club,
        member_count: members.length,
        already_member: alreadyMember,
        members // Real members visible before joining for trust!
      }
    });
  });

  // POST /api/v1/clubs/join - Join via invite_code + auto-assign unique per-group alias
  router.post('/clubs/join', requireAuth, (req, res) => {
    const code = String(req.body?.invite_code || '').trim().toUpperCase();
    if (!code) {
      return sendError(res, 400, 'VALIDATION', 'Invite code daalo.');
    }

    const club = db.prepare('SELECT * FROM clubs WHERE UPPER(invite_code) = ?').get(code);
    if (!club) {
      return sendError(res, 404, 'NOT_FOUND', 'Invite code galat hai ya admin ne reset kar diya hai.');
    }

    const existing = getMembership(club.id, req.user.id);
    if (existing) {
      return sendError(res, 409, 'ALREADY_MEMBER', 'Tum is club mein already member ho!');
    }

    const existingMembers = db.prepare('SELECT alias_name FROM club_members WHERE club_id = ?').all(club.id);
    if (existingMembers.length >= MAX_CLUB_MEMBERS) {
      return sendError(res, 400, 'CLUB_FULL', `Ye club full hai (max ${MAX_CLUB_MEMBERS} members).`);
    }

    const existingAliases = new Set(existingMembers.map((m) => m.alias_name));
    const { alias_name, alias_color } = generateUniqueAlias(existingAliases);
    const memberId = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO club_members (id, club_id, user_id, role, alias_name, alias_color, joined_at)
      VALUES (?, ?, ?, 'member', ?, ?, ?)
    `).run(memberId, club.id, req.user.id, alias_name, alias_color, now);

    db.prepare(`
      INSERT OR REPLACE INTO club_user_prefs (user_id, club_id, is_pinned, is_muted, is_archived, last_read_at)
      VALUES (?, ?, 0, 0, 0, ?)
    `).run(req.user.id, club.id, now);

    const sysMsgId = uuidv4();
    const disp = club.disappearing_seconds;
    db.prepare(`
      INSERT INTO messages (id, club_id, sender_member_id, type, body, created_at, expires_at)
      VALUES (?, ?, ?, 'system', ?, ?, ?)
    `).run(
      sysMsgId,
      club.id,
      memberId,
      `${alias_name} joined the club! Group Info mein real members dekh sakte ho.`,
      now,
      disp > 0 ? new Date(Date.now() + disp * 1000).toISOString() : null
    );

    if (io) {
      io.to(`club:${club.id}`).emit('member.joined', {
        club_id: club.id,
        alias_name,
        alias_color,
        member_count: existingMembers.length + 1
      });
    }

    return res.status(201).json({
      club: {
        ...club,
        my_alias: alias_name,
        my_alias_color: alias_color,
        my_role: 'member',
        member_count: existingMembers.length + 1
      }
    });
  });

  // GET /api/v1/clubs/:id - Club details
  router.get('/clubs/:id', requireAuth, (req, res) => {
    const membership = getMembership(req.params.id, req.user.id);
    if (!membership) {
      return sendError(res, 403, 'NOT_MEMBER', 'Tum is club ke member nahi ho.');
    }
    const club = db.prepare('SELECT * FROM clubs WHERE id = ?').get(req.params.id);
    const count = db.prepare('SELECT COUNT(*) as c FROM club_members WHERE club_id = ?').get(req.params.id).c;
    const pref = db.prepare('SELECT * FROM club_user_prefs WHERE user_id = ? AND club_id = ?').get(req.user.id, req.params.id);
    return res.json({
      club: {
        ...club,
        member_count: count,
        my_role: membership.role,
        my_alias: membership.alias_name,
        my_alias_color: membership.alias_color,
        muted_until: membership.muted_until,
        is_pinned: Boolean(pref?.is_pinned),
        is_muted: Boolean(pref?.is_muted),
        is_archived: Boolean(pref?.is_archived)
      }
    });
  });

  // PATCH /api/v1/clubs/:id - Admin update club info / disappearing setting
  router.patch('/clubs/:id', requireAuth, (req, res) => {
    const membership = getMembership(req.params.id, req.user.id);
    if (!membership || membership.role !== 'admin') {
      return sendError(res, 403, 'ADMIN_ONLY', 'Sirf Club Admin ye setting badal sakta hai.');
    }
    const club = db.prepare('SELECT * FROM clubs WHERE id = ?').get(req.params.id);
    if (!club) return sendError(res, 404, 'NOT_FOUND', 'Club nahi mila.');

    const nextName = req.body?.name !== undefined ? String(req.body.name).trim() : club.name;
    const nextDesc = req.body?.description !== undefined ? String(req.body.description).trim().slice(0, 300) : club.description;
    const nextPhoto = req.body?.photo_url !== undefined ? String(req.body.photo_url).trim() : club.photo_url;
    const allowedDisp = [0, 86400, 604800];
    const nextDisp = req.body?.disappearing_seconds !== undefined && allowedDisp.includes(Number(req.body.disappearing_seconds))
      ? Number(req.body.disappearing_seconds)
      : club.disappearing_seconds;

    if (!nextName || nextName.length < 2) {
      return sendError(res, 400, 'VALIDATION', 'Club ka naam kam se kam 2 characters ka hona chahiye.');
    }

    db.prepare(`
      UPDATE clubs SET name = ?, description = ?, photo_url = ?, disappearing_seconds = ? WHERE id = ?
    `).run(nextName, nextDesc, nextPhoto, nextDisp, club.id);

    const updated = db.prepare('SELECT * FROM clubs WHERE id = ?').get(club.id);
    return res.json({ club: updated });
  });

  // POST /api/v1/clubs/:id/reset-invite - Admin reset invite code
  router.post('/clubs/:id/reset-invite', requireAuth, (req, res) => {
    const membership = getMembership(req.params.id, req.user.id);
    if (!membership || membership.role !== 'admin') {
      return sendError(res, 403, 'ADMIN_ONLY', 'Sirf Admin invite link reset kar sakta hai.');
    }
    const newCode = generateInviteCode();
    db.prepare('UPDATE clubs SET invite_code = ? WHERE id = ?').run(newCode, req.params.id);
    return res.json({ invite_code: newCode });
  });

  // GET /api/v1/clubs/:id/members - Group Info REAL member list (NO alias_name returned here!)
  // NOTE: Intentionally returns real_name + photo ONLY, NEVER alias_name, so members cannot correlate alias -> real user!
  router.get('/clubs/:id/members', requireAuth, (req, res) => {
    const membership = getMembership(req.params.id, req.user.id);
    if (!membership) {
      return sendError(res, 403, 'NOT_MEMBER', 'Tum is club ke member nahi ho.');
    }
    const members = db.prepare(`
      SELECT u.id as user_id, u.user_id as handle, u.real_name, u.profile_photo_url, u.about,
             cm.role, cm.joined_at, cm.muted_until
      FROM club_members cm
      JOIN users u ON u.id = cm.user_id
      WHERE cm.club_id = ?
      ORDER BY CASE WHEN cm.role = 'admin' THEN 0 ELSE 1 END, u.real_name ASC
    `).all(req.params.id);

    return res.json({
      members: members.map((m) => ({
        ...m,
        is_me: m.user_id === req.user.id
      })),
      anonymity_note: 'Chat mein sab anonymous hain. Kaun sa message kisne bheja, ye members ko nahi dikhta.'
    });
  });

  // GET /api/v1/clubs/:id/my-alias - Only my own alias in this club
  router.get('/clubs/:id/my-alias', requireAuth, (req, res) => {
    const membership = getMembership(req.params.id, req.user.id);
    if (!membership) {
      return sendError(res, 403, 'NOT_MEMBER', 'Tum is club ke member nahi ho.');
    }
    return res.json({
      alias_name: membership.alias_name,
      alias_color: membership.alias_color,
      available_colors: ALIAS_COLORS
    });
  });

  // PATCH /api/v1/clubs/:id/my-alias - Member can change their display name anytime (FR-05)
  router.patch('/clubs/:id/my-alias', requireAuth, (req, res) => {
    const membership = getMembership(req.params.id, req.user.id);
    if (!membership) {
      return sendError(res, 403, 'NOT_MEMBER', 'Tum is club ke member nahi ho.');
    }

    const { alias_name, alias_color, randomize } = req.body || {};
    let nextAlias = membership.alias_name;
    let nextColor = membership.alias_color;

    if (randomize) {
      const others = db.prepare('SELECT alias_name FROM club_members WHERE club_id = ? AND user_id != ?').all(req.params.id, req.user.id);
      const generated = generateUniqueAlias(new Set(others.map((o) => o.alias_name)));
      nextAlias = generated.alias_name;
      nextColor = generated.alias_color;
    } else {
      if (alias_name !== undefined) {
        const trimmed = String(alias_name).trim();
        if (!isAliasClean(trimmed)) {
          return sendError(res, 400, 'INVALID_ALIAS', 'Ye display naam allowed nahi hai. Fun/weird naam rakho (3-28 chars, no offensive words).');
        }
        const collision = db.prepare('SELECT id FROM club_members WHERE club_id = ? AND LOWER(alias_name) = ? AND user_id != ?').get(
          req.params.id,
          trimmed.toLowerCase(),
          req.user.id
        );
        if (collision) {
          return sendError(res, 409, 'ALIAS_TAKEN', 'Is club mein ye alias koi aur use kar raha hai, dusra try karo!');
        }
        nextAlias = trimmed;
      }
      if (alias_color && ALIAS_COLORS.includes(alias_color)) {
        nextColor = alias_color;
      }
    }

    db.prepare('UPDATE club_members SET alias_name = ?, alias_color = ? WHERE id = ?').run(nextAlias, nextColor, membership.id);
    return res.json({ alias_name: nextAlias, alias_color: nextColor });
  });

  // PATCH /api/v1/clubs/:id/members/:userId - Admin make/remove admin or time-bound mute member
  router.patch('/clubs/:id/members/:userId', requireAuth, (req, res) => {
    const myMembership = getMembership(req.params.id, req.user.id);
    if (!myMembership || myMembership.role !== 'admin') {
      return sendError(res, 403, 'ADMIN_ONLY', 'Sirf Admin members manage kar sakta hai.');
    }

    const target = getMembership(req.params.id, req.params.userId);
    if (!target) {
      return sendError(res, 404, 'NOT_FOUND', 'Member is club mein nahi mila.');
    }

    const { role, mute_minutes } = req.body || {};
    if (role && ['admin', 'member'].includes(role)) {
      db.prepare('UPDATE club_members SET role = ? WHERE id = ?').run(role, target.id);
    }
    if (mute_minutes !== undefined) {
      const mutedUntil = Number(mute_minutes) > 0
        ? new Date(Date.now() + Number(mute_minutes) * 60 * 1000).toISOString()
        : null;
      db.prepare('UPDATE club_members SET muted_until = ? WHERE id = ?').run(mutedUntil, target.id);
    }

    return res.json({ message: 'Member permissions updated.' });
  });

  // DELETE /api/v1/clubs/:id/members/:userId - Admin remove member
  router.delete('/clubs/:id/members/:userId', requireAuth, (req, res) => {
    const myMembership = getMembership(req.params.id, req.user.id);
    if (!myMembership || myMembership.role !== 'admin') {
      return sendError(res, 403, 'ADMIN_ONLY', 'Sirf Admin kisi member ko remove kar sakta hai.');
    }
    if (req.params.userId === req.user.id) {
      return sendError(res, 400, 'VALIDATION', 'Khud ko remove karne ke liye Leave Club use karo.');
    }
    const target = getMembership(req.params.id, req.params.userId);
    if (!target) {
      return sendError(res, 404, 'NOT_FOUND', 'Member nahi mila.');
    }

    db.prepare('DELETE FROM club_members WHERE id = ?').run(target.id);
    db.prepare('DELETE FROM club_user_prefs WHERE club_id = ? AND user_id = ?').run(req.params.id, req.params.userId);

    if (io) {
      io.to(`club:${req.params.id}`).emit('member.removed', {
        club_id: req.params.id
      });
    }
    return res.json({ message: 'Member club se remove kar diya gaya hai.' });
  });

  // POST /api/v1/clubs/:id/leave - Leave club
  router.post('/clubs/:id/leave', requireAuth, (req, res) => {
    const myMembership = getMembership(req.params.id, req.user.id);
    if (!myMembership) {
      return sendError(res, 403, 'NOT_MEMBER', 'Tum is club ke member nahi ho.');
    }

    db.prepare('DELETE FROM club_members WHERE id = ?').run(myMembership.id);
    db.prepare('DELETE FROM club_user_prefs WHERE club_id = ? AND user_id = ?').run(req.params.id, req.user.id);

    // Promote oldest member if no admins left
    const adminsLeft = db.prepare("SELECT COUNT(*) as c FROM club_members WHERE club_id = ? AND role = 'admin'").get(req.params.id).c;
    if (adminsLeft === 0) {
      const nextAdmin = db.prepare('SELECT id FROM club_members WHERE club_id = ? ORDER BY joined_at ASC LIMIT 1').get(req.params.id);
      if (nextAdmin) {
        db.prepare("UPDATE club_members SET role = 'admin' WHERE id = ?").run(nextAdmin.id);
      }
    }

    return res.json({ message: 'Tumne club chhod diya hai.' });
  });

  // PATCH /api/v1/clubs/:id/prefs - Pin, Mute, Archive club in user's chat list
  router.patch('/clubs/:id/prefs', requireAuth, (req, res) => {
    const membership = getMembership(req.params.id, req.user.id);
    if (!membership) {
      return sendError(res, 403, 'NOT_MEMBER', 'Tum is club ke member nahi ho.');
    }
    const existing = db.prepare('SELECT * FROM club_user_prefs WHERE user_id = ? AND club_id = ?').get(req.user.id, req.params.id) || {
      is_pinned: 0,
      is_muted: 0,
      is_archived: 0,
      last_read_at: new Date().toISOString()
    };

    const isPinned = req.body?.is_pinned !== undefined ? (req.body.is_pinned ? 1 : 0) : existing.is_pinned;
    const isMuted = req.body?.is_muted !== undefined ? (req.body.is_muted ? 1 : 0) : existing.is_muted;
    const isArchived = req.body?.is_archived !== undefined ? (req.body.is_archived ? 1 : 0) : existing.is_archived;

    db.prepare(`
      INSERT INTO club_user_prefs (user_id, club_id, is_pinned, is_muted, is_archived, last_read_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, club_id) DO UPDATE SET
        is_pinned = excluded.is_pinned,
        is_muted = excluded.is_muted,
        is_archived = excluded.is_archived
    `).run(req.user.id, req.params.id, isPinned, isMuted, isArchived, existing.last_read_at || new Date().toISOString());

    return res.json({
      is_pinned: Boolean(isPinned),
      is_muted: Boolean(isMuted),
      is_archived: Boolean(isArchived)
    });
  });

  return router;
}
