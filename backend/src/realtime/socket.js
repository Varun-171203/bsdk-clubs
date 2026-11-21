import { v4 as uuidv4 } from 'uuid';
import { verifyAccessToken } from '../common/auth.js';
import { assertNoIdentityLeak } from '../common/utils.js';

export function setupSocketGateway(io, db) {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) {
      return next(new Error('UNAUTHORIZED'));
    }
    try {
      const decoded = verifyAccessToken(String(token));
      const user = db.prepare('SELECT id, user_id, is_banned FROM users WHERE id = ?').get(decoded.sub);
      if (!user || user.is_banned) return next(new Error('UNAUTHORIZED'));
      socket.user = user;
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user.id;

    // Join dedicated user room for private 1-to-1 E2EE messaging and receipts
    socket.join(`user:${userId}`);

    // Auto-join all clubs this user belongs to
    const memberships = db.prepare('SELECT club_id FROM club_members WHERE user_id = ?').all(userId);
    for (const m of memberships) {
      socket.join(`club:${m.club_id}`);
    }

    // Deliver any queued/undelivered 1-to-1 E2EE messages to this user
    try {
      const nowIso = new Date().toISOString();
      const pendingMsgs = db.prepare(`
        SELECT id, sender_id, created_at FROM e2ee_messages
        WHERE recipient_id = ? AND status = 'sent' AND (expires_at IS NULL OR expires_at > ?)
      `).all(userId, nowIso);

      if (pendingMsgs.length > 0) {
        db.prepare(`
          UPDATE e2ee_messages
          SET status = 'delivered', delivered_at = ?
          WHERE recipient_id = ? AND status = 'sent'
        `).run(nowIso, userId);

        // Notify each sender that their message reached the recipient's device (Double Grey Tick)
        for (const msg of pendingMsgs) {
          io.to(`user:${msg.sender_id}`).emit('message_status_update', {
            message_id: msg.id,
            status: 'delivered',
            delivered_at: nowIso
          });
        }
      }
    } catch (err) {
      console.error('[Socket Gateway] Error processing pending delivery receipts:', err);
    }

    // ========================================================================
    // 1-to-1 E2EE Direct Messaging
    // ========================================================================
    socket.on('direct_message', (payload = {}, ack) => {
      try {
        const {
          recipient_id,
          ciphertext,
          iv,
          ephemeral_key = null,
          type = 'text',
          media_blob_ref = null,
          expires_at = null,
          club_id = null
        } = payload;

        if (!recipient_id || !ciphertext || !iv) {
          if (typeof ack === 'function') ack({ error: 'MISSING_REQUIRED_FIELDS' });
          return;
        }

        const nowIso = new Date().toISOString();
        const effectiveExpiresAt = expires_at || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

        // Ensure canonical conversation
        const [u1, u2] = userId < recipient_id ? [userId, recipient_id] : [recipient_id, userId];
        let conv = db.prepare('SELECT id FROM direct_conversations WHERE user1_id = ? AND user2_id = ?').get(u1, u2);
        if (!conv) {
          const convId = uuidv4();
          db.prepare(`
            INSERT INTO direct_conversations (id, user1_id, user2_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
          `).run(convId, u1, u2, nowIso, nowIso);
          conv = { id: convId };
        } else {
          db.prepare('UPDATE direct_conversations SET updated_at = ? WHERE id = ?').run(nowIso, conv.id);
        }

        // Check if recipient is currently online (has active socket in their room)
        const recipientRoom = io.sockets.adapter.rooms.get(`user:${recipient_id}`);
        const isRecipientOnline = Boolean(recipientRoom && recipientRoom.size > 0);
        const initialStatus = isRecipientOnline ? 'delivered' : 'sent';
        const deliveredAt = isRecipientOnline ? nowIso : null;

        const messageId = uuidv4();
        db.prepare(`
          INSERT INTO e2ee_messages (
            id, conversation_id, club_id, sender_id, recipient_id,
            ciphertext, iv, ephemeral_key, type, media_blob_ref,
            status, expires_at, created_at, delivered_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          messageId,
          conv.id,
          club_id,
          userId,
          recipient_id,
          String(ciphertext),
          String(iv),
          ephemeral_key ? String(ephemeral_key) : null,
          type,
          media_blob_ref ? String(media_blob_ref) : null,
          initialStatus,
          effectiveExpiresAt,
          nowIso,
          deliveredAt
        );

        const msgRecord = {
          id: messageId,
          conversation_id: conv.id,
          club_id,
          sender_id: userId,
          recipient_id,
          ciphertext: String(ciphertext),
          iv: String(iv),
          ephemeral_key: ephemeral_key ? String(ephemeral_key) : null,
          type,
          media_blob_ref,
          status: initialStatus,
          expires_at: effectiveExpiresAt,
          created_at: nowIso,
          delivered_at: deliveredAt,
          read_at: null
        };

        // Emit to recipient
        io.to(`user:${recipient_id}`).emit('direct_message', msgRecord);

        // Acknowledge to sender
        if (typeof ack === 'function') {
          ack({ success: true, message: msgRecord });
        }
        socket.emit('direct_message_sent', msgRecord);
      } catch (err) {
        console.error('[Socket Gateway] direct_message error:', err);
        if (typeof ack === 'function') ack({ error: 'FAILED_TO_SEND' });
      }
    });

    // ========================================================================
    // 1-to-1 Delivery & Read Receipts (Single / Double Grey / Double Blue Ticks)
    // ========================================================================
    socket.on('message_delivered', ({ message_id, sender_id } = {}) => {
      if (!message_id) return;
      const nowIso = new Date().toISOString();
      try {
        db.prepare(`
          UPDATE e2ee_messages
          SET status = 'delivered', delivered_at = ?
          WHERE id = ? AND recipient_id = ? AND status = 'sent'
        `).run(nowIso, message_id, userId);

        if (sender_id) {
          io.to(`user:${sender_id}`).emit('message_status_update', {
            message_id,
            status: 'delivered',
            delivered_at: nowIso
          });
        }
      } catch (e) {
        console.error('[Socket Gateway] message_delivered error:', e);
      }
    });

    socket.on('message_read', ({ message_id, sender_id, peer_id } = {}) => {
      const targetSender = sender_id || peer_id;
      const nowIso = new Date().toISOString();

      try {
        if (message_id) {
          db.prepare(`
            UPDATE e2ee_messages
            SET status = 'read', read_at = ?
            WHERE id = ? AND recipient_id = ? AND status != 'read'
          `).run(nowIso, message_id, userId);

          if (targetSender) {
            io.to(`user:${targetSender}`).emit('message_status_update', {
              message_id,
              status: 'read',
              read_at: nowIso
            });
          }
        } else if (targetSender) {
          // Bulk mark all unread messages from this sender as read
          db.prepare(`
            UPDATE e2ee_messages
            SET status = 'read', read_at = ?
            WHERE recipient_id = ? AND sender_id = ? AND status != 'read'
          `).run(nowIso, userId, targetSender);

          io.to(`user:${targetSender}`).emit('message_status_update', {
            peer_id: userId,
            status: 'read',
            read_at: nowIso
          });
        }
      } catch (e) {
        console.error('[Socket Gateway] message_read error:', e);
      }
    });

    // ========================================================================
    // 1-to-1 Direct Typing Indicator
    // ========================================================================
    socket.on('direct_typing', ({ recipient_id, is_typing = true } = {}) => {
      if (!recipient_id) return;
      io.to(`user:${recipient_id}`).emit('direct_typing', {
        sender_id: userId,
        is_typing: Boolean(is_typing)
      });
    });

    // ========================================================================
    // Club Messaging & Alias-Only Typing
    // ========================================================================
    socket.on('subscribe', ({ club_id } = {}) => {
      if (!club_id) return;
      const member = db.prepare('SELECT id FROM club_members WHERE club_id = ? AND user_id = ?').get(club_id, userId);
      if (member) {
        socket.join(`club:${club_id}`);
      }
    });

    socket.on('typing', ({ club_id, is_typing = true } = {}) => {
      if (!club_id) return;
      const member = db.prepare('SELECT alias_name, alias_color FROM club_members WHERE club_id = ? AND user_id = ?').get(club_id, userId);
      if (!member) return;

      const payload = assertNoIdentityLeak({
        club_id,
        alias_name: member.alias_name,
        alias_color: member.alias_color,
        is_typing: Boolean(is_typing)
      });
      socket.to(`club:${club_id}`).emit('typing', payload);
    });

    // ========================================================================
    // Secure WhatsApp-Style Realtime Calling Signaling
    // ========================================================================
    socket.on('call:initiate', (payload = {}) => {
      const {
        room_id,
        to_user_id,
        club_id,
        call_type = 'voice',
        caller_name = 'Caller',
        caller_avatar = null,
        caller_alias = null,
        caller_alias_color = null
      } = payload;

      if (!room_id) return;
      socket.join(`call_room:${room_id}`);

      if (to_user_id) {
        // Direct 1-to-1 call
        io.to(`user:${to_user_id}`).emit('call:incoming', {
          room_id,
          caller_id: userId,
          caller_name,
          caller_avatar,
          call_type,
          is_group: false
        });
      } else if (club_id) {
        // Group Club voice-only call (shows alias only!)
        socket.to(`club:${club_id}`).emit('call:incoming', {
          room_id,
          club_id,
          caller_id: userId,
          caller_alias,
          caller_alias_color,
          call_type: 'voice',
          is_group: true
        });
      }
    });

    socket.on('call:join_room', ({ room_id, alias_name, alias_color, is_video } = {}) => {
      if (!room_id) return;
      socket.join(`call_room:${room_id}`);
      socket.to(`call_room:${room_id}`).emit('call:user_joined', {
        user_id: userId,
        socket_id: socket.id,
        alias_name: alias_name || 'Member',
        alias_color: alias_color || '#128C7E',
        is_video: Boolean(is_video)
      });
    });

    socket.on('call:answer', ({ room_id, to_user_id } = {}) => {
      if (!room_id) return;
      socket.join(`call_room:${room_id}`);
      if (to_user_id) {
        io.to(`user:${to_user_id}`).emit('call:answered', { room_id, respondent_id: userId });
      } else {
        socket.to(`call_room:${room_id}`).emit('call:answered', { room_id, respondent_id: userId });
      }
    });

    socket.on('call:reject', ({ room_id, to_user_id, reason = 'declined' } = {}) => {
      if (!room_id) return;
      if (to_user_id) {
        io.to(`user:${to_user_id}`).emit('call:rejected', { room_id, reason, user_id: userId });
      }
      socket.to(`call_room:${room_id}`).emit('call:rejected', { room_id, reason, user_id: userId });
    });

    socket.on('call:signal', ({ room_id, to_socket_id, to_user_id, signal } = {}) => {
      if (!room_id || !signal) return;
      if (to_socket_id) {
        io.to(to_socket_id).emit('call:signal', {
          from_socket_id: socket.id,
          from_user_id: userId,
          room_id,
          signal
        });
      } else if (to_user_id) {
        io.to(`user:${to_user_id}`).emit('call:signal', {
          from_socket_id: socket.id,
          from_user_id: userId,
          room_id,
          signal
        });
      } else {
        socket.to(`call_room:${room_id}`).emit('call:signal', {
          from_socket_id: socket.id,
          from_user_id: userId,
          room_id,
          signal
        });
      }
    });

    socket.on('call:leave', ({ room_id } = {}) => {
      if (!room_id) return;
      socket.leave(`call_room:${room_id}`);
      socket.to(`call_room:${room_id}`).emit('call:user_left', { user_id: userId, socket_id: socket.id });
    });

    // ========================================================================
    // Disconnect: update last_seen
    // ========================================================================
    socket.on('disconnect', () => {
      try {
        const nowIso = new Date().toISOString();
        db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(nowIso, userId);
      } catch {}
    });
  });
}
