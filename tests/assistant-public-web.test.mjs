import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createAssistantWeb } from "../electron/main/assistant/publicWeb.js";
import { PNG_1X1_BASE64 } from "./fixtures/full-workspace.mjs";

function pageFixture(html, source) {
  return createAssistantWeb({
    request: async () => ({ bytes: Buffer.from(html), contentType: "text/html", url: source }),
  });
}

test("a public profile lists the labeled photo ahead of sharing buttons and the wordmark", async () => {
  const source = "https://museum.example/collection/moon-compass";
  const web = pageFixture(`
    <head>
      <title>Moon Compass | Museum collection</title>
      <meta property="og:image" content="/social/moon.jpg">
      <meta property="og:image:alt" content="Moon Compass on display">
    </head>
    <main>
      <h1>Moon Compass</h1><p>A survey instrument in the museum collection.</p>
      <img src="/social/share.png" width=32 height=32 alt="Share">
      <img src="/media/wordmark.png" width="480" height="111" alt="Moon Compass">
      <img src="data:image/png;base64,AAAA" alt="Moon Compass" data-src="/media/moon-compass.png"
        data-plugin-rwidth="476" data-plugin-rheight="910">
      <img src="/media/moon-compass.png" alt="">
      <img src="http://127.0.0.1/private.png" alt="Private" width="700" height="900">
    </main>`, source);

  const page = await web.run("read_web_page", { url: source });
  assert.deepEqual(page.images[0], {
    image_url: "https://museum.example/media/moon-compass.png", source_url: source, title: "Moon Compass", width: 476, height: 910,
  });
  assert.deepEqual(page.images.map(({ image_url }) => image_url), [
    "https://museum.example/media/moon-compass.png", "https://museum.example/media/wordmark.png", "https://museum.example/social/moon.jpg",
  ]);
});

test("a public gallery exposes responsive images and labeled profile links", async () => {
  const source = "https://museum.example/collection/";
  const web = pageFixture(`
    <head><title>Museum collection</title></head>
    <nav><a href="/support">Support</a></nav>
    <main>
      <h1>Museum collection</h1>
      <a href="moon-compass#details"><img src="/media/moon-compass.svg" alt="Moon &amp; stars compass"></a>
      <a href="sun-dial?display=gallery&amp;view=details" aria-label="Sun dial">
        <picture>
          <source srcset="/media/dial-480.webp 480w, /media/dial-960.webp 960w">
          <img src="/media/dial.svg" alt="The sun dial">
        </picture>
      </a>
      <a href="moon-compass#history">Duplicate profile</a>
      <a href="http://127.0.0.1/internal">Private</a>
      <a href="/advert" rel="sponsored">Advertisement</a>
      <img src="/render?artifact=4&amp;size=800" alt="Star chart" width="800" height="500">
    </main>`, source);

  const page = await web.run("read_web_page", { url: source });
  assert.deepEqual(page.links, [
    { title: "Moon & stars compass", url: "https://museum.example/collection/moon-compass" },
    { title: "Sun dial", url: "https://museum.example/collection/sun-dial?display=gallery&view=details" },
  ]);
  assert.deepEqual(page.images.map(({ image_url, title }) => ({ image_url, title })), [
    { image_url: "https://museum.example/render?artifact=4&size=800", title: "Star chart" },
    { image_url: "https://museum.example/media/dial-960.webp", title: "The sun dial" },
  ]);
});

test("a public homepage exposes its navigation separately from main content links", async () => {
  const source = "https://museum.example/";
  const other = Array.from({ length: 15 }, (_, i) => `<a href="/section-${i}">Section ${i}</a>`).join("");
  const web = pageFixture(`
    <head><title>Museum online</title></head>
    <header>
      <a href="/press">Press office</a>
      <nav>
        <a href="/collection" aria-label="Browse the collection"><svg></svg></a>
        <a href="/collection#browse">Duplicate collection link</a>
        <a href="http://127.0.0.1/admin">Private</a>
        <script>const text = '<a href="/injected">Script markup</a>';</script>
        ${other}
      </nav>
    </header>
    <main>
      <p>Explore the museum.</p>
      <a href="/exhibit/sun-dial">Sun dial exhibit</a>
      <a href="/exhibit/moon-compass">Moon compass exhibit</a>
    </main>`, source);

  const page = await web.run("read_web_page", { url: source });
  assert.deepEqual(page.links, [
    { title: "Sun dial exhibit", url: "https://museum.example/exhibit/sun-dial" },
    { title: "Moon compass exhibit", url: "https://museum.example/exhibit/moon-compass" },
  ]);
  assert.deepEqual(page.navigation_links, [
    { title: "Browse the collection", url: "https://museum.example/collection" },
    ...Array.from({ length: 9 }, (_, i) => ({ title: `Section ${i}`, url: `https://museum.example/section-${i}` })),
  ]);
  assert.equal(page.text, "Explore the museum. Sun dial exhibit Moon compass exhibit");
});

