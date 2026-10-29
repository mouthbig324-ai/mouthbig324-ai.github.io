/** @param {string | null | undefined} value */
export function normalizePostCategory(value) {
  const category = typeof value === "string" ? value.trim() : "";
  if (category === "无") return "";
  return category === "日常" ? "生活碎片" : category;
}
