/**
 * Table utilities: sorting + pagination.
 * Intentionally framework-agnostic helpers used by multiple pages.
 */

/**
 * PUBLIC_INTERFACE
 * Normalize a value for sorting comparison.
 * - null/undefined -> empty string
 * - numbers -> number
 * - booleans -> 0/1
 * - Date -> ms timestamp
 * - everything else -> string
 */
export function normalizeSortValue(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;

  // Handle ISO date strings reasonably: if it parses, sort by time.
  if (typeof value === "string") {
    const trimmed = value.trim();
    const maybeDate = new Date(trimmed);
    if (Number.isFinite(maybeDate.getTime()) && /[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(trimmed)) {
      return maybeDate.getTime();
    }
    return trimmed.toLowerCase();
  }

  return String(value).toLowerCase();
}

/**
 * PUBLIC_INTERFACE
 * Sort a list of rows with a stable-ish deterministic comparator.
 *
 * @param {Array<any>} rows
 * @param {object} options
 * @param {string} options.sortKey - logical key name (used only by accessor)
 * @param {"asc"|"desc"} options.sortOrder
 * @param {(row:any, sortKey:string)=>any} options.accessor
 * @returns {Array<any>}
 */
export function sortRows(rows, { sortKey, sortOrder = "asc", accessor }) {
  if (!Array.isArray(rows)) return [];
  if (!sortKey || typeof accessor !== "function") return rows;

  const factor = sortOrder === "desc" ? -1 : 1;

  // Decorate-sort-undecorate for stability (tie-break by original index).
  const decorated = rows.map((row, idx) => {
    const raw = accessor(row, sortKey);
    return { row, idx, v: normalizeSortValue(raw) };
  });

  decorated.sort((a, b) => {
    if (a.v < b.v) return -1 * factor;
    if (a.v > b.v) return 1 * factor;
    return a.idx - b.idx;
  });

  return decorated.map((d) => d.row);
}

/**
 * PUBLIC_INTERFACE
 * Paginate a list of rows.
 *
 * @param {Array<any>} rows
 * @param {object} options
 * @param {number} options.pageIndex - 0-based
 * @param {number} options.pageSize
 * @returns {{pageRows: Array<any>, totalRows: number, totalPages: number}}
 */
export function paginateRows(rows, { pageIndex = 0, pageSize = 10 } = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const totalRows = safeRows.length;

  const safePageSize = Math.max(1, Number(pageSize) || 10);
  const totalPages = Math.max(1, Math.ceil(totalRows / safePageSize));

  const safePageIndex = Math.min(Math.max(0, Number(pageIndex) || 0), totalPages - 1);
  const start = safePageIndex * safePageSize;
  const end = start + safePageSize;

  return {
    pageRows: safeRows.slice(start, end),
    totalRows,
    totalPages,
  };
}

/**
 * PUBLIC_INTERFACE
 * Clamp pageIndex after filters/sorts change (e.g., when rows shrink).
 */
export function clampPageIndex(pageIndex, totalPages) {
  const tp = Math.max(1, Number(totalPages) || 1);
  const pi = Number(pageIndex) || 0;
  return Math.min(Math.max(0, pi), tp - 1);
}
