import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';

/** jose 6 returns WebCrypto keys; named here so the helper does not depend on a DOM lib. */
export type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
import { APPLE_ISSUER } from '../../src/modules/auth/apple.js';

export const TEST_CLIENT_ID = 'com.natureexplorer.app';

export interface MintOptions {
  sub: string;
  email?: string;
  /** Defaults to `TEST_CLIENT_ID`. */
  aud?: string | string[];
  /** Defaults to Apple's issuer. */
  iss?: string;
  /** Absolute expiry as a Date, or seconds from `iat` (default 600). */
  exp?: Date | number;
  /** Issued-at override (default now). */
  iat?: Date;
  /** Key id in the header (default the stub's kid; use another to simulate an unknown key). */
  kid?: string;
  /** Sign with another key (simulates a forged signature). */
  privateKey?: SigningKey;
  emailVerified?: boolean;
  isPrivateEmail?: boolean;
}

/**
 * A local stand-in for Apple's key service (research.md R1): an RS256 key pair and an in-process
 * HTTP server answering `GET /keys` with the JWKS. `mintIdentityToken` signs tokens the way Apple
 * does (`iss`, `aud`, `sub`, `email`, `exp`), so no test ever contacts Apple.
 */
export class AppleStub {
  readonly kid = 'stub-key-1';
  private server: Server | undefined;
  private constructor(
    readonly privateKey: SigningKey,
    readonly publicJwk: JWK,
  ) {}

  static async create(): Promise<AppleStub> {
    const { privateKey, publicKey } = await generateKeyPair('RS256', { modulusLength: 2048 });
    const jwk = await exportJWK(publicKey);
    return new AppleStub(privateKey, jwk);
  }

  get jwks(): { keys: JWK[] } {
    return { keys: [{ ...this.publicJwk, kid: this.kid, alg: 'RS256', use: 'sig' }] };
  }

  /** Starts the JWKS server on `port` (0 = ephemeral) and returns the JWKS URL. */
  listen(port = 0, host = '127.0.0.1'): Promise<string> {
    const server = createServer((req, res) => {
      if (req.method === 'GET' && req.url?.startsWith('/keys')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(this.jwks));
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    });
    this.server = server;
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        const address = server.address() as AddressInfo;
        resolve(`http://${host}:${address.port}/keys`);
      });
    });
  }

  get jwksUrl(): string {
    const address = this.server?.address() as AddressInfo | null | undefined;
    if (!address) throw new Error('AppleStub is not listening');
    return `http://127.0.0.1:${address.port}/keys`;
  }

  close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (!server) return Promise.resolve();
    return new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  }

  async mintIdentityToken(opts: MintOptions): Promise<string> {
    const iat = opts.iat ?? new Date();
    const exp =
      opts.exp instanceof Date ? opts.exp : new Date(iat.getTime() + (opts.exp ?? 600) * 1_000);
    const claims: Record<string, unknown> = {};
    if (opts.email !== undefined) {
      claims.email = opts.email;
      claims.email_verified = opts.emailVerified ?? true;
      if (opts.isPrivateEmail !== undefined) claims.is_private_email = opts.isPrivateEmail;
    }
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: opts.kid ?? this.kid })
      .setIssuer(opts.iss ?? APPLE_ISSUER)
      .setAudience(opts.aud ?? TEST_CLIENT_ID)
      .setSubject(opts.sub)
      .setIssuedAt(Math.floor(iat.getTime() / 1_000))
      .setExpirationTime(Math.floor(exp.getTime() / 1_000))
      .sign(opts.privateKey ?? this.privateKey);
  }
}
