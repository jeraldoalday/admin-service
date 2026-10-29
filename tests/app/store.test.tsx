import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLiveResult } from '@/app/store';
import { ForbiddenError } from '@/domain';

describe('useLiveResult', () => {
  it('reports a permission denial as data, not a thrown error', () => {
    const { result } = renderHook(() =>
      useLiveResult(() => {
        throw new ForbiddenError('not allowed');
      }),
    );
    expect(result.current.data).toBeNull();
    expect(result.current.error?.message).toBe('not allowed');
  });

  it('returns the selected value when the read succeeds', () => {
    const { result } = renderHook(() => useLiveResult(() => 'ok'));
    expect(result.current).toEqual({ data: 'ok', error: null });
  });

  it('lets an error that is not an AppError propagate instead of swallowing it as a denial', () => {
    expect(() =>
      renderHook(() =>
        useLiveResult(() => {
          throw new Error('boom');
        }),
      ),
    ).toThrow('boom');
  });
});
