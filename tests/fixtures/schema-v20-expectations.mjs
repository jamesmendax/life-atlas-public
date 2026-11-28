export function expectedV20BlockDeclarations(blocks) {
  return (blocks ?? []).map((block) => {
    if (!block || typeof block !== "object") return block;
    const next = { ...block };
    if (Array.isArray(block.children)) next.children = expectedV20BlockDeclarations(block.children);
    if (block.type === "databaseView" && !block.props?.sourceIdsJson) {
      next.props = { ...block.props, sourceIdsJson: JSON.stringify(block.props?.sourceId ? [block.props.sourceId] : []) };
    }
    return next;
  });
}
