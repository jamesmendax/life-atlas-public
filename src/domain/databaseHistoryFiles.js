export function visitDatabaseVersionFiles(versions = [], visit) {
  for (const version of versions) {
    const fields = (version.source?.properties || []).filter((property) => property.type === "files");
    for (const item of version.items || []) {
      const values = item.values;
      for (const { id } of fields) {
        const raw = values?.[id];
        if (Array.isArray(raw)) raw.forEach((value, index) => {
          if (typeof value === "string" && value) visit(raw, index, version, item, id);
        });
        else if (typeof raw === "string" && raw) visit(values, id, version, item, id);
      }
    }
  }
}
