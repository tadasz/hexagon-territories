import type { FastifyRequest } from 'fastify';
import { AppError, ERROR_CODES } from '../../errors.js';
import type { UserRole } from '../auth/tokens.js';

/**
 * A `preHandler` for after `fastify.authenticate`: the signed-in player must carry `role`
 * (specs/004-weekly-reckoning/research.md R12). Any other role answers 403 FORBIDDEN; a missing
 * user (the guard ran without `authenticate`) is a programming error and answers 401.
 */
export function requireRole(role: UserRole) {
  return function guard(request: FastifyRequest): Promise<void> {
    if (!request.user) {
      throw new AppError(401, ERROR_CODES.UNAUTHORIZED, 'Missing bearer token');
    }
    if (request.user.role !== role) {
      throw new AppError(403, ERROR_CODES.FORBIDDEN, `Requires role ${role}`, {
        requiredRole: role,
      });
    }
    return Promise.resolve();
  };
}
