/**
 * Production entrypoint.
 *
 * Loads environment configuration, builds the fully-wired Fastify instance
 * via the composition root (`buildApp`), starts listening, and wires
 * graceful shutdown handlers so in-flight requests can drain on
 * SIGINT/SIGTERM (the deployment target sends SIGTERM on rollouts).
 *
 * The composition root (`composeServices.ts`) is responsible for building
 * every real backend client (Postgres pool, Redis, S3), constructing each
 * service repo, assembling the `BuildServerServices` object, and registering
 * the auth/profile route plugins that live outside `buildServer`. This file
 * stays a thin "load config → build → listen → drain" shell.
 *
 * Configuration errors are caught and printed without a stack trace; any
 * other startup error is logged through the Fastify logger so it shows up
 * in the same structured log stream as runtime events.
 */

import { buildApp, closePool } from './composeServices.js';
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

  const { app, dispose } = await buildApp(config);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    // Guard against a second signal arriving mid-drain; otherwise the two
    // shutdown sequences would race on `app.close()` and the resource
    // teardown below.
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    try {
      // Stop accepting connections and drain in-flight requests first, then
      // release backing resources: the composition-owned Redis client via
      // `dispose()` and the shared Postgres pool via `closePool()`.
      await app.close();
      await dispose();
      await closePool();
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
    // Release resources we already acquired in `buildApp` before exiting so
    // a failed bind does not leak the Redis socket or pool connections.
    try {
      await dispose();
      await closePool();
    } catch {
      // Best-effort cleanup on the failure path.
    }
    process.exit(1);
  }
}

void main();
