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

/**
 * Applies page/pageSize to an already-ordered list, mirroring the old `skip`/`take` query.
 *
 * A page past the end is clamped to the last one that exists rather than returning nothing:
 * a list can shrink under a reader who is already on page three - delete the last row there,
 * or narrow a filter - and an empty result would read as "nothing matches" when the truth is
 * "that page is gone". The clamped page is reported back, so pagination controls stay
 * anchored to a page that exists.
 */
export function paginate<T>(items: T[], input: PaginationInput): PaginatedResult<T> {
  const totalPages = Math.max(1, Math.ceil(items.length / input.pageSize));
  const page = Math.min(Math.max(1, input.page), totalPages);
  const skip = (page - 1) * input.pageSize;

  return buildPaginatedResult(items.slice(skip, skip + input.pageSize), items.length, {
    ...input,
    page,
  });
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
