import { describe, expect, it } from 'vitest';
import {
  AppError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  toErrorMessage,
} from '@/domain/errors';

describe('error types', () => {
  it('carries the status code and machine-readable code the UI switches on', () => {
    expect(new BadRequestError('bad').statusCode).toBe(400);
    expect(new BadRequestError('bad').code).toBe('BAD_REQUEST');
    expect(new UnauthorizedError().statusCode).toBe(401);
    expect(new ForbiddenError().statusCode).toBe(403);
    expect(new NotFoundError().statusCode).toBe(404);
    expect(new ConflictError().statusCode).toBe(409);
  });

  it('defaults each message so a caller can throw without one', () => {
    expect(new UnauthorizedError().message).toBe('Unauthorized');
    expect(new ForbiddenError().message).toBe('Forbidden');
    expect(new NotFoundError().message).toBe('Not found');
    expect(new ConflictError().message).toBe('Conflict');
  });

  it('carries optional details through for the forms that need them', () => {
    expect(new BadRequestError('bad', { field: 'email' }).details).toEqual({ field: 'email' });
    expect(new ConflictError('taken', { field: 'email' }).details).toEqual({ field: 'email' });
    expect(new UnauthorizedError().details).toBeUndefined();
  });

  it('is an instance of both Error and AppError', () => {
    const err = new NotFoundError('missing');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
    expect(err.name).toBe('AppError');
  });
});

describe('toErrorMessage', () => {
  it('shows an AppError message as-is', () => {
    expect(toErrorMessage(new ConflictError('Email already in use'))).toBe('Email already in use');
  });

  it('shows a plain Error message as-is', () => {
    expect(toErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('falls back to a generic message for anything that is not an Error', () => {
    expect(toErrorMessage('a thrown string')).toBe('Something went wrong');
    expect(toErrorMessage(undefined)).toBe('Something went wrong');
    expect(toErrorMessage({ message: 'looks like an error but is not one' })).toBe(
      'Something went wrong',
    );
  });
});
