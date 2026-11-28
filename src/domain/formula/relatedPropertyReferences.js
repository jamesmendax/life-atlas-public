import { parseFormula } from "./engine.js";
import { isListRollupAggregation } from "../rollupConfiguration.js";

const mayHaveRelatedCall = expression => typeof expression === "string" && expression.includes(".") && /\bprop\b/i.test(expression);
const merge = groups => new Set(groups.flatMap(group => [...group]));
const quote = value => '"' + value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n").replaceAll("\r", "\\r").replaceAll("\t", "\\t") + '"';

function replaceRanges(expression, edits) {
  for (const { start, end, text } of edits.sort((a, b) => b.start - a.start)) {
    expression = expression.slice(0, start) + text + expression.slice(end);
  }
  return expression;
}

// Only the database ID of a bound related-property call belongs to the bundle
// namespace. Its field ID is local to that database, and normal strings are text.
export function remapFormulaSources(expression, remap) {
  if (!mayHaveRelatedCall(expression)) return expression;
  const calls = [];
  try { parseFormula(expression, { onRelatedProperty: (node, range) => calls.push([node, range]) }); }
  catch { return expression; }
  const edits = [];
  for (const [node, range] of calls) {
    node.bindings?.forEach(({ sourceId }, index) => {
      const id = remap(sourceId);
      if (id !== sourceId) edits.push({ ...range.sources[index], text: quote(id) });
    });
  }
  return replaceRanges(expression, edits);
}

export function bindRenamedRelatedProperties(workspace, owner, expression, target, affectedNames) {
  if (!mayHaveRelatedCall(expression) || !affectedNames.size) return expression;
  const ranges = new WeakMap();
  let root;
  try { root = parseFormula(expression, { onRelatedProperty: (node, range) => ranges.set(node, range) }); }
  catch { return expression; }
  const sources = new Map(workspace.dataSources.map(source => [source.id, source]));
  const active = new Set();
  const known = new Map();
  const edits = [];
  // Infer only the possible databases of page values. The evaluator preserves
  // these values through selectors, conditional branches and collection callbacks.
  function relationSources(source, property) {
    const relation = workspace.relations?.find(entry => entry.sourceId === source.id && entry.propertyId === property.id);
    const id = relation?.targetSourceId || property.config?.targetSourceId;
    return id ? [id] : [];
  }

  function propertySources(source, property) {
    if (property?.type === "relation") return relationSources(source, property);
    const showRollup = property?.type === "rollup" && isListRollupAggregation(property.config?.aggregation);
    if (property?.type !== "formula" && !showRollup) return [];
    // A conditional can return a page even if its other branch is recursive.
    // The actual receiving page will still check its database before using a binding.
    if (active.has(property)) return new Set(sources.keys());
    if (known.has(property)) return known.get(property);
    active.add(property);
    try {
      let result;
      if (showRollup) {
        const relation = source.properties.find(field => field.type === "relation" && field.id === property.config?.relationPropertyId);
        const databases = relation ? relationSources(source, relation) : [];
        result = merge(databases.map(id => {
          const database = sources.get(id);
          return propertySources(database, database?.properties.find(field => field.id === property.config?.targetPropertyId));
        }));
      } else {
        let ast;
        try { ast = parseFormula(property.config?.expression); } catch { return []; }
        result = visit(ast, source, new Map());
      }
      known.set(property, result);
      return result;
    } finally {
      active.delete(property);
    }
  }
  function visit(node, source, scope) {
    if (!node) return [];
    if (node.kind === "Identifier") return scope.get(node.name) || [];
    if (node.kind === "PropertyRef") return propertySources(source, source.properties.find(field =>
      node.propertyId !== undefined ? field.id === node.propertyId : field.name === node.propertyName));
    if (node.kind === "RelatedProperty") {
      const receivers = new Set(visit(node.argument, source, scope));
      const boundField = id => node.bindings?.find(binding => binding.sourceId === id)?.propertyId;
      const range = ranges.get(node);
      const affected = affectedNames.get(node.propertyName);
      if (range && receivers.has(target.id) && affected && !boundField(target.id)) {
        edits.push({ start: range.close, end: range.close, text: `, ${quote(target.id)}, ${quote(affected)}` });
      }
      return merge([...receivers].map(id => {
        const database = sources.get(id);
        const bound = boundField(id);
        return propertySources(database, database?.properties.find(field => bound ? field.id === bound : field.name === node.propertyName));
      }));
    }
    const read = child => visit(child, source, scope);
    if (node.kind === "CallExpression") {
      const name = node.name.toLowerCase(), args = node.args;
      if (name === "let" || name === "lets") {
        const locals = new Map(scope);
        for (let i = 0; i + 1 < args.length; i += 2) locals.set(args[i].name, visit(args[i+1], source, locals));
        return visit(args.at(-1), source, locals);
      }
      if (["filter", "map", "find", "findindex", "sort", "some", "every"].includes(name)) {
        const list = read(args[0]);
        const locals = new Map(scope);
        locals.set("current", list);
        locals.set("index", []);
        const result = visit(args[1], source, locals);
        if (name === "some" || name === "every" || name === "findindex") return [];
        return name === "map" ? result : list;
      }
      const results = args.map(read);
      if (["first", "last", "at", "flat", "unique", "slice"].includes(name)) return results[0] || [];
      if (name === "concat") return merge(results);
      if (name === "if") return merge(results.slice(1));
      if (name === "ifs") return merge(results.filter((_, i) => i % 2 === 1 || i === results.length - 1));
      return [];
    }
    if (node.kind === "ListExpression") return merge(node.args.map(read));
    for (const child of [node.argument, node.left, node.right]) if (child) read(child);
    return [];
  }
  try { visit(root, owner, new Map()); }
  catch (error) {
    // Extremely deep generated input also exceeds the formula evaluator's depth.
    if (error instanceof RangeError) return expression;
    throw error;
  }
  return replaceRanges(expression, edits);
}
