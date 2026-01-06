/**
 * Small CSV export helper (client-side only).
 */

function escapeCsvValue(v) {
  const str = String(v ?? "");
  const needsQuotes = /[",\n\r]/.test(str);
  const escaped = str.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

// PUBLIC_INTERFACE
export function toCsv(rows, columns) {
  /**
   * Convert an array of objects into CSV text.
   * @param {Array<object>} rows
   * @param {Array<{key: string, label: string}>} columns
   */
  const header = columns.map((c) => escapeCsvValue(c.label)).join(",");
  const lines = rows.map((r) => columns.map((c) => escapeCsvValue(r?.[c.key])).join(","));
  return [header, ...lines].join("\n");
}

// PUBLIC_INTERFACE
export function downloadCsv({ filename, csvText }) {
  /**
   * Trigger a browser download for a CSV string.
   * @param {{filename: string, csvText: string}} params
   */
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "export.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}
