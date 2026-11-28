import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("teamspaces is gone from the app and the sidebar", () => {
  for (const file of ["src/App.jsx", "src/components/WorkspaceSidebar.jsx"]) assert.doesNotMatch(readFileSync(file, "utf8"), /Teamspaces|团队空间|teamspaces/);
});