test("official links in the complete article survive its first sixty content links", async () => {
  const source = "https://museum.example/guide";
  const related = Array.from({ length: 65 }, (_, i) => `<a href="/record-${i}">Record ${i}</a>`).join("");
  const web = pageFixture(`
    <main><p>Museum guide</p>${related}
      <a href="https://maker.example/">Official website</a>
      <a href="https://maker.example/profile">官方资料</a>
      <a href="https://maker.example/ja/profile">公式プロフィール</a>
      <a href="https://www.museum.example/internal">Official profile</a>
      <a href="http://127.0.0.1/internal">Official website</a>
      <a href="https://fan.example/">Unofficial website</a>
    </main>`, source);

  const page = await web.run("read_web_page", { url: source });
  assert.equal(page.links.length, 60);
  assert.equal(page.links.at(-1).title, "Record 59");
  assert.deepEqual(page.official_links, [
    { title: "Official website", url: "https://maker.example/" },
    { title: "官方资料", url: "https://maker.example/profile" },
    { title: "公式プロフィール", url: "https://maker.example/ja/profile" },
  ]);
});

test("public pages with only usable link or media metadata still return results", async () => {
  const source = "https://museum.example/gallery";
  const linkPage = pageFixture('<main><a href="/collection" aria-label="Browse collection"><svg></svg></a></main>', source);
  const mediaPage = pageFixture('<main><img alt="Moon compass" src="/compass.jpg"></main>', source);
  const emptyPage = pageFixture('<main><img src="http://127.0.0.1/private.png"></main>', source);

  const links = await linkPage.run("read_web_page", { url: source });
  assert.equal(links.text, "");
  assert.equal(links.links[0].url, "https://museum.example/collection");
  const media = await mediaPage.run("read_web_page", { url: source });
  assert.equal(media.text, "");
  assert.equal(media.images[0].image_url, "https://museum.example/compass.jpg");
  await assert.rejects(emptyPage.run("read_web_page", { url: source }), { code: "E_NOT_FOUND" });
});

test("long public page fields stay within the assistant tool message limit", async () => {
  const longPath = "x".repeat(1850);
  const source = `https://museum.example/catalog/${longPath}`;
  const images = Array.from({ length: 6 }, (_, i) =>
    `<img src="/images/${longPath}-${i}.jpg" alt="Museum collection" width="800" height="500">`).join("");
  const links = Array.from({ length: 40 }, (_, i) =>
    `<a href="/collection/${longPath}-${i}/">Catalog record ${i}</a>`).join("");
  const web = pageFixture(`
    <head><title>Museum collection</title></head>
    <header><a href="/section/${longPath}/">Navigation with a long URL</a></header>
    <main>
      <p>Collection overview ${'"'.repeat(12000)}</p>
      ${images}
      <a href="/related">Related inventory</a>
      ${links}
    </main>`, source);

  const page = await web.run("read_web_page", { url: source });
  const toolMessage = JSON.stringify({ ok: true, ...page, candidate_count: page.images?.length ?? 0 });
  assert.ok(toolMessage.length < 32000);
  assert.ok(JSON.stringify(page).length <= 30000);
  assert.ok(page.text.startsWith("Collection overview"));
  assert.equal(page.text.length, 12000);
  assert.equal(page.images[0].source_url, source);
  assert.ok(page.images.length < 6);
  assert.deepEqual(page.links, [{ title: "Related inventory", url: "https://museum.example/related" }]);
  assert.equal(page.navigation_links, undefined);
});

test("a direct public raster read returns a verified image observation without image bytes", async () => {
  const requested = "https://museum.example/image-redirect";
  const fixtures = [
    ["image/png", "Moon%20Compass.png", "Moon Compass.png", Buffer.from(PNG_1X1_BASE64, "base64")],
    ["image/jpeg", "landscape.jpg", "landscape.jpg", await readFile(new URL("../public/covers/hu-yuan-landscape.jpg", import.meta.url))],
    ["image/webp", "render", "render", await readFile(new URL("../public/assets/covers/masters/vermeer-pearl-earring.webp", import.meta.url))],
  ];
  for (const [type, path, filename, bytes] of fixtures) {
    const source = `https://cdn.museum.example/${path}?revision=4`;
    const web = createAssistantWeb({ request: async (url, options) => {
      assert.equal(url, requested);
      assert.match(options.accept, /text\/html/);
      assert.ok(options.accept.split(",").includes(type));
      assert.equal(options.bytesLimit, undefined);
      return { bytes, contentType: type, url: `${source}#preview` };
    } });

    const page = await web.run("read_web_page", { url: requested });
    const candidate = page.images[0];
    assert.ok(candidate.width > 0 && candidate.height > 0);
    assert.deepEqual(page, {
      url: source, title: filename, text: "",
      images: [{ image_url: source, source_url: source, title: filename, filename, content_type: type,
        width: candidate.width, height: candidate.height }],
    });
  }
});

test("a public read rejects unspecified, unsupported, or invalid raster responses", async () => {
  const requested = "https://museum.example/asset";
  const png = Buffer.from(PNG_1X1_BASE64, "base64");
  const cases = [
    ["application/octet-stream", png, requested, "该网址没有返回可读取的网页文本。"],
    ["image/gif", Buffer.from("GIF89a"), requested, "该网址没有返回可读取的网页文本。"],
    ["image/png", Buffer.from("Invalid PNG"), requested, "该网址没有返回可读取的 JPG、PNG 或 WebP 图片。"],
    ["image/png", png, "http://127.0.0.1/private.png", "请使用可公开访问的网页或图片网址。"],
  ];
  for (const [contentType, bytes, url, message] of cases) {
    const web = createAssistantWeb({ request: async () => ({ bytes, contentType, url }) });
    await assert.rejects(web.run("read_web_page", { url: requested }), { code: "E_INVALID_ARGUMENT", message });
  }
});
