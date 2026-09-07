import type { FastifyRequest } from 'fastify';
import { AppError, ERROR_CODES } from '../errors.js';

interface ValidationIssue {
  instancePath: string;
  keyword: string;
  message?: string;
  params?: unknown;
}

/** `details.field` of the first validation issue (`/samples/3/lat` → `samples`). */
export function fieldOf(issues: readonly ValidationIssue[]): string | undefined {
  const issue = issues[0];
  if (!issue) return undefined;
  const path = issue.instancePath.replace(/^\//, '').split('/')[0];
  if (path) return path;
  const params = issue.params as { missingProperty?: unknown } | undefined;
  return typeof params?.missingProperty === 'string' ? params.missingProperty : undefined;
}

/**
 * With `attachValidation: true` on a route, rethrows a schema validation failure as the shared
 * envelope `400 VALIDATION_FAILED` with `details.field` (the same shape 003's walk routes use).
 */
export function rejectInvalid(request: FastifyRequest): void {
  const error = request.validationError;
  if (!error) return;
  const issues = (Array.isArray(error.validation) ? error.validation : []) as ValidationIssue[];
  const field = fieldOf(issues);
  throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, error.message, {
    ...(field ? { field } : {}),
    context: error.validationContext,
    issues: issues.map((issue) => ({
      path: issue.instancePath,
      keyword: issue.keyword,
      message: issue.message,
      params: issue.params,
    })),
  });
}
