const isId = (value) => typeof value === "string" && value.trim().length > 0;
const hasDeclaration = (value) => value != null && !(typeof value === "string" && value.trim() === "");

function validateIds(ids, field, kind = "VIEW") {
  const label = kind === "VIEW" ? "View" : "Data source";
  if (!Array.isArray(ids)) return [{ code: kind + "_IDS_NOT_ARRAY", field, value: ids, message: label + " IDs must be an ordered array." }];
  const problems = [], seen = new Set();
  for (let index = 0; index < ids.length; index += 1) {
    const value = ids[index];
    if (!isId(value)) problems.push({ code: kind + "_ID_INVALID", field, index, value, message: label + " ID must be a nonempty string." });
    else if (seen.has(value)) problems.push({ code: kind + "_ID_DUPLICATE", field, index, value, message: `${label} ID "${value}" is declared more than once.` });
    else seen.add(value);
  }
  return problems;
}

export function normalizeDatabaseOccurrenceSourceIds(sourceId, ids) {
  return ids == null ? isId(sourceId) ? [sourceId] : [] : ids;
}

export function resolveDatabaseOccurrenceSources(workspace, { sourceId, sourceIdsJson } = {}) {
  const known = hasDeclaration(sourceIdsJson);
  const field = "sourceIdsJson";
  let sourceIds = normalizeDatabaseOccurrenceSourceIds(sourceId);
  const problems = [];
  if (known) {
    sourceIds = [];
    if (typeof sourceIdsJson !== "string") {
      problems.push({ code: "SOURCE_IDS_JSON_TYPE", field, value: sourceIdsJson, message: "sourceIdsJson must be a JSON string." });
    } else {
      try {
        const parsed = JSON.parse(sourceIdsJson);
        problems.push(...validateIds(parsed, field, "SOURCE"));
        if (Array.isArray(parsed)) {
          sourceIds = parsed;
          if (!isId(sourceId) || parsed[0] !== sourceId) {
            problems.push({ code: "PRIMARY_SOURCE_NOT_FIRST", field, value: sourceId, message: "The first source must be the container's primary source." });
          }
        }
      } catch {
        problems.push({ code: "SOURCE_IDS_JSON_INVALID", field, value: sourceIdsJson, message: "sourceIdsJson is not valid JSON." });
      }
    }
    const existing = new Set((workspace?.dataSources ?? []).map(source => source.id));
    sourceIds.forEach((id, index) => {
      if (isId(id) && !existing.has(id)) problems.push({ code: "SOURCE_MISSING", field, index, value: id, message: `Data source "${id}" does not exist.` });
    });
  }
  return { known, sourceIds, problems };
}

/**
 * Resolve one occurrence without inferring membership or changing the workspace.
 * Missing/null/blank JSON is legacy (known=false); explicit JSON, including [], is known even when invalid.
 * viewIds preserves parsed entries and order. views has matching positions: original objects or null for absent/invalid IDs.
 * Trashed/foreign objects remain inspectable in views; any problem makes selectedView null.
 */
export function resolveDatabaseOccurrenceViews(workspace, { sourceId, sourceIdsJson, viewId, viewIdsJson } = {}) {
  const known = hasDeclaration(viewIdsJson);
  const membership = resolveDatabaseOccurrenceSources(workspace, { sourceId, sourceIdsJson });
  const problems = [...membership.problems];
  const sourceIds = new Set(membership.sourceIds);
  let viewIds = [], declaredArray = false;
  if (known) {
    if (typeof viewIdsJson !== "string") {
      problems.push({ code: "VIEW_IDS_JSON_TYPE", field: "viewIdsJson", value: viewIdsJson, message: "viewIdsJson must be a JSON string." });
    } else {
      try {
        const parsed = JSON.parse(viewIdsJson);
        declaredArray = Array.isArray(parsed);
        if (declaredArray) viewIds = parsed;
        problems.push(...validateIds(parsed, "viewIdsJson"));
        if (!declaredArray) problems[problems.length - 1].raw = viewIdsJson;
      } catch {
        problems.push({ code: "VIEW_IDS_JSON_INVALID", field: "viewIdsJson", value: viewIdsJson, message: "viewIdsJson is not valid JSON." });
      }
    }
  } else if (viewId != null && viewId !== "") {
    viewIds = [viewId];
    problems.push(...validateIds(viewIds, "viewId"));
  }

  const databaseViews = workspace?.databaseViews ?? [];
  if (!membership.known && (viewIds.length || (viewId != null && viewId !== "")) && !(workspace?.dataSources ?? []).some((source) => source.id === sourceId)) {
    problems.push({ code: "SOURCE_MISSING", field: "sourceId", value: sourceId, message: `Data source "${sourceId}" does not exist.` });
  }
  function resolveReference(id, field, index) {
    if (!isId(id)) return null;
    const view = databaseViews.find((entry) => entry.id === id);
    const location = { field, ...(index === undefined ? {} : { index }), value: id };
    if (!view) {
      problems.push({ code: "VIEW_MISSING", ...location, message: `View "${id}" does not exist.` });
      return null;
    }
    if (view.trashedAt) problems.push({ code: "VIEW_TRASHED", ...location, message: `View "${id}" is in the trash.` });
    if (!sourceIds.has(view.sourceId)) problems.push({ code: "VIEW_SOURCE_MISMATCH", ...location, sourceId, actualSourceId: view.sourceId, message: `View "${id}" belongs to a different data source.` });
    return view;
  }

  const views = viewIds.map((id, index) => resolveReference(id, known ? "viewIdsJson" : "viewId", known ? index : undefined));
  const currentIndex = viewIds.indexOf(viewId);
  let selectedView = null;
  if (viewId != null && viewId !== "") {
    if (currentIndex >= 0) selectedView = views[currentIndex];
    else if (!isId(viewId)) problems.push({ code: "VIEW_ID_INVALID", field: "viewId", value: viewId, message: "The current view ID must be a nonempty string." });
    else selectedView = resolveReference(viewId, "viewId");
  }
  if (declaredArray && (!isId(viewId) || currentIndex < 0)) {
    problems.push({ code: "CURRENT_VIEW_NOT_MEMBER", field: "viewId", value: viewId, message: `Current view "${viewId}" is not a member of the declared view set.` });
  }
  return { known, viewIds, views, selectedView: problems.length ? null : selectedView, problems };
}

/** Serialize an intentional ordered membership write. Never trims, sorts, deduplicates or adds metadata. */
function serializeIds(ids, kind) {
  const problems = validateIds(ids, "ids", kind);
  if (problems.length) {
    const error = new TypeError(problems[0].message);
    error.code = problems[0].code;
    error.problems = problems;
    throw error;
  }
  return JSON.stringify([...ids]);
}

export const serializeDatabaseOccurrenceViewIds = ids => serializeIds(ids, "VIEW");
export const serializeDatabaseOccurrenceSourceIds = ids => serializeIds(ids, "SOURCE");
