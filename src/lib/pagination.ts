export type Pagination = { page: number; limit: number; skip: number };

export function getPagination(pageInput?: unknown, limitInput?: unknown): Pagination {
  const page = Math.max(1, Number(pageInput) || 1);
  const limit = Math.min(100, Math.max(1, Number(limitInput) || 20));
  return { page, limit, skip: (page - 1) * limit };
}
