// Merchant grouping is intentionally deterministic and local. Explicit
// merchant labels win; imported rows fall back to a conservative description
// cleanup that removes common terminal receipt/reference fragments.
export interface MerchantLabel {
  key: string;
  label: string;
}

export function merchantLabel(merchant: unknown, description: unknown): MerchantLabel {
  const explicit = typeof merchant === "string" ? merchant.trim() : "";
  const raw = explicit || (typeof description === "string" ? description.trim() : "");
  const normalized = raw.normalize("NFC").replace(/\s+/gu, " ").trim();
  const cleaned = normalized
    .replace(/\s+#?[A-Z0-9-]*\d[A-Z0-9-]*$/iu, "")
    .replace(/\s+\d{4,}(?:\s+\d{2,})*$/u, "")
    .replace(/[\s*#-]+$/u, "")
    .trim();
  const label = cleaned || normalized || "Unknown merchant";
  return { key: label.toLocaleLowerCase("en-US"), label };
}
