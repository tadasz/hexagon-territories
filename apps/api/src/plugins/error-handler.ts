import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { AppError, ERROR_CODES } from '../errors.js';
import type { ErrorBody } from '../schemas/error.js';

export interface ErrorHandlerOptions {
  /** When false (production) 5xx messages are replaced by a generic sentence. */
  exposeInternalErrors: boolean;
}

const CODE_PATTERN = /^[A-Z][A-Z0-9_]+$/;

function errorBody(
  code: string,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
): ErrorBody {
  return {
    error: details === undefined ? { code, message } : { code, message, details },
    requestId,
  };
}

interface Mapped {
  status: number;
  body: ErrorBody;
}

export function mapError(
  error: FastifyError | AppError | Error,
  requestId: string,
  exposeInternalErrors: boolean,
): Mapped {
  if (error instanceof AppError) {
    return {
      status: error.statusCode,
      body: errorBody(error.code, error.message, requestId, error.details),
    };
  }

  const fastifyError = error as FastifyError;
  if (fastifyError.validation) {
    return {
      status: 400,
      body: errorBody(ERROR_CODES.VALIDATION_FAILED, fastifyError.message, requestId, {
        context: fastifyError.validationContext,
        issues: fastifyError.validation.map((issue) => ({
          path: issue.instancePath,
          keyword: issue.keyword,
          message: issue.message,
          params: issue.params,
        })),
      }),
    };
  }

  const status = fastifyError.statusCode ?? 500;
  if (status >= 400 && status < 500) {
    const code =
      status === 404
        ? ERROR_CODES.NOT_FOUND
        : typeof fastifyError.code === 'string' && CODE_PATTERN.test(fastifyError.code)
          ? fastifyError.code
          : `HTTP_${status}`;
    return { status, body: errorBody(code, fastifyError.message, requestId) };
  }

  return {
    status: status >= 500 ? status : 500,
    body: errorBody(
      ERROR_CODES.INTERNAL_ERROR,
      exposeInternalErrors ? fastifyError.message : 'Internal server error',
      requestId,
    ),
  };
}

/**
 * Normalises every error and unknown route to the shared `Error` envelope
 * (`{ error: { code, message, details? }, requestId }`) of contracts/openapi.yaml.
 */
export const errorHandlerPlugin = fp<ErrorHandlerOptions>(
  (fastify, opts, done) => {
    fastify.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
      const body = errorBody(
        ERROR_CODES.NOT_FOUND,
        `Route ${request.method} ${request.url} not found`,
        request.id,
      );
      void reply.code(404).type('application/json; charset=utf-8').send(JSON.stringify(body));
    });

    fastify.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
      const { status, body } = mapError(error, request.id, opts.exposeInternalErrors);
      if (status >= 500) {
        request.log.error({ err: error, requestId: request.id }, body.error.message);
      } else {
        request.log.info({ err: error, requestId: request.id }, body.error.message);
      }
      // Serialise by hand so a route's own response schema never rewrites the envelope.
      void reply.code(status).type('application/json; charset=utf-8').send(JSON.stringify(body));
    });
    done();
  },
  { name: 'error-handler', fastify: '5.x' },
);
