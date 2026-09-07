import { parseArgs } from 'node:util';
import { AppleStub, TEST_CLIENT_ID } from '../test/helpers/apple.js';

/**
 * Dev-only Sign in with Apple stand-in (research.md R1, quickstart.md A.2):
 *
 *   pnpm --filter @nature/api dev:apple-stub --port 4567 --sub stub-user-1 --email stub@example.com
 *
 * Serves a JWKS at http://localhost:<port>/keys and prints an identity token signed by the
 * matching private key. Run the API with APPLE_JWKS_URL=http://localhost:<port>/keys and post the
 * token to POST /v1/auth/apple. Never use outside local development.
 */
const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '4567' },
    sub: { type: 'string', default: 'stub-user-1' },
    email: { type: 'string' },
    aud: { type: 'string', default: TEST_CLIENT_ID },
    'ttl-s': { type: 'string', default: '3600' },
  },
});

const stub = await AppleStub.create();
const jwksUrl = await stub.listen(Number(values.port), '127.0.0.1');
const token = await stub.mintIdentityToken({
  sub: values.sub,
  ...(values.email ? { email: values.email } : {}),
  aud: values.aud,
  exp: Number(values['ttl-s']),
});

console.log(`Apple stub: JWKS at ${jwksUrl}`);
console.log(`  export APPLE_JWKS_URL=${jwksUrl} APPLE_CLIENT_IDS=${values.aud}`);
console.log(`Identity token for sub=${values.sub} (valid ${values['ttl-s']} s):`);
console.log(token);
console.log('Press Ctrl+C to stop.');

const stop = () => {
  void stub.close().then(() => process.exit(0));
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
