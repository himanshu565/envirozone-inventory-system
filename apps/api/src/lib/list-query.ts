export type ListQuery = {
  page: number;
  pageSize: number;
  search: string | null;
  sortBy: string | null;
  sortDir: "asc" | "desc";
};

export type PaginationMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export function parseListQuery(searchParams: URLSearchParams): ListQuery {
  const page = Math.max(1, Math.trunc(Number(searchParams.get("page"))) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.trunc(Number(searchParams.get("pageSize"))) || DEFAULT_PAGE_SIZE)
  );
  const search = searchParams.get("search")?.trim() || null;
  const sortBy = searchParams.get("sortBy")?.trim() || null;
  const sortDir = searchParams.get("sortDir") === "desc" ? "desc" : "asc";

  return { page, pageSize, search, sortBy, sortDir };
}

export function toPrismaPagination(query: ListQuery) {
  return {
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  };
}

export function toPrismaOrderBy(
  query: ListQuery,
  allowedSortFields: string[],
  fallbackField: string
): Record<string, "asc" | "desc"> {
  const field =
    query.sortBy && allowedSortFields.includes(query.sortBy)
      ? query.sortBy
      : fallbackField;

  return { [field]: query.sortDir };
}

export function toPaginationMeta(query: ListQuery, total: number): PaginationMeta {
  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}
