type CsvRow = Record<string, unknown>;

function cell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
}

export function downloadCsv(rows: CsvRow[], headers: string[], filename: string) {
  const body = [
    headers.map(cell).join(";"),
    ...rows.map((row) => headers.map((h) => cell(row[h])).join(";")),
  ].join("\n");
  const blob = new Blob(["\uFEFF" + body], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export type ExportableLead = {
  name: string;
  rating: number;
  userRatingCount: number;
  address: string;
  phone: string | null;
  city: string;
  category?: string | null;
  mapsUri?: string | null;
};

export function exportLeadsCsv(leads: ExportableLead[], filename: string) {
  const rows = leads.map((l) => ({
    Nazwa: l.name,
    Ocena: l.rating,
    Opinie: l.userRatingCount,
    Telefon: l.phone ?? "",
    Adres: l.address,
    Miasto: l.city,
    Kategoria: l.category ?? "",
    "Google Maps": l.mapsUri ?? "",
  }));
  downloadCsv(
    rows,
    ["Nazwa", "Ocena", "Opinie", "Telefon", "Adres", "Miasto", "Kategoria", "Google Maps"],
    filename,
  );
}
