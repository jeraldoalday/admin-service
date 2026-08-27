/**
 * Error types carried over from the HTTP service. The status codes no longer travel over the
 * wire, but they still classify failures for the UI: 401/403 send you back to sign-in or show
 * a permission notice, while 400/404/409 surface inline on the form that caused them.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', details?: unknown) {
    super(400, 'BAD_REQUEST', message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, 'FORBIDDEN', message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(404, 'NOT_FOUND', message);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', details?: unknown) {
    super(409, 'CONFLICT', message, details);
  }
}

/**
 * Refused because it was tried too often, rather than because it was wrong. It is its own
 * type so the sign-in form can say "wait" instead of "that password is wrong" — telling
 * somebody their correct password is wrong while they are locked out is how a throttle gets
 * mistaken for a broken account.
 */
export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many attempts') {
    super(429, 'TOO_MANY_REQUESTS', message);
  }
}

/** Narrows an unknown thrown value to a message suitable for display. */
export function toErrorMessage(error: unknown): string {
  if (error instanceof AppError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong';
}
