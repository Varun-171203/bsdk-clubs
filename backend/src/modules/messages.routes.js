import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { sendError, assertNoIdentityLeak } from '../common/utils.js';

const ONE_HOUR_MS = 60 * 60 * 1000;
const MAX_MEDIA_BYTES = 10 * 1024 * 1024; // 10 MB per Section 2.4

export function createMessagesRouter(db, requireAuth, io) {
  const router = express.Router();
  const uploadsDir = path.resolve(process.cwd(), 'data', 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  function getMembership(clubId, userId) {
    return db.prepare('SELECT * FROM club_members WHERE club_id = ? AND user_id = ?').get(clubId, userId);
  }

  function isMuted(membership) {
    if (!membership?.muted_until) return false;
    return new Date(membership.muted_until).getTime() > Date.now();
  }

  // Hydrate a message row into STRICTLY ANONYMOUS client format
  function formatMessage(row, myMemberId) {
    // Reactions aggregated by emoji (no member IDs exposed!)
    const reactionRows = db.prepare(`
      SELECT emoji, COUNT(*) as count,
             MAX(CASE WHEN member_id = ? THEN 1 ELSE 0 END) as reacted_by_me
      FROM message_reactions
      WHERE message_id = ?
      GROUP BY emoji
    `).all(myMemberId || '', row.id);

    // Reply-quote preview (alias only!)
    let replyTo = null;
    if (row.reply_to_id) {
      const parent = db.prepare(`
        SELECT m.id, m.type, m.body, m.deleted_at, cm.alias_name, cm.alias_color
        FROM messages m
        JOIN club_members cm ON cm.id = m.sender_member_id
        WHERE m.id = ?
      `).get(row.reply_to_id);
      if (parent) {
        replyTo = {
          id: parent.id,
          alias_name: parent.alias_name,
          alias_color: parent.alias_color,
          body: parent.deleted_at ? 'This message was deleted' : (parent.type === 'image' ? '📷 Snap photo' : parent.body)
        };
      }
    }

    // Anonymous Poll hydration (NEVER returns voter names or member_ids!)
    let poll = null;
    if (row.type === 'poll' && !row.deleted_at) {
      const pollRow = db.prepare('SELECT id, question, multi_choice FROM polls WHERE message_id = ?').get(row.id);
      if (pollRow) {
        const options = db.prepare('SELECT id, text, vote_count FROM poll_options WHERE poll_id = ?').all(pollRow.id);
        const myVotes = myMemberId
          ? db.prepare('SELECT option_id FROM poll_votes WHERE poll_id = ? AND member_id = ?').all(pollRow.id, myMemberId).map((v) => v.option_id)
          : [];
        const totalVotes = options.reduce((acc, o) => acc + o.vote_count, 0);
        poll = {
          id: pollRow.id,
          question: pollRow.question,
          multi_choice: Boolean(pollRow.multi_choice),
          total_votes: totalVotes,
          my_votes: myVotes,
          options: options.map((o) => ({
            id: o.id,
            text: o.text,
            vote_count: o.vote_count,
            percentage: totalVotes > 0 ? Math.round((o.vote_count / totalVotes) * 100) : 0
          }))
        };
      }
    }

    const readCount = db.prepare('SELECT COUNT(*) as c FROM read_receipts WHERE message_id = ?').get(row.id).c;

    const formatted = {
      id: row.id,
      club_id: row.club_id,
      sender_club_member_id: String(row.sender_member_id),
      client_message_id: row.client_message_id || null,
      alias_name: row.alias_name,
      alias_color: row.alias_color,
      type: row.type,
      body: row.deleted_at ? 'This message was deleted' : row.body,
      media_url: row.deleted_at ? null : row.media_url,
      reply_to: replyTo,
      reactions: reactionRows.map((r) => ({
        emoji: r.emoji,
        count: r.count,
        reacted_by_me: Boolean(r.reacted_by_me)
      })),
      poll,
      read_count: readCount,
      created_at: row.created_at,
      expires_at: row.expires_at,
      deleted_at: row.deleted_at,
      is_mine: Boolean(myMemberId && String(row.sender_member_id) === String(myMemberId))
    };

    return assertNoIdentityLeak(formatted);
  }

  // GET /api/v1/clubs/:id/messages?before=&limit=50&search=
  router.get('/clubs/:id/messages', requireAuth, (req, res) => {
    const membership = getMembership(req.params.id, req.user.id);
    if (!membership) {
      return sendError(res, 403, 'NOT_MEMBER', 'You are not a member of this club.');
    }

    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const before = req.query.before ? String(req.query.before) : null;
    const search = req.query.search ? String(req.query.search).trim() : null;
    const nowIso = new Date().toISOString();

    // Hide content from platform-blocked users (FR-11)
    const blockedIds = db.prepare('SELECT blocked_user_id FROM blocks WHERE blocker_user_id = ?').all(req.user.id).map((b) => b.blocked_user_id);

    let query = `
      SELECT m.id, m.club_id, m.sender_member_id, m.client_message_id, m.type, m.body, m.media_url, m.reply_to_id,
             m.expires_at, m.created_at, m.deleted_at,
             cm.alias_name, cm.alias_color, cm.user_id as _filter_uid
      FROM messages m
      JOIN club_members cm ON cm.id = m.sender_member_id
      WHERE m.club_id = ? AND (m.expires_at IS NULL OR m.expires_at > ?)
    `;
    const params = [req.params.id, nowIso];

    if (before) {
      query += ' AND m.created_at < ?';
      params.push(before);
    }
    if (search) {
      query += ' AND (LOWER(m.body) LIKE ? OR LOWER(cm.alias_name) LIKE ?)';
      params.push(`%${search.toLowerCase()}%`, `%${search.toLowerCase()}%`);
    }

    query += ' ORDER BY m.created_at DESC LIMIT ?';
    params.push(limit);

    const rows = db.prepare(query).all(...params);
    const filtered = rows
      .filter((r) => !blockedIds.includes(r._filter_uid))
      .reverse();

    // Update last_read_at
    db.prepare(`
      INSERT INTO club_user_prefs (user_id, club_id, is_pinned, is_muted, is_archived, last_read_at)
      VALUES (?, ?, 0, 0, 0, ?)
      ON CONFLICT(user_id, club_id) DO UPDATE SET last_read_at = excluded.last_read_at
    `).run(req.user.id, req.params.id, nowIso);

    const messages = filtered.map((r) => formatMessage(r, membership.id));
    return res.json({ messages });
  });

  // POST /api/v1/clubs/:id/messages - Send message (server resolves alias from membership!)
  router.post('/clubs/:id/messages', requireAuth, (req, res) => {
    const membership = getMembership(req.params.id, req.user.id);
    if (!membership) {
      return sendError(res, 403, 'NOT_MEMBER', 'You are not a member of this club.');
    }
    if (isMuted(membership)) {
      return sendError(res, 403, 'MUTED', `You are muted by the admin until ${new Date(membership.muted_until).toLocaleString()}.`);
    }

    const { type = 'text', body = '', media_url = null, reply_to_id = null, client_message_id = null } = req.body || {};
    if (!['text', 'image'].includes(type)) {
      return sendError(res, 400, 'VALIDATION', 'Invalid message type.');
    }
    const cleanBody = String(body || '').trim();
    if (type === 'text' && !cleanBody) {
      return sendError(res, 400, 'VALIDATION', 'Message cannot be empty.');
    }
    if (type === 'image' && !media_url) {
      return sendError(res, 400, 'VALIDATION', 'Camera photo is required.');
    }

    const club = db.prepare('SELECT disappearing_seconds FROM clubs WHERE id = ?').get(req.params.id);
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAt = club?.disappearing_seconds > 0
      ? new Date(now.getTime() + club.disappearing_seconds * 1000).toISOString()
      : null;

    const msgId = uuidv4();
    db.prepare(`
      INSERT INTO messages (id, club_id, sender_member_id, client_message_id, type, body, media_url, reply_to_id, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(msgId, req.params.id, membership.id, client_message_id ? String(client_message_id).slice(0, 100) : null, type, cleanBody.slice(0, 4000), media_url, reply_to_id || null, expiresAt, nowIso);

    const inserted = db.prepare(`
      SELECT m.*, cm.alias_name, cm.alias_color
      FROM messages m JOIN club_members cm ON cm.id = m.sender_member_id
      WHERE m.id = ?
    `).get(msgId);

    const clientMsg = formatMessage(inserted, membership.id);

    // Broadcast strictly anonymous payload to club room
    // sender_club_member_id is included so each client evaluates is_mine correctly!
    if (io) {
      const broadcastMsg = assertNoIdentityLeak({ ...clientMsg });
      io.to(`club:${req.params.id}`).emit('message.new', {
        club_id: req.params.id,
        message: broadcastMsg
      });
    }

    return res.status(201).json({ message: clientMsg });
  });

  // DELETE /api/v1/messages/:id - Delete for everyone (own message, 1-hour window)
  router.delete('/messages/:id', requireAuth, (req, res) => {
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
    if (!msg) return sendError(res, 404, 'NOT_FOUND', 'Message not found.');

    const membership = getMembership(msg.club_id, req.user.id);
    if (!membership || msg.sender_member_id !== membership.id) {
      return sendError(res, 403, 'FORBIDDEN', 'You can only delete your own messages.');
    }

    const ageMs = Date.now() - new Date(msg.created_at).getTime();
    if (ageMs > ONE_HOUR_MS) {
      return sendError(res, 400, 'WINDOW_EXPIRED', 'Messages can only be deleted for everyone within 1 hour.');
    }

    const nowIso = new Date().toISOString();
    db.prepare(`
      UPDATE messages SET body = 'This message was deleted', media_url = NULL, deleted_at = ? WHERE id = ?
    `).run(nowIso, msg.id);

    if (io) {
      io.to(`club:${msg.club_id}`).emit('message.deleted', {
        club_id: msg.club_id,
        message_id: msg.id,
        deleted_at: nowIso
      });
    }

    return res.json({ message: 'Message was deleted for everyone.', deleted_at: nowIso });
  });

  // POST /api/v1/messages/:id/reactions - Toggle emoji reaction
  router.post('/messages/:id/reactions', requireAuth, (req, res) => {
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
    if (!msg) return sendError(res, 404, 'NOT_FOUND', 'Message not found.');

    const membership = getMembership(msg.club_id, req.user.id);
    if (!membership) return sendError(res, 403, 'NOT_MEMBER', 'You are not a member of this club.');

    const emoji = String(req.body?.emoji || '').trim();
    if (!emoji || emoji.length > 16) {
      return sendError(res, 400, 'VALIDATION', 'Please choose a valid emoji.');
    }

    const existing = db.prepare('SELECT id FROM message_reactions WHERE message_id = ? AND member_id = ? AND emoji = ?')
      .get(msg.id, membership.id, emoji);

    if (existing) {
      db.prepare('DELETE FROM message_reactions WHERE id = ?').run(existing.id);
    } else {
      db.prepare('INSERT INTO message_reactions (id, message_id, member_id, emoji) VALUES (?, ?, ?, ?)')
        .run(uuidv4(), msg.id, membership.id, emoji);
    }

    const agg = db.prepare(`
      SELECT emoji, COUNT(*) as count,
             MAX(CASE WHEN member_id = ? THEN 1 ELSE 0 END) as reacted_by_me
      FROM message_reactions WHERE message_id = ? GROUP BY emoji
    `).all(membership.id, msg.id);

    const reactions = agg.map((r) => ({
      emoji: r.emoji,
      count: r.count,
      reacted_by_me: Boolean(r.reacted_by_me)
    }));

    if (io) {
      io.to(`club:${msg.club_id}`).emit('message.reaction', {
        club_id: msg.club_id,
        message_id: msg.id,
        reactions: agg.map((r) => ({ emoji: r.emoji, count: r.count }))
      });
    }

    return res.json({ reactions });
  });

  // POST /api/v1/messages/:id/read - Mark read receipt
  router.post('/messages/:id/read', requireAuth, (req, res) => {
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
    if (!msg) return sendError(res, 404, 'NOT_FOUND', 'Message not found.');
    const membership = getMembership(msg.club_id, req.user.id);
    if (!membership) return sendError(res, 403, 'NOT_MEMBER', 'You are not a member of this club.');

    db.prepare(`
      INSERT OR IGNORE INTO read_receipts (message_id, member_id, read_at) VALUES (?, ?, ?)
    `).run(msg.id, membership.id, new Date().toISOString());

    const readCount = db.prepare('SELECT COUNT(*) as c FROM read_receipts WHERE message_id = ?').get(msg.id).c;
    return res.json({ read_count: readCount });
  });

  // POST /api/v1/clubs/:id/polls - Create anonymous poll (2-6 options)
  router.post('/clubs/:id/polls', requireAuth, (req, res) => {
    const membership = getMembership(req.params.id, req.user.id);
    if (!membership) return sendError(res, 403, 'NOT_MEMBER', 'You are not a member of this club.');
    if (isMuted(membership)) {
      return sendError(res, 403, 'MUTED', 'You have been muted by an admin.');
    }

    const { question, options, multi_choice = false, client_message_id = null } = req.body || {};
    const cleanQ = String(question || '').trim();
    const cleanOpts = Array.isArray(options)
      ? options.map((o) => String(o || '').trim()).filter(Boolean)
      : [];

    if (!cleanQ || cleanQ.length < 2) {
      return sendError(res, 400, 'VALIDATION', 'Please enter a poll question.');
    }
    if (cleanOpts.length < 2 || cleanOpts.length > 6) {
      return sendError(res, 400, 'VALIDATION', 'Poll must have between 2 and 6 options.');
    }

    const club = db.prepare('SELECT disappearing_seconds FROM clubs WHERE id = ?').get(req.params.id);
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAt = club?.disappearing_seconds > 0
      ? new Date(now.getTime() + club.disappearing_seconds * 1000).toISOString()
      : null;

    const msgId = uuidv4();
    const pollId = uuidv4();

    db.prepare(`
      INSERT INTO messages (id, club_id, sender_member_id, client_message_id, type, body, expires_at, created_at)
      VALUES (?, ?, ?, ?, 'poll', ?, ?, ?)
    `).run(msgId, req.params.id, membership.id, client_message_id ? String(client_message_id).slice(0, 100) : null, cleanQ, expiresAt, nowIso);

    db.prepare('INSERT INTO polls (id, message_id, question, multi_choice) VALUES (?, ?, ?, ?)')
      .run(pollId, msgId, cleanQ, multi_choice ? 1 : 0);

    const insertOpt = db.prepare('INSERT INTO poll_options (id, poll_id, text, vote_count) VALUES (?, ?, ?, 0)');
    for (const optText of cleanOpts) {
      insertOpt.run(uuidv4(), pollId, optText.slice(0, 140));
    }

    const inserted = db.prepare(`
      SELECT m.*, cm.alias_name, cm.alias_color
      FROM messages m JOIN club_members cm ON cm.id = m.sender_member_id
      WHERE m.id = ?
    `).get(msgId);

    const clientMsg = formatMessage(inserted, membership.id);
    if (io) {
      io.to(`club:${req.params.id}`).emit('message.new', {
        club_id: req.params.id,
        message: assertNoIdentityLeak({ ...clientMsg })
      });
    }

    return res.status(201).json({ message: clientMsg });
  });

  // POST /api/v1/polls/:id/vote - Vote anonymously (voter identity NEVER returned)
  router.post('/polls/:id/vote', requireAuth, (req, res) => {
    const pollRow = db.prepare(`
      SELECT p.*, m.club_id, m.id as msg_id
      FROM polls p JOIN messages m ON m.id = p.message_id
      WHERE p.id = ?
    `).get(req.params.id);
    if (!pollRow) return sendError(res, 404, 'NOT_FOUND', 'Poll not found.');

    const membership = getMembership(pollRow.club_id, req.user.id);
    if (!membership) return sendError(res, 403, 'NOT_MEMBER', 'You are not a member of this club.');

    const optionIds = Array.isArray(req.body?.option_ids) ? req.body.option_ids : [];
    const validOptions = db.prepare('SELECT id FROM poll_options WHERE poll_id = ?').all(pollRow.id).map((o) => o.id);
    const selected = [...new Set(optionIds.filter((id) => validOptions.includes(id)))];

    if (!pollRow.multi_choice && selected.length > 1) {
      return sendError(res, 400, 'VALIDATION', 'You can only choose one option in this poll.');
    }

    // Replace member's votes cleanly (prevents double voting!)
    db.prepare('DELETE FROM poll_votes WHERE poll_id = ? AND member_id = ?').run(pollRow.id, membership.id);
    const insertVote = db.prepare('INSERT INTO poll_votes (id, poll_id, option_id, member_id) VALUES (?, ?, ?, ?)');
    for (const optId of selected) {
      insertVote.run(uuidv4(), pollRow.id, optId, membership.id);
    }

    // Recompute exact vote_count per option
    for (const optId of validOptions) {
      const cnt = db.prepare('SELECT COUNT(*) as c FROM poll_votes WHERE option_id = ?').get(optId).c;
      db.prepare('UPDATE poll_options SET vote_count = ? WHERE id = ?').run(cnt, optId);
    }

    const updatedOptions = db.prepare('SELECT id, text, vote_count FROM poll_options WHERE poll_id = ?').all(pollRow.id);
    const totalVotes = updatedOptions.reduce((sum, o) => sum + o.vote_count, 0);
    const pollPayload = assertNoIdentityLeak({
      id: pollRow.id,
      message_id: pollRow.msg_id,
      question: pollRow.question,
      multi_choice: Boolean(pollRow.multi_choice),
      total_votes: totalVotes,
      my_votes: selected,
      options: updatedOptions.map((o) => ({
        id: o.id,
        text: o.text,
        vote_count: o.vote_count,
        percentage: totalVotes > 0 ? Math.round((o.vote_count / totalVotes) * 100) : 0
      }))
    });

    if (io) {
      io.to(`club:${pollRow.club_id}`).emit('poll.updated', {
        club_id: pollRow.club_id,
        poll: assertNoIdentityLeak({ ...pollPayload, my_votes: undefined })
      });
    }

    return res.json({ poll: pollPayload });
  });

  // POST /api/v1/media/upload-url - Returns local upload endpoint (S3 signed URL pattern)
  router.post('/media/upload-url', requireAuth, (req, res) => {
    const fileId = uuidv4();
    return res.json({
      upload_url: `/api/v1/media/upload/${fileId}`,
      media_url: `/uploads/${fileId}.jpg`
    });
  });

  // POST /api/v1/media/upload/:fileId - Accepts base64 image from in-app camera with magic-byte validation
  router.post('/media/upload/:fileId', requireAuth, (req, res) => {
    const { data_url } = req.body || {};
    if (!data_url || typeof data_url !== 'string') {
      return sendError(res, 400, 'VALIDATION', 'Camera image data is required.');
    }
    const match = data_url.match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (!match) {
      return sendError(res, 400, 'INVALID_FILE', 'Only JPEG, PNG, or WebP camera photos are allowed.');
    }

    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > MAX_MEDIA_BYTES) {
      return sendError(res, 400, 'FILE_TOO_LARGE', 'Image must be smaller than 10 MB.');
    }

    // Magic-byte verification (Section 7.4 security checklist)
    const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
    const isWebp = buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP';
    if (!isJpeg && !isPng && !isWebp) {
      return sendError(res, 400, 'INVALID_FILE', 'File magic-byte verification failed.');
    }

    const safeId = String(req.params.fileId).replace(/[^a-zA-Z0-9-]/g, '');
    const fileName = `${safeId}.${ext}`;
    fs.writeFileSync(path.join(uploadsDir, fileName), buffer);

    return res.status(201).json({ media_url: `/uploads/${fileName}` });
  });

  return router;
}
