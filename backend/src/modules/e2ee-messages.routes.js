import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { v4 as uuidv4 } from 'uuid';
import { sendError } from '../common/utils.js';

export function createE2EEMessagesRouter(db, requireAuth, io) {
  const router = express.Router();

  const mediaDir = path.resolve(process.cwd(), 'data', 'encrypted_media');
  if (!fs.existsSync(mediaDir)) {
    fs.mkdirSync(mediaDir, { recursive: true });
  }

  // ========================================================================
  // POST /messages
  // Send 1-to-1 End-to-End Encrypted Message
  // CRITICAL PRIVACY: SERVER ONLY STORES CIPHERTEXT, NEVER PLAINTEXT!
  // Payload: { recipient_id, ciphertext, iv, ephemeral_key, type, media_blob_ref, expires_at, club_id }
  // ========================================================================
  router.post('/messages', requireAuth, (req, res) => {
    const {
      recipient_id,
      ciphertext,
      iv,
      ephemeral_key = null,
      type = 'text',
      media_blob_ref = null,
      expires_at = null,
      club_id = null
    } = req.body || {};

    if (!recipient_id) {
      return sendError(res, 400, 'MISSING_RECIPIENT', 'recipient_id is required.');
    }
    if (!ciphertext || !iv) {
      return sendError(res, 400, 'MISSING_CIPHERTEXT', 'ciphertext and iv are required for E2EE delivery.');
    }

    const recipient = db.prepare('SELECT id, is_banned FROM users WHERE id = ?').get(recipient_id);
    if (!recipient || recipient.is_banned) {
      return sendError(res, 404, 'RECIPIENT_NOT_FOUND', 'Recipient user does not exist or is unavailable.');
    }

    const nowIso = new Date().toISOString();

    // Canonical conversation sorting to guarantee single conversation row per user pair
    const [u1, u2] = req.user.id < recipient_id ? [req.user.id, recipient_id] : [recipient_id, req.user.id];

    let conversation = db.prepare(`
      SELECT id FROM direct_conversations WHERE user1_id = ? AND user2_id = ?
    `).get(u1, u2);

    if (!conversation) {
      const convId = uuidv4();
      db.prepare(`
        INSERT INTO direct_conversations (id, user1_id, user2_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(convId, u1, u2, nowIso, nowIso);
      conversation = { id: convId };
    } else {
      db.prepare('UPDATE direct_conversations SET updated_at = ? WHERE id = ?').run(nowIso, conversation.id);
    }

    // Default 7-day disappearing message if not explicitly specified
    // 7 days = 604800 seconds
    const effectiveExpiresAt = expires_at || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const messageId = uuidv4();
    const status = 'sent';

    db.prepare(`
      INSERT INTO e2ee_messages (
        id, conversation_id, club_id, sender_id, recipient_id,
        ciphertext, iv, ephemeral_key, type, media_blob_ref,
        status, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      messageId,
      conversation.id,
      club_id,
      req.user.id,
      recipient_id,
      String(ciphertext),
      String(iv),
      ephemeral_key ? String(ephemeral_key) : null,
      type,
      media_blob_ref ? String(media_blob_ref) : null,
      status,
      effectiveExpiresAt,
      nowIso
    );

    const messageRecord = {
      id: messageId,
      conversation_id: conversation.id,
      club_id,
      sender_id: req.user.id,
      recipient_id,
      ciphertext: String(ciphertext),
      iv: String(iv),
      ephemeral_key: ephemeral_key ? String(ephemeral_key) : null,
      type,
      media_blob_ref,
      status,
      expires_at: effectiveExpiresAt,
      created_at: nowIso,
      delivered_at: null,
      read_at: null
    };

    // Realtime delivery via WebSocket
    if (io) {
      // Send to recipient's direct room
      io.to(`user:${recipient_id}`).emit('direct_message', messageRecord);
      // Send echo/ack to sender's devices
      io.to(`user:${req.user.id}`).emit('direct_message_sent', messageRecord);
    }

    return res.status(201).json({
      message: messageRecord
    });
  });

  // ========================================================================
  // GET /messages/direct/:peer_id
  // Retrieve 1-to-1 ciphertext messages exchanged with :peer_id
  // ========================================================================
  router.get('/messages/direct/:peer_id', requireAuth, (req, res) => {
    const peerId = req.params.peer_id;
    const nowIso = new Date().toISOString();

    const messages = db.prepare(`
      SELECT id, conversation_id, club_id, sender_id, recipient_id,
             ciphertext, iv, ephemeral_key, type, media_blob_ref,
             status, expires_at, created_at, delivered_at, read_at
      FROM e2ee_messages
      WHERE ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?))
        AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY created_at ASC
    `).all(req.user.id, peerId, peerId, req.user.id, nowIso);

    // Mark unread incoming messages as read
    const unreadIncoming = messages.filter((m) => m.recipient_id === req.user.id && m.status !== 'read');
    if (unreadIncoming.length > 0) {
      db.prepare(`
        UPDATE e2ee_messages
        SET status = 'read', read_at = ?
        WHERE recipient_id = ? AND sender_id = ? AND status != 'read'
      `).run(nowIso, req.user.id, peerId);

      // Realtime receipt emission to sender
      if (io) {
        io.to(`user:${peerId}`).emit('message_read', {
          reader_id: req.user.id,
          peer_id: peerId,
          read_at: nowIso
        });
      }

      // Update response copy
      for (const m of messages) {
        if (m.recipient_id === req.user.id && m.status !== 'read') {
          m.status = 'read';
          m.read_at = nowIso;
        }
      }
    }

    return res.json({
      peer_id: peerId,
      messages
    });
  });

  // ========================================================================
  // GET /direct-conversations
  // Get all active 1-to-1 chats for the authenticated user
  // ========================================================================
  router.get('/direct-conversations', requireAuth, (req, res) => {
    const convs = db.prepare(`
      SELECT id, user1_id, user2_id, updated_at
      FROM direct_conversations
      WHERE user1_id = ? OR user2_id = ?
      ORDER BY updated_at DESC
    `).all(req.user.id, req.user.id);

    const nowIso = new Date().toISOString();
    const result = [];

    for (const c of convs) {
      const peerId = c.user1_id === req.user.id ? c.user2_id : c.user1_id;
      const peer = db.prepare(`
        SELECT id, user_id, real_name, profile_photo_url, about, last_seen
        FROM users WHERE id = ?
      `).get(peerId);

      if (!peer) continue;

      const lastMsg = db.prepare(`
        SELECT id, sender_id, type, status, created_at, expires_at
        FROM e2ee_messages
        WHERE conversation_id = ? AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY created_at DESC LIMIT 1
      `).get(c.id, nowIso);

      const unreadCount = db.prepare(`
        SELECT COUNT(*) as c FROM e2ee_messages
        WHERE conversation_id = ? AND recipient_id = ? AND status != 'read'
          AND (expires_at IS NULL OR expires_at > ?)
      `).get(c.id, req.user.id, nowIso)?.c || 0;

      result.push({
        conversation_id: c.id,
        peer: {
          id: peer.id,
          user_id: peer.user_id,
          real_name: peer.real_name || peer.user_id,
          profile_photo_url: peer.profile_photo_url,
          about: peer.about,
          last_seen: peer.last_seen
        },
        last_message: lastMsg || null,
        unread_count: unreadCount,
        updated_at: c.updated_at
      });
    }

    return res.json({ conversations: result });
  });

  // ========================================================================
  // POST /media/upload
  // Upload encrypted media blob (photo, voice note, document)
  // Payload: { encrypted_blob: 'base64...', mime_type, file_name } OR binary
  // ========================================================================
  router.post('/media/upload', requireAuth, express.raw({ type: 'application/octet-stream', limit: '50mb' }), (req, res) => {
    const mediaId = uuidv4();
    let buffer;
    let mimeType = 'application/octet-stream';

    if (Buffer.isBuffer(req.body) && req.body.length > 0) {
      buffer = req.body;
      mimeType = req.headers['content-type'] || 'application/octet-stream';
    } else if (req.body && req.body.encrypted_blob) {
      buffer = Buffer.from(req.body.encrypted_blob, 'base64');
      mimeType = req.body.mime_type || 'application/octet-stream';
    } else {
      return sendError(res, 400, 'INVALID_MEDIA', 'Media payload required as raw binary or base64 encrypted_blob.');
    }

    const filePath = path.join(mediaDir, `${mediaId}.bin`);
    fs.writeFileSync(filePath, buffer);

    const nowIso = new Date().toISOString();
    db.prepare(`
      INSERT INTO encrypted_media (id, uploader_id, file_path, mime_type, byte_size, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(mediaId, req.user.id, filePath, mimeType, buffer.length, nowIso);

    return res.status(201).json({
      id: mediaId,
      media_url: `/api/v1/media/${mediaId}`,
      mime_type: mimeType,
      byte_size: buffer.length,
      created_at: nowIso
    });
  });

  // ========================================================================
  // GET /media/:id
  // Retrieve raw encrypted media blob
  // ========================================================================
  router.get('/media/:id', (req, res) => {
    const { id } = req.params;

    const row = db.prepare(`
      SELECT id, file_path, mime_type, byte_size FROM encrypted_media WHERE id = ?
    `).get(id);

    if (!row || !fs.existsSync(row.file_path)) {
      return sendError(res, 404, 'MEDIA_NOT_FOUND', 'Encrypted media blob not found or expired.');
    }

    res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', row.byte_size);
    res.setHeader('Content-Disposition', `inline; filename="${row.id}"`);
    res.setHeader('Cache-Control', 'private, max-age=86400');

    const stream = fs.createReadStream(row.file_path);
    stream.pipe(res);
  });

  return router;
}
