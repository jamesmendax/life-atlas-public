// These values exist only during evaluation. Workspace data and ordinary
// database consumers continue to use IDs, strings, and native scalar values.
export const EMPTY_FORMULA_NUMBER = Symbol("empty formula number");

export class FormulaPage {
  constructor(id, title, readProperty, pageId = id) {
    this.id = id;
    this.title = title;
    this.readProperty = readProperty;
    this.pageId = pageId;
  }
}

export class FormulaPerson {
  constructor(id, displayName, email = null) {
    this.id = id;
    this.displayName = displayName;
    this.email = email;
  }
}

export const FORMULA_COLORS = Object.freeze({
  gray: "#686866", brown: "#935a43", orange: "#ad5d16",
  yellow: "#966e13", green: "#28734d", blue: "#246eaa",
  purple: "#8656a5", pink: "#a04776", red: "#b14242",
});

export class StyledFormulaText {
  constructor(runs) {
    if (runs.length > 5000 || runs.reduce((sum, run) => sum + run.text.length, 0) > 100000) throw new TypeError("结果超出范围");
    this.runs = runs;
  }

  toString() { return this.runs.map(run => run.text).join(""); }
}

function runsOf(value) {
  return value instanceof StyledFormulaText ? value.runs : [{ text: String(value ?? ""), styles: [] }];
}

export function joinFormulaText(values, separator = "") {
  if (!values.some(value => value instanceof StyledFormulaText) && !(separator instanceof StyledFormulaText)) return values.join(separator);
  const runs = [];
  for (let index = 0; index < values.length; index++) {
    if (index && String(separator)) runs.push(...runsOf(separator));
    runs.push(...runsOf(values[index]));
    if (runs.length > 5000) throw new TypeError("结果超出范围");
  }
  return new StyledFormulaText(runs);
}

function validateStyles(styles) {
  for (const style of styles) {
    if (typeof style !== "string" || !(["b", "i", "u", "s", "c"].includes(style) || Object.hasOwn(FORMULA_COLORS, style.replace(/_background$/, "")))) throw new TypeError(`未知文字样式：${style}`);
  }
}

export function styleFormulaText(value, ...styles) {
  validateStyles(styles);
  return new StyledFormulaText(runsOf(value).map(run => ({ ...run, styles: [...new Set([...run.styles, ...styles])] })));
}

export function unstyleFormulaText(value, ...styles) {
  validateStyles(styles);
  return new StyledFormulaText(runsOf(value).map(run => ({ ...run, styles: run.styles.filter(style => styles.length && !styles.includes(style)) })));
}

export function linkFormulaText(value, href) {
  if (typeof href !== "string" || !href.trim()) throw new TypeError("需要链接地址");
  return new StyledFormulaText(runsOf(value).map(run => ({ ...run, href })));
}

export function plainFormulaValue(value, { preserveStyles = false, pageTitles = false, preserveReferences = false } = {}) {
  let visited = 0;
  function walk(entry) {
    if (++visited > 100000) throw new TypeError("结果超出范围");
    if (entry === EMPTY_FORMULA_NUMBER) return null;
    if (entry instanceof FormulaPage) return preserveReferences ? entry : pageTitles ? entry.title : entry.id;
    if (entry instanceof FormulaPerson) return preserveReferences ? entry : pageTitles ? entry.displayName : entry.id;
    if (!preserveStyles && entry instanceof StyledFormulaText) return entry.toString();
    if (Array.isArray(entry)) {
      let copy;
      for (let i = 0; i < entry.length; i++) {
        const child = walk(entry[i]);
        if (child !== entry[i]) {
          copy ??= entry.slice();
          copy[i] = child;
        }
      }
      return copy ?? entry;
    }
    return entry;
  }
  return walk(value);
}
