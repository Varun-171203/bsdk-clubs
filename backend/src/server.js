import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Server as SocketIOServer } from 'socket.io';

// Auto-load .env configuration if present
const rootEnv = path.resolve(process.cwd(), '.env');
const backendEnv = path.resolve(process.cwd(), 'backend', '.env');
if (fs.existsSync(rootEnv)) {
  try { process.loadEnvFile(rootEnv); } catch {}
} else if (fs.existsSync(backendEnv)) {
  try { process.loadEnvFile(backendEnv); } catch {}
}

import { initDatabase } from './db/database.js';
import { createAuthMiddleware } from './common/auth.js';
import { sendError } from './common/utils.js';
import { createAuthRouter } from './modules/auth.routes.js';
import { createClubsRouter } from './modules/clubs.routes.js';
import { createMessagesRouter } from './modules/messages.routes.js';
import { createStatusSafetyRouter } from './modules/status-safety.routes.js';
import { createContactsRouter } from './modules/contacts.routes.js';
import { createKeysRouter } from './modules/keys.routes.js';
import { createInvitesRouter } from './modules/invites.routes.js';
import { createE2EEMessagesRouter } from './modules/e2ee-messages.routes.js';
import { setupSocketGateway } from './realtime/socket.js';
import { startExpiryJob } from './jobs/expiry.job.js';

export function createApp({ dbPath } = {}) {
  const db = initDatabase(dbPath);
  const app = express();
  const server = http.createServer(app);

  const clientOrigin = process.env.CLIENT_ORIGIN || '*';
  const io = new SocketIOServer(server, {
    path: '/ws',
    cors: {
      origin: clientOrigin,
      methods: ['GET', 'POST', 'PATCH', 'DELETE']
    }
  });

  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false
  }));
  app.use(cors({ origin: clientOrigin }));
  app.use(express.json({ limit: '15mb' }));

  // Serve camera-captured media uploads
  const uploadsDir = path.resolve(process.cwd(), 'data', 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  app.use('/uploads', express.static(uploadsDir));

  // Health check
  app.get('/api/v1/health', (req, res) => {
    res.json({ status: 'ok', product: 'BSDK Clubs', version: '3.0.0' });
  });

  const requireAuth = createAuthMiddleware(db);

  // Mount REST APIs under /api/v1
  app.use('/api/v1', createAuthRouter(db, requireAuth));
  app.use('/api/v1', createClubsRouter(db, requireAuth, io));
  app.use('/api/v1', createMessagesRouter(db, requireAuth, io));
  app.use('/api/v1', createStatusSafetyRouter(db, requireAuth, io));
  app.use('/api/v1', createContactsRouter(db, requireAuth));
  app.use('/api/v1', createKeysRouter(db, requireAuth));
  app.use('/api/v1', createInvitesRouter(db, requireAuth));
  app.use('/api/v1', createE2EEMessagesRouter(db, requireAuth, io));

  // Setup realtime WebSocket gateway
  setupSocketGateway(io, db);

  // Start disappearing message & status expiry cron job
  const expiryTimer = startExpiryJob(db, 60 * 1000);

  // Serve built frontend in production if dist/ exists
  const candidateDists = [
    path.resolve(process.cwd(), 'frontend', 'dist'),
    path.resolve(process.cwd(), '..', 'frontend', 'dist'),
    path.resolve(process.cwd(), 'dist')
  ];
  const frontendDist = candidateDists.find((d) => fs.existsSync(d) && fs.existsSync(path.join(d, 'index.html')));
  if (frontendDist) {
    app.use(express.static(frontendDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/ws') || req.path.startsWith('/uploads/')) {
        return next();
      }
      return res.sendFile(path.join(frontendDist, 'index.html'));
    });
  }

  // Root welcome endpoint for API status check
  app.get('/', (req, res) => {
    return res.json({
      status: 'online',
      product: 'BSDK Clubs API',
      version: '3.0.0',
      message: 'Your Gang. Your Bang. Backend API is running successfully!'
    });
  });

  // Fallback 404 for API
  app.use('/api', (req, res) => {
    return sendError(res, 404, 'NOT_FOUND', 'API endpoint not found.');
  });

  // Global error handler
  app.use((err, req, res, _next) => {
    console.error('[API Error]', err);
    return sendError(res, 500, 'SERVER_ERROR', 'Something went wrong. Please try again later.');
  });

  return { app, server, io, db, expiryTimer };
}

// Start server if run directly
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const PORT = Number(process.env.PORT) || 4000;
  const HOST = process.env.HOST || '0.0.0.0';
  const { server } = createApp();
  server.listen(PORT, HOST, () => {
    console.log(`\n🚀 BSDK Clubs Server Running!`);
    console.log(`   Desktop Web : http://localhost:${PORT}`);
    const nets = os.networkInterfaces();
    for (const [name, addrs] of Object.entries(nets)) {
      for (const n of addrs || []) {
        if (n.family === 'IPv4' && !n.internal) {
          console.log(`   Phone / APK : http://${n.address}:${PORT}  (${name})`);
        }
      }
    }
    console.log(`   WebSocket   : /ws\n`);
  });
}
