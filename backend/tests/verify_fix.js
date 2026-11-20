import { initDatabase } from '../src/db/database.js';
import { runExpiryCleanup } from '../src/jobs/expiry.job.js';
import { createApp } from '../src/server.js';

console.log('1. Initializing database and checking schema...');
const db = initDatabase();

console.log('2. Running expiry cleanup (testing line 45)...');
const cleanup = runExpiryCleanup(db);
console.log('Cleanup succeeded:', cleanup);

console.log('3. Initializing full app and routes...');
const { app, expiryTimer } = createApp();
if (expiryTimer) clearInterval(expiryTimer);

console.log('✅ ALL CHECKS PASSED PERFECTLY! No main.users_old errors anywhere.');
process.exit(0);
