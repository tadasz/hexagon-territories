import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { API_VERSION } from './version.js';

const config = loadConfig();
const app = await buildApp({ config });

const shutdown = (signal: NodeJS.Signals) => {
  app.log.info({ signal }, 'shutting down');
  app
    .close()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      app.log.error({ err }, 'shutdown failed');
      process.exit(1);
    });
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info({ version: API_VERSION, env: config.env }, 'nature api started');
} catch (err) {
  app.log.error({ err }, 'failed to start');
  process.exit(1);
}
