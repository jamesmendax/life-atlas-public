import { copyJson, newEntityId, walkBlocks } from "./blockDocument.js";

const nowIso = () => new Date().toISOString();
export const pageAnchor = () => ({ kind: "page" });
export const blockAnchor = (blockId) => ({ kind: "block", blockId: String(blockId || "") });

export function createDiscussion({ pageId, anchor = pageAnchor(), id = newEntityId("discussion"), now = nowIso() }) {
  return { id, pageId, anchor: copyJson(anchor), resolvedAt: null, createdAt: now, updatedAt: now };
}

export function createComment({ discussionId, authorId, body, id = newEntityId("comment"), now = nowIso() }) {
  return { id, discussionId, authorId, body: String(body || "").trim().slice(0, 20000), createdAt: now, editedAt: null, deletedAt: null };
}

export function editComment(comment, body, now = nowIso()) {
  return { ...comment, body: String(body || "").trim().slice(0, 20000), editedAt: now };
}

export function deleteComment(comment, now = nowIso()) {
  return { ...comment, deletedAt: now };
}

export function setDiscussionResolved(discussion, resolved, now = nowIso()) {
  return { ...discussion, resolvedAt: resolved ? now : null, updatedAt: now };
}

export function discussionAnchorState(discussion, page) {
  if (!discussion || !page || discussion.pageId !== page.id) return "missing-page";
  if (discussion.anchor?.kind === "page") return "active";
  if (discussion.anchor?.kind === "block") {
    return walkBlocks(page.content).some((block) => block.id === discussion.anchor.blockId) ? "active" : "orphaned";
  }
  if (discussion.anchor?.kind === "text") {
    return walkBlocks(page.content).some((block) => block.id === discussion.anchor.blockId) ? "active" : "orphaned";
  }
  return "orphaned";
}

export function pageDiscussions(workspace, pageId, { unresolvedOnly = false } = {}) {
  return (workspace?.discussions || [])
    .filter((discussion) => discussion.pageId === pageId && (!unresolvedOnly || !discussion.resolvedAt))
    .map((discussion) => ({
      ...discussion,
      comments: (workspace?.comments || []).filter((comment) => comment.discussionId === discussion.id && !comment.deletedAt),
    }));
}