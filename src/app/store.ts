import { useSyncExternalStore } from 'react';
import { AppError, getRevision, subscribe } from '@/domain';

/**
 * Re-runs `select` whenever the tables change. The store publishes a revision counter rather
 * than the data itself, so subscribing costs one integer comparison no matter how much state
 * a screen reads; the selector then runs against the live tables on every render, which keeps
 * a screen from ever showing a stale answer because a dependency was left out of a list.
 */
export function useLiveQuery<T>(select: () => T): T {
  useSyncExternalStore(subscribe, getRevision, getRevision);
  return select();
}

export interface LiveResult<T> {
  data: T | null;
  error: AppError | null;
}

/**
 * Same as `useLiveQuery`, but for reads that are permission-guarded and may therefore throw.
 * A denial is a normal outcome for a screen to render, not a crash.
 */
export function useLiveResult<T>(select: () => T): LiveResult<T> {
  return useLiveQuery(() => {
    try {
      return { data: select(), error: null };
    } catch (error) {
      if (error instanceof AppError) return { data: null, error };
      throw error;
    }
  });
}
