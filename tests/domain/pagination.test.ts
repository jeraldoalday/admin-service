import { describe, expect, it } from 'vitest';
import { paginate, sortNewestFirst, sortOldestFirst } from '@/domain';

const items = Array.from({ length: 7 }, (_, index) => ({ id: index }));

describe('paginate', () => {
  it('slices the requested page and reports the totals', () => {
    const result = paginate(items, { page: 2, pageSize: 3 });

    expect(result.items.map((item) => item.id)).toEqual([3, 4, 5]);
    expect(result).toMatchObject({ page: 2, pageSize: 3, total: 7, totalPages: 3 });
  });

  it('clamps a page past the end back to the last one that exists', () => {
    const result = paginate(items, { page: 9, pageSize: 3 });

    expect(result.page).toBe(3);
    expect(result.items.map((item) => item.id)).toEqual([6]);
  });

  it('reports a single empty page for an empty list', () => {
    const result = paginate([], { page: 4, pageSize: 3 });

    expect(result).toMatchObject({ items: [], page: 1, total: 0, totalPages: 1 });
  });
});

describe('ordering', () => {
  const rows = [
    { id: 'a', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'b', createdAt: '2026-03-01T00:00:00.000Z' },
    { id: 'c', createdAt: '2026-03-01T00:00:00.000Z' },
  ];

  it('puts the newest first, breaking ties on insertion order', () => {
    expect(sortNewestFirst(rows).map((row) => row.id)).toEqual(['c', 'b', 'a']);
  });

  it('puts the oldest first', () => {
    expect(sortOldestFirst(rows).map((row) => row.id)).toEqual(['a', 'b', 'c']);
  });
});
