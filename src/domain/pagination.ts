export interface PaginationInput {
  page: number;
  pageSize: number;
}

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export const DEFAULT_PAGE_SIZE = 20;

export function buildPaginatedResult<T>(
  items: T[],
  total: number,
  { page, pageSize }: PaginationInput,
): PaginatedResult<T> {
  return {
    items,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Applies page/pageSize to an already-ordered list, mirroring the old `skip`/`take` query. */
export function paginate<T>(items: T[], input: PaginationInput): PaginatedResult<T> {
  const skip = (input.page - 1) * input.pageSize;
  return buildPaginatedResult(items.slice(skip, skip + input.pageSize), items.length, input);
}

/**
 * Sorts newest-first. `Array.prototype.sort` is stable, so reversing before sorting makes
 * later-inserted records win ties on identical timestamps — the order a database would
 * produce from an auto-incrementing key.
 */
export function sortNewestFirst<T extends { createdAt: string }>(items: T[]): T[] {
  return [...items].reverse().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function sortOldestFirst<T extends { createdAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
