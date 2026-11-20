import fs from 'node:fs';
import path from 'node:path';

export function runExpiryCleanup(db) {
  const nowIso = new Date().toISOString();
  const uploadsDir = path.resolve(process.cwd(), 'data', 'uploads');

  // 1. Find & hard-delete expired disappearing messages + their media files (NFR-08 & Section 5 Data Rules)
  const expiredMessages = db.prepare(`
    SELECT id, media_url FROM messages WHERE expires_at IS NOT NULL AND expires_at <= ?
  `).all(nowIso);

  for (const m of expiredMessages) {
    if (m.media_url && m.media_url.startsWith('/uploads/')) {
      const filePath = path.join(uploadsDir, path.basename(m.media_url));
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch { /* ignore */ }
      }
    }
  }

  const deletedMsgs = db.prepare(`
    DELETE FROM messages WHERE expires_at IS NOT NULL AND expires_at <= ?
  `).run(nowIso);

  // 2. Find & hard-delete expired 24h statuses + their media files
  const expiredStatuses = db.prepare(`
    SELECT id, media_url FROM statuses WHERE expires_at <= ?
  `).all(nowIso);

  for (const s of expiredStatuses) {
    if (s.media_url && s.media_url.startsWith('/uploads/')) {
      const filePath = path.join(uploadsDir, path.basename(s.media_url));
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch { /* ignore */ }
      }
    }
  }

  const deletedStatuses = db.prepare(`
    DELETE FROM statuses WHERE expires_at <= ?
  `).run(nowIso);

  // 3. Clean expired password resets
  db.prepare('DELETE FROM password_resets WHERE expires_at <= ?').run(nowIso);

  return {
    deletedMessages: deletedMsgs.changes || 0,
    deletedStatuses: deletedStatuses.changes || 0
  };
}

export function startExpiryJob(db, intervalMs = 60 * 1000) {
  runExpiryCleanup(db);
  const timer = setInterval(() => {
    try {
      const res = runExpiryCleanup(db);
      if (res.deletedMessages > 0 || res.deletedStatuses > 0) {
        console.log(`[ExpiryJob] Hard-deleted ${res.deletedMessages} messages, ${res.deletedStatuses} statuses`);
      }
    } catch (err) {
      console.error('[ExpiryJob] Error:', err);
    }
  }, intervalMs);
  timer.unref();
  return timer;
}
