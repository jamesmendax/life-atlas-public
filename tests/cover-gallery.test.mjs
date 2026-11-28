import test from "node:test";
import assert from "node:assert/strict";
import { galleryCoverImage } from "../src/data/coverGallery.js";

test("gallery covers preserve local asset urls and zero positions", () => {
  const url = `life-asset://${"a".repeat(64)}`;
  assert.deepEqual(galleryCoverImage({ kind: "upload", value: url, position: 0 }), { url, position: 0 });
  assert.deepEqual(galleryCoverImage({ kind: "gallery", value: "hokusai-landscape", position: 0 }), { url: "/covers/hokusai-landscape.jpg", position: 0 });
  assert.equal(galleryCoverImage({ kind: "upload", value: "" }), null);
});
