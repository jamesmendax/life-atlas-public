import { normalizeIdValues } from "./databaseProperties.js";

export function createRelationValueValidator(dataSources = [], relations = [], databaseItems = []) {
  const fields = new Map(dataSources.map(source => [
    source.id,
    new Map((source.properties || []).filter(property => property.type === "relation").map(property => [
      property.id, { property, targetSourceId: property.config?.targetSourceId },
    ])),
  ]));
  for (const relation of relations) {
    const field = fields.get(relation.sourceId)?.get(relation.propertyId);
    if (!field || field.definitionFound) continue;
    field.definitionFound = true;
    if (relation.targetSourceId) field.targetSourceId = relation.targetSourceId;
  }
  const items = new Map(databaseItems.map(item => [item.id, item]));
  return (entity, values) => {
    const issues = [];
    for (const { property, targetSourceId } of fields.get(entity.sourceId)?.values() || []) {
      const raw = values?.[property.id];
      if (raw == null || raw === "") continue;
      const name = property.name || property.id;
      if ((Array.isArray(raw) ? raw : [raw]).some(id => typeof id !== "string" || !id.trim())) {
        issues.push({ code: "RELATION_VALUE_INVALID", message: `关联属性「${name}」包含无效的记录标识。` });
        continue;
      }
      const ids = normalizeIdValues(raw);
      if (property.config?.relationLimit === 1 && ids.length > 1) {
        issues.push({ code: "RELATION_VALUE_LIMIT", message: `关联属性「${name}」最多可关联 1 条记录，文件中包含 ${ids.length} 条。` });
      }
      for (const id of ids) {
        const related = items.get(id);
        if (!related) issues.push({ code: "RELATION_VALUE_MISSING", message: `关联属性「${name}」引用的记录 ${id} 不存在。` });
        else if (!targetSourceId || related.sourceId !== targetSourceId) {
          issues.push({ code: "RELATION_VALUE_WRONG_SOURCE", message: `关联属性「${name}」引用的记录 ${id} 不属于目标数据库。` });
        }
      }
    }
    return issues;
  };
}
