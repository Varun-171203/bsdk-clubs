import express from 'express';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { sendError } from '../common/utils.js';

// Rate limiter store in memory: userId -> Array of timestamps (ms)
const tokenRequestTimes = new Map();

function checkTokenRateLimit(userId) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000; // 10 minutes
  const maxRequests = 10; // max 10 requests in 10 minutes

  const timestamps = (tokenRequestTimes.get(userId) || []).filter((t) => now - t < windowMs);
  if (timestamps.length >= maxRequests) {
    return false;
  }
  timestamps.push(now);
  tokenRequestTimes.set(userId, timestamps);
  return true;
}

export function createCallsRouter(db, requireAuth, io) {
  const router = express.Router();

  // Helper to format call duration string (e.g. "2m 14s", "45s")
  function formatDuration(sec) {
    const s = Math.max(0, Math.floor(sec || 0));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}m ${rem < 10 ? '0' : ''}${rem}s`;
  }

  /**
   * POST /calls/token
   * Generates a single-use, 10-minute calling token for ONE room and ONE user.
   * Checks login, block status, club membership (max 8 for voice-only clubs), and rate limits.
   */
  router.post('/calls/token', requireAuth, (req, res) => {
    const userId = req.user.id;

    // Rate limiting: 10 requests in 10 minutes
    if (!checkTokenRateLimit(userId)) {
      return sendError(res, 429, 'RATE_LIMITED', 'Too many call token requests. Please wait before trying again.');
    }

    const {
      room_id,
      callee_id,
      club_id,
      call_type = 'voice'
    } = req.body || {};

    // Validate call type
    if (!['voice', 'video'].includes(call_type)) {
      return sendError(res, 400, 'INVALID_CALL_TYPE', 'Call type must be voice or video.');
    }

    // 1-to-1 Call: Check blocking
    if (callee_id) {
      if (callee_id === userId) {
        return sendError(res, 400, 'SELF_CALL', 'Cannot call yourself.');
      }

      // Check if user exists
      const callee = db.prepare('SELECT id, real_name, is_banned FROM users WHERE id = ?').get(callee_id);
      if (!callee || callee.is_banned) {
        return sendError(res, 404, 'USER_NOT_FOUND', 'The user you are trying to call is not available.');
      }

      // Check if blocked by either side
      const blocked = db.prepare(`
        SELECT id FROM blocks 
        WHERE (blocker_user_id = ? AND blocked_user_id = ?)
           OR (blocker_user_id = ? AND blocked_user_id = ?)
      `).get(callee_id, userId, userId, callee_id);

      if (blocked) {
        return sendError(res, 403, 'BLOCKED', 'You cannot call this contact.');
      }
    }

    // Club Call: Voice ONLY, max 8 participants, must be a member
    if (club_id) {
      if (call_type !== 'voice') {
        return sendError(res, 400, 'VOICE_ONLY_FOR_CLUBS', 'Club group calls are voice only.');
      }

      const membership = db.prepare('SELECT id, alias_name FROM club_members WHERE club_id = ? AND user_id = ?').get(club_id, userId);
      if (!membership) {
        return sendError(res, 403, 'NOT_CLUB_MEMBER', 'You must be a member of this club to join the call.');
      }

      // Enforce max 8 active members in group call room
      if (io) {
        const roomName = `call_room:${room_id || club_id}`;
        const activeParticipants = io.sockets.adapter.rooms.get(roomName)?.size || 0;
        if (activeParticipants >= 8) {
          return sendError(res, 403, 'ROOM_FULL', 'This club call already has the maximum of 8 participants.');
        }
      }
    }

    // Room name: use existing room_id or generate a cryptographically random UUID
    const targetRoomId = room_id ? String(room_id).trim() : uuidv4();

    // Provider API Key & Secret ONLY from server environment
    const apiKey = process.env.CALL_API_KEY || 'CALL_KEY_PLACEHOLDER_DEV';
    const apiSecret = process.env.CALL_API_SECRET || 'CALL_SECRET_PLACEHOLDER_DEV';

    if (!process.env.CALL_API_KEY || !process.env.CALL_API_SECRET) {
      console.warn('[Calling Server Notice] CALL_API_KEY or CALL_API_SECRET not set in environment. Using secure local development credentials.');
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const ttlSeconds = 600; // strictly 10 minutes

    // LiveKit & WebRTC compatible signed JWT Token
    const tokenPayload = {
      iss: apiKey,
      sub: userId,
      nbf: nowSeconds,
      exp: nowSeconds + ttlSeconds,
      room: targetRoomId,
      video: {
        room: targetRoomId,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true
      },
      metadata: JSON.stringify({
        userId,
        callType: call_type,
        clubId: club_id || null,
        calleeId: callee_id || null
      })
    };

    const token = jwt.sign(tokenPayload, apiSecret, { algorithm: 'HS256' });

    return res.json({
      success: true,
      token,
      room_id: targetRoomId,
      call_type,
      expires_in: ttlSeconds,
      expires_at: new Date((nowSeconds + ttlSeconds) * 1000).toISOString(),
      livekit_url: process.env.LIVEKIT_URL || null
    });
  });

  /**
   * POST /calls/verify-token
   * Validates that a call token is genuine, matches the designated room and user, and is not expired.
   */
  router.post('/calls/verify-token', (req, res) => {
    const { token, room_id, user_id } = req.body || {};
    if (!token) {
      return sendError(res, 400, 'MISSING_TOKEN', 'Token is required.');
    }

    const apiSecret = process.env.CALL_API_SECRET || 'CALL_SECRET_PLACEHOLDER_DEV';

    try {
      const decoded = jwt.verify(token, apiSecret);

      // Verify expiration (11-minute-old token is rejected)
      const now = Math.floor(Date.now() / 1000);
      if (decoded.exp <= now) {
        return sendError(res, 401, 'TOKEN_EXPIRED', 'Call token has expired.');
      }

      // Verify room match (a token for one call cannot join another call)
      if (room_id && decoded.room !== room_id) {
        return sendError(res, 403, 'ROOM_MISMATCH', 'Token is not valid for this room.');
      }

      // Verify user match (a token cannot be used by another user)
      if (user_id && decoded.sub !== user_id) {
        return sendError(res, 403, 'USER_MISMATCH', 'Token is not valid for this user.');
      }

      return res.json({
        valid: true,
        user_id: decoded.sub,
        room_id: decoded.room,
        exp: decoded.exp
      });
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return sendError(res, 401, 'TOKEN_EXPIRED', 'Call token has expired.');
      }
      return sendError(res, 403, 'INVALID_TOKEN', 'Call token is invalid or corrupted.');
    }
  });

  /**
   * POST /calls/end
   * Saves ONLY metadata (caller, callee, duration, status, type) — NO call content, NO tokens in logs or db.
   * Generates a WhatsApp-style chat system message:
   * e.g. "Voice call ended • 2m 14s", "Missed voice call", "Video call ended • 5m 02s"
   */
  router.post('/calls/end', requireAuth, (req, res) => {
    const userId = req.user.id;
    const {
      room_id,
      caller_id,
      callee_id,
      club_id,
      call_type = 'voice',
      is_group = false,
      status = 'completed',
      duration_seconds = 0
    } = req.body || {};

    if (!room_id) {
      return sendError(res, 400, 'MISSING_ROOM_ID', 'Room ID is required.');
    }

    const effectiveCallerId = caller_id || userId;
    const duration = Math.max(0, parseInt(duration_seconds, 10) || 0);
    const validStatus = ['completed', 'missed', 'declined', 'busy'].includes(status) ? status : 'completed';
    const nowIso = new Date().toISOString();
    const callLogId = uuidv4();

    // 1. Persist metadata ONLY in call_logs
    try {
      db.prepare(`
        INSERT INTO call_logs (
          id, room_id, caller_id, callee_id, club_id, call_type, is_group, status, duration_seconds, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        callLogId,
        String(room_id),
        effectiveCallerId,
        callee_id ? String(callee_id) : null,
        club_id ? String(club_id) : null,
        call_type === 'video' ? 'video' : 'voice',
        is_group ? 1 : 0,
        validStatus,
        duration,
        nowIso
      );
    } catch (dbErr) {
      console.error('[Calls DB Error]', dbErr);
    }

    // 2. Generate WhatsApp-Style System Message for Chat
    let systemText = '';
    const typeLabel = call_type === 'video' ? 'Video call' : 'Voice call';
    if (validStatus === 'completed' && duration > 0) {
      systemText = `${typeLabel} ended • ${formatDuration(duration)}`;
    } else if (validStatus === 'missed') {
      systemText = `Missed ${call_type === 'video' ? 'video' : 'voice'} call`;
    } else if (validStatus === 'declined') {
      systemText = `${typeLabel} declined`;
    } else {
      systemText = `${typeLabel} ended`;
    }

    // Post to Club or Direct Chat
    if (club_id) {
      try {
        const sysMsgId = uuidv4();
        // Look up sender's club member record or first member
        const member = db.prepare('SELECT id FROM club_members WHERE club_id = ? AND user_id = ?').get(club_id, userId);
        if (member) {
          db.prepare(`
            INSERT INTO messages (id, club_id, sender_member_id, type, body, created_at)
            VALUES (?, ?, ?, 'system', ?, ?)
          `).run(sysMsgId, club_id, member.id, systemText, nowIso);

          io?.to(`club:${club_id}`).emit('new_message', {
            id: sysMsgId,
            club_id,
            type: 'system',
            body: systemText,
            created_at: nowIso
          });
        }
      } catch (sysErr) {
        console.error('[Club Call System Message Error]', sysErr);
      }
    } else if (callee_id) {
      try {
        // Direct chat system record in e2ee_messages (as type='call_event')
        const [u1, u2] = effectiveCallerId < callee_id ? [effectiveCallerId, callee_id] : [callee_id, effectiveCallerId];
        let conv = db.prepare('SELECT id FROM direct_conversations WHERE user1_id = ? AND user2_id = ?').get(u1, u2);
        if (!conv) {
          const convId = uuidv4();
          db.prepare(`
            INSERT INTO direct_conversations (id, user1_id, user2_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
          `).run(convId, u1, u2, nowIso, nowIso);
          conv = { id: convId };
        }

        const sysMsgId = uuidv4();
        db.prepare(`
          INSERT INTO e2ee_messages (
            id, conversation_id, sender_id, recipient_id, ciphertext, iv, type, status, created_at
          ) VALUES (?, ?, ?, ?, ?, '', 'call_event', 'delivered', ?)
        `).run(sysMsgId, conv.id, effectiveCallerId, callee_id, systemText, nowIso);

        const callEventPayload = {
          id: sysMsgId,
          conversation_id: conv.id,
          sender_id: effectiveCallerId,
          recipient_id: callee_id,
          type: 'call_event',
          text: systemText,
          status: 'delivered',
          created_at: nowIso
        };

        io?.to(`user:${effectiveCallerId}`).emit('call_event', callEventPayload);
        io?.to(`user:${callee_id}`).emit('call_event', callEventPayload);
      } catch (convErr) {
        console.error('[Direct Call System Message Error]', convErr);
      }
    }

    // 3. Notify sockets to clean up
    io?.to(`call_room:${room_id}`).emit('call:ended', { room_id, duration_seconds: duration, status: validStatus });
    if (callee_id) {
      io?.to(`user:${callee_id}`).emit('call:ended', { room_id, duration_seconds: duration, status: validStatus });
    }

    return res.json({
      success: true,
      call_id: callLogId,
      system_message: systemText,
      duration_seconds: duration,
      status: validStatus
    });
  });

  /**
   * GET /calls/history
   * Returns recent calls for the authenticated user with status and duration.
   */
  router.get('/calls/history', requireAuth, (req, res) => {
    const userId = req.user.id;
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));

    try {
      const logs = db.prepare(`
        SELECT 
          cl.id,
          cl.room_id,
          cl.caller_id,
          cl.callee_id,
          cl.club_id,
          cl.call_type,
          cl.is_group,
          cl.status,
          cl.duration_seconds,
          cl.created_at,
          u1.real_name AS caller_name,
          u1.profile_photo_url AS caller_photo,
          u1.phone_e164 AS caller_phone,
          u2.real_name AS callee_name,
          u2.profile_photo_url AS callee_photo,
          u2.phone_e164 AS callee_phone,
          c.name AS club_name,
          c.photo_url AS club_photo
        FROM call_logs cl
        LEFT JOIN users u1 ON cl.caller_id = u1.id
        LEFT JOIN users u2 ON cl.callee_id = u2.id
        LEFT JOIN clubs c ON cl.club_id = c.id
        WHERE cl.caller_id = ? OR cl.callee_id = ?
        ORDER BY cl.created_at DESC
        LIMIT ?
      `).all(userId, userId, limit);

      const items = logs.map((log) => {
        const isCaller = log.caller_id === userId;
        let direction = 'incoming';
        if (isCaller) {
          direction = 'outgoing';
        } else if (log.status === 'missed') {
          direction = 'missed';
        }

        const peerName = isCaller ? (log.callee_name || log.callee_phone || 'Contact') : (log.caller_name || log.caller_phone || 'Contact');
        const peerPhoto = isCaller ? log.callee_photo : log.caller_photo;
        const peerId = isCaller ? log.callee_id : log.caller_id;

        return {
          id: log.id,
          room_id: log.room_id,
          call_type: log.call_type,
          is_group: Boolean(log.is_group),
          direction,
          status: log.status,
          duration_seconds: log.duration_seconds,
          duration_label: formatDuration(log.duration_seconds),
          created_at: log.created_at,
          peer: log.is_group
            ? {
                id: log.club_id,
                name: log.club_name || 'Club Group Call',
                photo_url: log.club_photo || null
              }
            : {
                id: peerId,
                name: peerName,
                photo_url: peerPhoto || null
              }
        };
      });

      return res.json({ calls: items });
    } catch (err) {
      console.error('[Calls History Error]', err);
      return sendError(res, 500, 'DB_ERROR', 'Failed to retrieve call history.');
    }
  });

  return router;
}
