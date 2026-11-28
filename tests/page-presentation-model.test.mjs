import assert from "node:assert/strict";
import { test } from "node:test";
import { createPresentationSlides, snapshotPresentationSources } from "../src/components/pagePresentationModel.js";

test("Presentation copies nonempty slide groups and uses top-level dividers only", () => {
  const divider = { id: "outer-divider", type: "divider" };
  const title = {
    id: "source-toggle",
    type: "heading",
    props: { isToggleable: true },
    content: "第一节",
    children: [{ id: "inner-divider", type: "divider" }, { id: "inner", type: "paragraph", content: "子区块" }],
  };
  const blocks = [
    divider, title, divider, divider, { id: "last", type: "paragraph", content: "第二节" }, divider,
    { id: "blank", type: "paragraph", content: [] },
  ];
  const before = JSON.stringify(blocks);
  const slides = createPresentationSlides(blocks);
  assert.deepEqual(slides.map(([block]) => block.content), ["第一节", "第二节"]);
  assert.notEqual(slides[0][0].id, title.id);
  assert.notEqual(slides[0][0].children[0].id, "inner-divider");
  assert.equal(slides[0][0].children[0].type, "divider");
  slides[0][0].children[1].content = "副本改动";
  assert.equal(JSON.stringify(blocks), before);
  assert.deepEqual(createPresentationSlides([{ type: "paragraph", content: "" }]), []);
});

test("Presentation opens transitive synced content from an isolated snapshot", () => {
  const ref = (sourceId) => ({ type: "syncedBlock", props: { sourceId } });
  const source = {
    a: { id: "a", blocks: [ref("b"), ref("missing")] },
    b: { id: "b", blocks: [{ id: "original", type: "paragraph", content: "演示版本" }] },
    unrelated: { id: "unrelated", blocks: [] },
  };
  const reader = snapshotPresentationSources([ref("a")], { getSource: (id) => source[id] });
  source.b.blocks[0].content = "新版本";
  assert.equal(reader.getSource("b").blocks[0].content, "演示版本");
  assert.notEqual(reader.getSource("b").blocks[0].id, "original");
  assert.equal(reader.getSource("a").blocks[0].props.sourceId, "b");
  assert.equal(reader.getSource("missing"), null);
  assert.equal(reader.getSource("unrelated"), null);
  assert.equal(reader.updateSource, undefined);
});
