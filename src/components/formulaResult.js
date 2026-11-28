import { createElement } from "react";
import { formatDisplayPropertyValue, isEmptyProperty } from "../domain/databaseProperties.js";
import { FORMULA_COLORS, FormulaPage, FormulaPerson, StyledFormulaText } from "../domain/formula/values.js";

function runStyle(styles) {
  const style = {};
  const decorations = [];
  for (const name of styles) {
    if (name === "b") style.fontWeight = 700;
    else if (name === "i") style.fontStyle = "italic";
    else if (name === "c") style.fontFamily = "monospace";
    else if (name === "u") decorations.push("underline");
    else if (name === "s") decorations.push("line-through");
    else {
      const color = name.replace(/_background$/, "");
      if (!Object.hasOwn(FORMULA_COLORS, color)) continue;
      if (name.endsWith("_background")) style.backgroundColor = `var(--mb-u-${color}-bg, ${FORMULA_COLORS[color]}22)`;
      else style.color = `var(--mb-u-${color}, ${FORMULA_COLORS[color]})`;
    }
  }
  if (decorations.length) style.textDecoration = decorations.join(" ");
  return style;
}

export function isMultilineFormulaResult(value) {
  if (typeof value === "string") return /[\r\n]/.test(value);
  if (value instanceof StyledFormulaText) return value.runs.some(run => isMultilineFormulaResult(run.text));
  return Array.isArray(value) && value.some(isMultilineFormulaResult);
}

function formulaLink(href) {
  if (typeof href !== "string" || /[\u0000-\u001f\u007f]/.test(href)) return null;
  try {
    const url = new URL(href);
    return ["https:", "http:", "mailto:", "tel:"].includes(url.protocol) ? url : null;
  } catch { return null; }
}

export function renderFormulaResult(workspace, property, value, source, openPage) {
  if (value instanceof FormulaPage) {
    const title = value.title || "无标题";
    return openPage ? createElement("button", {
      type: "button", className: "db-formula-page",
      onClick: event => { event.stopPropagation(); openPage(value.pageId); },
    }, title) : title;
  }
  if (value instanceof FormulaPerson) return value.displayName;
  if (value instanceof StyledFormulaText) {
    return value.runs.map((run, index) => {
      const url = formulaLink(run.href);
      const style = run.styles.length ? runStyle(run.styles) : undefined;
      if (!url) return style ? createElement("span", { key: index, style }, run.text) : run.text;
      const external = url.protocol === "http:" || url.protocol === "https:";
      return createElement("a", { key: index, href: url.href, style, target: external ? "_blank" : undefined,
        rel: external ? "noopener noreferrer" : undefined, onClick: event => event.stopPropagation() }, run.text);
    });
  }
  if (Array.isArray(value)) {
    const visible = value.filter(entry => !isEmptyProperty(entry))
      .map(entry => renderFormulaResult(workspace, property, entry, source, openPage));
    if (visible.every(entry => typeof entry === "string")) return visible.join(", ");
    return visible.map((entry, index) => createElement("span", { key: index }, index ? ", " : "", entry));
  }
  return formatDisplayPropertyValue(workspace, property, value, source);
}
