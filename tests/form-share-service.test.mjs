import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { coreParityWorkspace } from "./fixtures/core-parity-workspace.mjs";
import { createFormShare, registerFormShareIpc } from "../electron/main/formShare.js";
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "la-form-qa-"));
  const w = coreParityWorkspace(),
    view = w.databaseViews.find(v => v.type === "form");
  view.visiblePropertyIds = ["title", "checked", "notes", "status", "amount", "date", "labels"];
  view.config = {
    form: {
      open: true,
      title: "公开问卷",
      description: "登记申请",
      fields: [{
        propertyId: "title",
        required: true
      }, {
        propertyId: "checked"
      }, {
        propertyId: "notes",
        showWhen: {
          propertyId: "checked",
          value: true
        }
      }, {
        propertyId: "status"
      }, {
        propertyId: "amount"
      }, {
        propertyId: "date"
      }, {
        propertyId: "labels"
      }]
    }
  };
  const owner = w.pages.find(p => p.id === w.dataSources.find(s => s.id === view.sourceId).ownerPageId);
  const received = [];
  const create = () => createFormShare({
    dataRoot: root,
    getWorkspace: () => w,
    onReceived: r => received.push(r)
  });
  let share = create();
  t.after(() => {
    share.close();
    fs.rmSync(root, {
      recursive: true,
      force: true
    });
  });
  return {
    root,
    w,
    view,
    owner,
    received,
    get share() {
      return share;
    },
    reopen() {
      share.close();
      share = create();
    }
  };
}
async function post(url, id, values) {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      requestId: id,
      values
    })
  });
}
test("anonymous form is opt-in and its exact fields remain frozen for the lifetime of a link", async t => {
  const q = fixture(t),
    args = {
      viewId: q.view.id
    },
    f = q.share;
  assert.equal(f.status(args).url, null);
  assert.equal(fs.existsSync(path.join(q.root, "runtime")), false);
  await assert.rejects(f.start({
    ...args,
    address: "0.0.0.0"
  }), {
    code: "E_INVALID_ARGUMENT"
  });
  await assert.rejects(f.start({
    ...args,
    address: "127.0.0.1",
    publicBase: "http://example.test"
  }), {
    code: "E_INVALID_ARGUMENT"
  });
  const {
    url
  } = await f.start({
    ...args,
    address: "127.0.0.1"
  });
  const r = await fetch(url),
    html = await r.text();
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-security-policy"), /frame-ancestors 'none'/u);
  assert.ok(html.includes("公开问卷") && !html.includes("Alpha 项目") && !html.includes("负责人"));
  q.view.visiblePropertyIds.push("email");
  assert.equal((await fetch(url).then(r => r.text())).includes('"id":"email"'), false);
  assert.equal((await post(url, randomUUID(), {
    title: "测试",
    email: "someone@example.org"
  })).status, 422);
  assert.equal((await fetch(url, {
    method: "POST",
    headers: {
      Origin: "https://other.example",
      "Content-Type": "application/json"
    },
    body: "{}"
  })).status, 403);
  assert.equal((await post(url, randomUUID(), {
    title: "x".repeat(70000)
  })).status, 413);
  q.owner.settings.locked = true;
  assert.equal((await fetch(url)).status, 410);
  q.owner.settings.locked = false;
  q.owner.trashedAt = "2026-11-25";
  assert.equal((await post(url, randomUUID(), {
    title: "撤回"
  })).status, 410);
  delete q.owner.trashedAt;
  q.view.config.form.open = false;
  assert.equal((await fetch(url)).status, 410);
  q.view.config.form.open = true;
  f.stop(args);
  const replacement = await f.start({
    ...args,
    address: "127.0.0.1"
  });
  assert.notEqual(replacement.url, url);
  assert.ok((await fetch(replacement.url).then(r => r.text())).includes('"id":"email"'));
});
test("HTTP retries persist once and ack removes answers only after the matching database item is saved", async t => {
  const q = fixture(t),
    args = {
      viewId: q.view.id
    },
    id = randomUUID();
  const {
    url
  } = await q.share.start({
    ...args,
    address: "127.0.0.1"
  });
  const values = {
    title: "合成报名",
    checked: true,
    notes: "周五",
    status: "doing",
    amount: "4",
    date: "2026-12-02",
    labels: ["design"]
  };
  assert.equal((await post(url, id, values)).status, 201);
  assert.equal((await post(url, id, values)).status, 200);
  assert.equal((await post(url, id, {
    ...values,
    title: "冲突"
  })).status, 409);
  assert.deepEqual(q.received, [args]);
  const rows = q.share.pending(args).responses;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].values.amount, 4);
  assert.equal((await q.share.ack({
    ...args,
    ids: [rows[0].id]
  })).acknowledged, 0);
  q.reopen();
  assert.equal(q.share.status(args).url, null);
  assert.deepEqual(q.share.pendingViews(), {
    viewIds: [q.view.id]
  });
  assert.deepEqual(q.share.pending(args).responses, rows);
  q.w.databaseItems.push({
    submission: {
      viewId: q.view.id,
      responseId: rows[0].id
    }
  });
  assert.equal((await q.share.ack({
    ...args,
    ids: [rows[0].id]
  })).acknowledged, 1);
  const next = await q.share.start({
    ...args,
    address: "127.0.0.1"
  });
  assert.equal((await post(next.url, id, values)).status, 200);
  assert.deepEqual(q.share.pendingViews(), {
    viewIds: []
  });
  assert.equal(q.received.length, 1);
});
test("a trusted management API can use a user-supplied HTTPS reverse proxy; window subframes cannot operate it", async t => {
  const q = fixture(t),
    req = {
      viewId: q.view.id,
      address: "127.0.0.1",
      publicBase: "https://forms.example.test/team"
    };
  const sender = {
      id: 123,
      mainFrame: {
        routingId: 3,
        processId: 4
      }
    },
    frame = sender.mainFrame,
    trusted = {
      sender,
      senderFrame: frame
    };
  const h = new Map();
  registerFormShareIpc({
    ipcMain: {
      handle: (n, f) => h.set(n, f)
    },
    getWindow: () => ({
      webContents: sender
    }),
    service: q.share
  });
  assert.equal((await h.get("la:forms:start")({
    sender,
    senderFrame: {
      routingId: 4,
      processId: 4
    }
  }, req)).error.code, "E_FORBIDDEN");
  const result = await h.get("la:forms:start")(trusted, req);
  assert.ok(result.ok);
  assert.match(result.value.url, /^https:\/\/forms\.example\.test\/team\/f\//u);
  assert.equal((await h.get("la:forms:status")(trusted, {
    viewId: q.view.id,
    unexpected: 1
  })).error.code, "E_INVALID_ARGUMENT");
});
