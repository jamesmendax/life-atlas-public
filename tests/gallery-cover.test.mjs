import test from "node:test";
import assert from "node:assert/strict";
import { galleryCoverImage } from "../src/data/coverGallery.js";

test("gallery covers resolve to image addresses", () => {
  const answers = [
    [null, null], ["data:image/png;base64,AAAA", { url: "data:image/png;base64,AAAA", position: 50 }],
    [{ kind: "gallery", value: "hokusai-landscape", position: 30 }, { url: "/covers/hokusai-landscape.jpg", position: 30 }],
    [{ kind: "gallery", value: "hokusai-landscape" }, { url: "/covers/hokusai-landscape.jpg", position: 50 }],
    [{ kind: "preset", value: "indigo" }, { url: "/covers/hokusai-landscape.jpg", position: 50 }],
    [{ kind: "upload", value: "data:image/png;base64,BBBB", position: 20 }, { url: "data:image/png;base64,BBBB", position: 20 }],
    [{ kind: "gallery", value: "no-such-cover" }, null],
  ];
  for (const [cover, expected] of answers) assert.deepEqual(galleryCoverImage(cover), expected);
});
