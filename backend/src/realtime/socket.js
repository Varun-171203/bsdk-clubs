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
    // Auto-join all clubs this user belongs to
    const memberships = db.prepare('SELECT club_id FROM club_members WHERE user_id = ?').all(socket.user.id);
    for (const m of memberships) {
      socket.join(`club:${m.club_id}`);
    }

    // Client -> Server: subscribe { club_id }
    socket.on('subscribe', ({ club_id } = {}) => {
      if (!club_id) return;
      const member = db.prepare('SELECT id FROM club_members WHERE club_id = ? AND user_id = ?').get(club_id, socket.user.id);
      if (member) {
        socket.join(`club:${club_id}`);
      }
    });

    // Client -> Server: typing { club_id, is_typing } -> Broadcasts ALIAS ONLY!
    socket.on('typing', ({ club_id, is_typing = true } = {}) => {
      if (!club_id) return;
      const member = db.prepare('SELECT alias_name, alias_color FROM club_members WHERE club_id = ? AND user_id = ?').get(club_id, socket.user.id);
      if (!member) return;

      const payload = assertNoIdentityLeak({
        club_id,
        alias_name: member.alias_name,
        alias_color: member.alias_color,
        is_typing: Boolean(is_typing)
      });
      socket.to(`club:${club_id}`).emit('typing', payload);
    });
  });
}
