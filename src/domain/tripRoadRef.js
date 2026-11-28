export function normalizeRoadRef(value) {
  return typeof value === "string" && /^G[1-9]\d{0,3}$/iu.test(value.trim()) ? value.trim().toUpperCase() : "";
}
