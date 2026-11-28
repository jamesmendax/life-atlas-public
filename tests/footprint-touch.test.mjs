import assert from "node:assert/strict";
import test from "node:test";
import { listenForFootprintTouch } from "../src/editor/widgets/footprintTouch.js";

function mapAt(zoom = 1) {
  const svg = new EventTarget();
  const region = {};
  const map = { width: 600, height: 300 };
  const ignoreClick = { current: false };
  let view = { zoom, x: 0.5, y: 0.5 };
  svg.contains = node => node === region;
  svg.getBoundingClientRect = () => ({ left: 30, top: 20, width: 600, height: 400 });
  // Model the committed SVG viewBox on each render. The map's 2:1 drawing is centered in a 3:2 SVG.
  function render(next) {
    view = next;
    const width = map.width / view.zoom, height = map.height / view.zoom;
    svg.viewBox = { baseVal: { x: view.x * map.width - width / 2, y: view.y * map.height - height / 2, width, height } };
  }
  render(view);
  const dispose = listenForFootprintTouch(svg, map, render, ignoreClick);
  function send(type, ...contacts) {
    const event = new Event(type, { cancelable: true });
    event.touches = contacts.map(([identifier, clientX, clientY, target = region]) => ({ identifier, clientX, clientY, target }));
    svg.dispatchEvent(event);
    return event.defaultPrevented;
  }
  return { send, view: () => view, ignoreClick, dispose };
}

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} differs from ${b}`);

test("footprint pinch holds the geographic point under the fingers including letterboxing and tracks translation", () => {
  const m = mapAt();
  m.send("touchstart", [1, 410, 180]);
  assert.equal(m.send("touchstart", [1, 410, 180], [2, 450, 180]), true);
  assert.equal(m.send("touchmove", [2, 470, 180], [1, 390, 180]), true);
  close(m.view().zoom, 2);
  // Midpoint (430,180) is 100 right and 40 above the center of the drawn map.
  close(m.view().x + 100 / (600 * 2), 0.5 + 100 / 600);
  close(m.view().y - 40 / (300 * 2), 0.5 - 40 / 300);
  const before = m.view();
  m.send("touchmove", [1, 420, 195], [2, 500, 195]);
  close(m.view().zoom, 2);
  close(m.view().x, before.x - 30 / 1200);
  close(m.view().y, before.y - 15 / 600);
  assert.equal(m.ignoreClick.current, true);
});

test("footprint touch lifts and cancellation rebase the remaining finger without a jump or accidental region tap", () => {
  const m = mapAt(2);
  m.send("touchstart", [1, 290, 220]);
  m.send("touchstart", [1, 290, 220], [2, 370, 220]);
  m.send("touchmove", [1, 270, 220], [2, 390, 220]);
  const pinched = m.view();
  close(pinched.zoom, 3);
  m.send("touchend", [2, 390, 220]);
  m.send("touchmove", [2, 390, 220]);
  assert.deepEqual(m.view(), pinched);
  m.send("touchmove", [2, 408, 220]);
  close(m.view().x, pinched.x - 18 / 1800);
  m.send("touchstart", [2, 408, 220], [3, 470, 220]);
  m.send("touchcancel", [2, 408, 220]);
  const cancelled = m.view();
  m.send("touchmove", [2, 408, 229]);
  close(m.view().y, cancelled.y - 9 / 900);
  m.send("touchcancel");
  const last = m.view();
  assert.equal(m.send("touchmove", [2, 650, 220]), false);
  assert.deepEqual(m.view(), last);
  assert.equal(m.ignoreClick.current, true);
  m.send("touchstart", [4, 320, 215]);
  m.send("touchend");
  assert.equal(m.ignoreClick.current, false);
});

test("footprint accepts ordinary scrolling at fit, uses bounded zoom, and ignores touches beginning outside its map", () => {
  const m = mapAt();
  assert.equal(m.send("touchstart", [1, 290, 220]), false);
  assert.equal(m.send("touchmove", [1, 290, 90]), false);
  assert.equal(m.send("touchstart", [1, 290, 90], [2, 360, 90, {}]), false);
  assert.equal(m.send("touchmove", [1, 290, 120], [2, 380, 120, {}]), false);
  assert.deepEqual(m.view(), { zoom: 1, x: 0.5, y: 0.5 });
  m.send("touchend");
  m.send("touchstart", [1, 310, 220], [2, 350, 220]);
  m.send("touchmove", [1, 170, 220], [2, 490, 220]);
  assert.deepEqual(m.view(), { zoom: 6, x: 0.5, y: 0.5 });
  m.send("touchmove", [1, 328, 220], [2, 332, 220]);
  assert.deepEqual(m.view(), { zoom: 1, x: 0.5, y: 0.5 });
  m.dispose();
  assert.equal(m.send("touchmove", [1, 170, 220], [2, 490, 220]), false);
  assert.equal(m.view().zoom, 1);
});
