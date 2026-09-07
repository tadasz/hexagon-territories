import { Type, type Static } from '@sinclair/typebox';
import { DateTime } from '../../schemas/common.js';
import { MeRef } from '../me/schemas.js';

/** Mirrors `components.schemas.AuthAppleRequest` in contracts/openapi.yaml. */
export const AuthAppleRequestSchema = Type.Object(
  {
    identityToken: Type.String({
      minLength: 1,
      maxLength: 8192,
      description: 'Apple identity token (JWT) from ASAuthorizationAppleIDCredential.identityToken',
    }),
    authorizationCode: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 2048,
        description:
          'Apple authorization code; accepted and ignored in feature 002 (used by the token-revocation flow of feature 009)',
      }),
    ),
    fullName: Type.Optional(
      Type.Object(
        {
          givenName: Type.Optional(Type.String({ maxLength: 100 })),
          familyName: Type.Optional(Type.String({ maxLength: 100 })),
        },
        {
          additionalProperties: false,
          description:
            'Present only on the first authorization, when Apple hands the name to the app',
        },
      ),
    ),
  },
  { $id: 'AuthAppleRequest', additionalProperties: false },
);

export type AuthAppleRequest = Static<typeof AuthAppleRequestSchema>;

export const AuthAppleRequestRef = Type.Unsafe<AuthAppleRequest>({ $ref: 'AuthAppleRequest#' });

/** Mirrors `components.schemas.TokenPair`. */
export const TokenPairSchema = Type.Object(
  {
    accessToken: Type.String(),
    accessExpiresAt: DateTime(),
    refreshToken: Type.String(),
    refreshExpiresAt: DateTime(),
  },
  { $id: 'TokenPair', additionalProperties: false },
);

export type TokenPair = Static<typeof TokenPairSchema>;

export const TokenPairRef = Type.Unsafe<TokenPair>({ $ref: 'TokenPair#' });

/** Mirrors `components.schemas.AuthResponse`. */
export const AuthResponseSchema = Type.Object(
  {
    tokens: TokenPairRef,
    me: MeRef,
    isNewUser: Type.Boolean(),
    restored: Type.Boolean({
      description: 'True when an account marked deleted was reactivated by this sign-in',
    }),
  },
  { $id: 'AuthResponse', additionalProperties: false },
);

export type AuthResponse = Static<typeof AuthResponseSchema>;

export const AuthResponseRef = Type.Unsafe<AuthResponse>({ $ref: 'AuthResponse#' });

/** Mirrors `components.schemas.RefreshRequest`. */
export const RefreshRequestSchema = Type.Object(
  {
    refreshToken: Type.String({ minLength: 1, maxLength: 256 }),
  },
  { $id: 'RefreshRequest', additionalProperties: false },
);

export type RefreshRequest = Static<typeof RefreshRequestSchema>;

export const RefreshRequestRef = Type.Unsafe<RefreshRequest>({ $ref: 'RefreshRequest#' });

/** Mirrors `components.schemas.LogoutRequest`. */
export const LogoutRequestSchema = Type.Object(
  {
    refreshToken: Type.String({ minLength: 1, maxLength: 256 }),
  },
  { $id: 'LogoutRequest', additionalProperties: false },
);

export type LogoutRequest = Static<typeof LogoutRequestSchema>;

export const LogoutRequestRef = Type.Unsafe<LogoutRequest>({ $ref: 'LogoutRequest#' });
