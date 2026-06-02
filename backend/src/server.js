import http from 'http';
import app from './app.js';
import { env } from './config/env.js';
import { prisma } from './config/database.js';
import { createRedisClient } from './services/redis.service.js';
import { initSocket } from './services/socket.service.js';
import { startMonitor } from './services/network-monitor.service.js';
import { startRouterMonitor } from './services/router-monitor.service.js';

// ── Scheduled jobs ──────────────────────────────────────────
// Each import instantiates its singleton, which calls setupSchedules() in the
// constructor to register node-cron tasks.
import './jobs/billing.job.js';
import './jobs/overdue.job.js';
import './jobs/debtor-notification.job.js';

// Initialize Redis connection
export const redis = createRedisClient();

// Wrap Express in a Node HTTP server so socket.io can share the port.
const httpServer = http.createServer(app);
initSocket(httpServer);

const server = httpServer.listen(env.PORT, async () => {
  console.log(`🚀 ISP Manager API server running on port ${env.PORT}`);
  console.log(`📊 Environment: ${env.NODE_ENV}`);
  console.log(`🔗 API URL: http://localhost:${env.PORT}`);
  console.log(`🌐 Frontend URL: ${env.FRONTEND_URL}`);

  // Cleanup orphaned campaigns from a previous process. runCampaign is an
  // in-memory background task — if the server was restarted mid-flight, the
  // campaign row gets stuck on status='running' forever. Mark them as failed
  // so the operator knows they need to be re-launched.
  try {
    const orphaned = await prisma.notificationCampaign.updateMany({
      where: { status: 'running' },
      data: {
        status: 'failed',
        finishedAt: new Date()
      }
    });
    if (orphaned.count > 0) {
      console.log(`🧹 Marked ${orphaned.count} orphaned 'running' campaign(s) as failed (server was restarted mid-execution).`);
    }
  } catch (e) {
    console.warn('Could not run campaign orphan cleanup:', e.message);
  }

  // Start the ICMP monitor (in-process scheduler). Pings every device on the
  // map every 30s and pushes live updates via socket.io.
  startMonitor();
  // Router-routes ICMP monitor — drives failover and per-route status pills
  // in the NOC table.
  startRouterMonitor();
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('👋 SIGTERM received, shutting down gracefully...');
  
  server.close(async () => {
    console.log('🔌 HTTP server closed');
    
    try {
      await prisma.$disconnect();
      console.log('💾 Database disconnected');
      
      await redis.quit();
      console.log('🔴 Redis disconnected');
      
      process.exit(0);
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
      process.exit(1);
    }
  });
});

process.on('SIGINT', async () => {
  console.log('👋 SIGINT received, shutting down gracefully...');
  
  server.close(async () => {
    console.log('🔌 HTTP server closed');
    
    try {
      await prisma.$disconnect();
      console.log('💾 Database disconnected');
      
      await redis.quit();
      console.log('🔴 Redis disconnected');
      
      process.exit(0);
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
      process.exit(1);
    }
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});
