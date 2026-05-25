/**
 * Production entrypoint.
 *
 * Loads environment configuration, builds the Fastify instance, starts
 * listening, and wires graceful shutdown handlers so in-flight requests
 * can drain on SIGINT/SIGTERM (the deployment target sends SIGTERM on
 * rollouts).
 *
 * Configuration errors are caught and printed without a stack trace; any
 * other startup error is logged through the Fastify logger so it shows up
 * in the same structured log stream as runtime events.
 */

import { buildServer } from './server.js';
import { ConfigError, loadConfig } from './config.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      // Use stderr directly: at this point the Fastify logger does not exist
      // yet because building it requires a valid config.
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }

  const app = buildServer(config);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  try {
    await app.listen({
      host: config.server.host,
      port: config.server.port,
    });
  } catch (err) {
    app.log.error({ err }, 'failed to start server');
    process.exit(1);
  }
}

void main();
