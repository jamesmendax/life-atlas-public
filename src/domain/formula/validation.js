import { parseFormula } from "./engine.js";

export function formulaSyntaxError(expression) {
  if (!String(expression ?? "").trim()) return null;
  try {
    parseFormula(expression);
    return null;
  } catch (error) {
    return error.message;
  }
}
