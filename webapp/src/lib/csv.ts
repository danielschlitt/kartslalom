/**
 * Minimal CSV parser supporting quoted fields, commas inside quotes, and
 * escaped double-quotes. Returns the header row + body rows as objects.
 */
export function parseCsv(input: string): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const text = input.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const records: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        cur.push(field);
        field = "";
      } else if (c === "\n") {
        cur.push(field);
        records.push(cur);
        cur = [];
        field = "";
      } else {
        field += c;
      }
    }
  }
  if (field !== "" || cur.length > 0) {
    cur.push(field);
    records.push(cur);
  }

  if (records.length === 0) return { headers: [], rows: [] };

  const headers = records[0].map((h) => h.trim());
  const rows = records.slice(1).flatMap((r) => {
    if (r.length === 1 && r[0].trim() === "") return [];
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = (r[idx] ?? "").trim();
    });
    return [obj];
  });

  return { headers, rows };
}
