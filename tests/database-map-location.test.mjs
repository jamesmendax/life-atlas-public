import assert from "node:assert/strict";
import test from "node:test";
import { installSessionSecurity } from "../electron/main/security.js";
import { currentDeviceLocation } from "../src/components/databaseMapLocation.js";

test("device location is one-shot and never substitutes coordinates when denied or unavailable", async () => {
  const point = [12.345, -45.678];
  assert.deepEqual(await currentDeviceLocation({ getCurrentPosition(allow, _, options) {
    assert.deepEqual(options, { maximumAge: 0, timeout: 12000, enableHighAccuracy: false });
    allow({ coords: { latitude: point[0], longitude: point[1] } });
  } }), { status: "located", point });
  for (const [code, status] of [[1, "denied"], [2, "unavailable"], [3, "timeout"]]) {
    assert.deepEqual(await currentDeviceLocation({ getCurrentPosition(_allow, decline) { decline({ code }); } }), { status });
  }
  assert.deepEqual(await currentDeviceLocation({ getCurrentPosition(allow) { allow({ coords: { latitude: 181, longitude: 5 } }); } }), { status: "unavailable" });
  assert.deepEqual(await currentDeviceLocation(), { status: "unavailable" });
});

test("the desktop reader waits for one-time authorization, revokes it and skips the provider when denied", async () => {
  let count = 0;
  const revoked = [];
  const geolocation = { getCurrentPosition(allow) {
    count++;
    allow({ coords: { latitude: 11, longitude: 22 } });
  } };
  assert.deepEqual(await currentDeviceLocation(geolocation, { authorizeLocation: async () => ({ status: "denied" }) }), { status: "denied" });
  assert.equal(count, 0);
  assert.deepEqual(await currentDeviceLocation(geolocation, {
    authorizeLocation: async () => ({ status: "authorized", token: "synthetic" }), releaseLocation: token => revoked.push(token),
  }), { status: "located", point: [11, 22] });
  assert.deepEqual(revoked, ["synthetic"]);
  assert.equal(count, 1);
});

test("Windows geolocation grants only the approved one-shot current workspace and never outside frames", async () => {
  let request, check, url = "app://bundle/index.html", resolve;
  const noOp = () => {};
  const session = {
    webRequest: { onBeforeRequest: noOp, onCompleted: noOp }, on: noOp,
    setPermissionRequestHandler: callback => { request = callback; },
    setPermissionCheckHandler: callback => { check = callback; },
  };
  const mainFrame = { url, routingId: 5, processId: 17 };
  const contents = { id: 1, isDestroyed: () => false, getURL: () => url, mainFrame };
  const window = { webContents: contents, isDestroyed: () => false };
  const ipc = new Map();
  const prompts = [];
  installSessionSecurity(session, { workspaceUrl: "app://bundle/index.html", getWorkspaceWindow: () => window, locationIpc: { handle: (channel, handler) => ipc.set(channel, handler) },
    dialogs: { showMessageBox(owner, options) { prompts.push({ owner, options }); return new Promise(res => { resolve = res; }); } } });
  const legitimate = { isMainFrame: true, requestingUrl: url };
  const send = (from, details, permission = "geolocation") => new Promise(resolve => request(from, permission, resolve, details));
  const event = { sender: contents, senderFrame: mainFrame };
  const authorize = () => ipc.get("la:database-map:authorize-location")(event);
  const release = token => ipc.get("la:database-map:release-location")(event, token);
  assert.equal(check(contents, "geolocation", "app://bundle", legitimate), false);
  assert.equal(await send(contents, { ...legitimate, isMainFrame: false }), false);
  assert.equal(await send(contents, { ...legitimate, requestingUrl: "app://bundle/vault.html" }), false);
  assert.equal(await send({ ...contents }, legitimate), false);
  assert.equal(await send(contents, legitimate, "camera"), false);
  assert.deepEqual(await ipc.get("la:database-map:authorize-location")({ ...event, senderFrame: { ...mainFrame, routingId: 6 } }), { status: "denied" });
  assert.equal(prompts.length, 0);
  const first = authorize();
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].owner, window);
  assert.equal(prompts[0].options.defaultId, 0);
  resolve({ response: 1 });
  const grant = await first;
  assert.equal(grant.status, "authorized");
  assert.equal(check(contents, "geolocation", "app://bundle", legitimate), true);
  assert.equal(check(contents, "geolocation", "app://attacker", legitimate), false);
  assert.equal(await send(contents, legitimate, "geolocation-approximate"), true);
  release("incorrect");
  assert.equal(await send(contents, legitimate), true);
  release(grant.token);
  assert.equal(await send(contents, legitimate), false);
  const deny = authorize();
  resolve({ response: 0 });
  assert.deepEqual(await deny, { status: "denied" });
  assert.equal(prompts.length, 2);
  const stale = authorize();
  url = "app://bundle/setup.html";
  resolve({ response: 1 });
  assert.deepEqual(await stale, { status: "denied" });
});
