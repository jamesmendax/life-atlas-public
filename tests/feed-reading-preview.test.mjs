import assert from "node:assert/strict";
import test from "node:test";
import { materializeDocument } from "../src/domain/documentSemantics.js";
import { feedExcerpt } from "../src/domain/feedPreview.js";

const picture = {type:"image", props:{attachmentId:"pic", name:"河岸照片"}};
const span = {type:"text", text:"一二三四五", styles:{bold:true}};

test("the feed retains local media through nested and synced content while plain export keeps its text", () => {
  const blocks = [{type:"paragraph",children:[{type:"syncedBlock",props:{sourceId:"shared"}}]}];
  const w = {syncedSources:[{id:"shared", blocks:[picture]}]};
  const feed = materializeDocument(blocks,w,new Set(),0,{preserveMedia:true});
  assert.deepEqual(feed[0].children[0].props,picture.props);
  assert.equal(feed[0].children[0].type,"image");
  assert.equal(materializeDocument(blocks,w)[0].children[0].content,"河岸照片");
});
test("a long excerpt keeps marks, link targets and original contents", () => {
  const link = {type:"link", href:"https://www.notion.com", content:[span]};
  const blocks = [{type:"paragraph",content:[link]}];
  const result = feedExcerpt(blocks,4,3);
  assert.equal(result.truncated,true);
  assert.deepEqual(result.blocks[0].content[0],{...link, content:[{...span,text:"一二三…"}]});
  assert.equal(blocks[0].content[0].content[0].text,"一二三四五");
  assert.equal(feedExcerpt(blocks,4,5).blocks,blocks);
});
test("collapsed tables and nested lists have bounded previews and can expand without losing their source", () => {
  const cells = Array.from({length:7},()=>[span]);
  const rows = Array.from({length:4},()=>({cells}));
  const blocks = [{type:"table",content:{type:"tableContent",headerRows:1,rows}},{type:"bulletListItem",content:"清单",children:[picture]}];
  const excerpt = feedExcerpt(blocks);
  assert.equal(excerpt.truncated,true);
  assert.equal(excerpt.blocks[0].content.rows.length,3);
  assert.equal(excerpt.blocks[0].content.rows[0].cells.length,6);
  assert.equal(excerpt.blocks[0].content.headerRows,1);
  assert.deepEqual(excerpt.blocks[1].children,[]);
  assert.equal(blocks[1].children[0].type,"image");
});

test("merged cell extents respect the visible rectangle, and legacy text cells remain readable", () => {
  const original = [{type:"table",content:{type:"tableContent",rows:[
    {cells:[{type:"tableCell",props:{colspan:4,rowspan:4},content:[span]}, "末列"]},
    {cells:["5","6","7"]},
  ]}}];
  const full = materializeDocument(original,{});
  assert.equal(full[0].content.rows[0].cells[0].props.rowspan,4);
  const {blocks,truncated} = feedExcerpt(full);
  assert.equal(truncated,true);
  assert.equal(blocks[0].content.rows[0].cells[0].props.rowspan,3);
  assert.deepEqual(blocks[0].content.rows[1].cells,["5","6"]);
  assert.equal(full[0].content.rows[0].cells[1],"末列");
});
