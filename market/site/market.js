const { entries = [] } = globalThis.lifeAtlasMarketCatalog || {};
const kindNames = { template: "页面模板", component: "组件" };
const controls = document.querySelectorAll("[data-category]");
const search = document.getElementById("search");
const items = document.getElementById("catalog-items");
const status = document.getElementById("catalog-status");
const preview = document.getElementById("preview");
const previewContent = document.getElementById("preview-content");
let category = "all";

function element(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function cover(entry) {
  const image = element("img");
  image.loading = "lazy";
  image.src = entry.previewPath;
  image.alt = "";
  return image;
}

function downloadLink(link, entry) {
  link.href = entry.packagePath;
  link.download = entry.packagePath.split("/").pop();
  link.setAttribute("aria-label", `下载${entry.title}`);
  return link;
}

function previewButton(button, entry) {
  button.type = "button";
  button.setAttribute("aria-label", `预览${entry.title}`);
  button.addEventListener("click", () => openPreview(entry));
  return button;
}

function card(entry) {
  const item = element("article", "item");
  const body = element("div", "item-main");
  const actions = element("div", "item-actions");
  actions.append(previewButton(element("button", "quiet", "预览"), entry), downloadLink(element("a", "button", "下载"), entry));
  body.append(element("p", "eyebrow", kindNames[entry.type]), element("h2", "", entry.title), element("p", "item-description", entry.description), actions);
  if (entry.previewPath) {
    const imageButton = previewButton(element("button", "item-cover"), entry);
    imageButton.setAttribute("aria-label", `打开${entry.title}预览`);
    imageButton.append(cover(entry));
    item.append(imageButton);
  }
  item.append(body);
  return item;
}

function renderCatalog() {
  const query = search.value.trim().toLocaleLowerCase();
  const visible = entries.filter((entry) => (category === "all" || entry.type === category) && `${entry.title} ${entry.description} ${kindNames[entry.type]}`.toLocaleLowerCase().includes(query));
  items.replaceChildren(...visible.map(card));
  status.hidden = visible.length > 0;
  status.textContent = !entries.length ? "市集内容暂不可用。" : query ? "没有找到匹配的内容。试试其他关键词。" : "此分类还没有可下载的内容。";
}

function openPreview(entry) {
  document.getElementById("preview-kind").textContent = kindNames[entry.type];
  document.getElementById("preview-title").textContent = entry.title;
  document.getElementById("preview-summary").textContent = entry.description;
  document.getElementById("preview-version").textContent = `版本 ${entry.version}，需要 Life Atlas ${entry.minAppVersion} 或更新版本`;
  downloadLink(document.getElementById("preview-download"), entry);
  previewContent.replaceChildren();
  if (entry.previewPath) {
    const sample = element("div", "sample-document");
    sample.append(cover(entry));
    previewContent.append(sample);
  }
  preview.showModal();
  document.getElementById("preview-scroll").scrollTop = 0;
}

for (const control of controls) control.addEventListener("click", () => {
  category = control.dataset.category;
  for (const item of controls) item.setAttribute("aria-pressed", String(item === control));
  renderCatalog();
});
search.addEventListener("input", renderCatalog);
document.getElementById("open-guide").addEventListener("click", () => document.getElementById("guide").showModal());
for (const button of document.querySelectorAll("[data-close-dialog]")) {
  button.addEventListener("click", () => document.getElementById(button.dataset.closeDialog).close());
}

const appearance = matchMedia("(prefers-color-scheme: dark)");
const themeToggle = document.getElementById("theme-toggle");
let chosenTheme;
try { chosenTheme = localStorage.getItem("life-atlas-market-theme"); } catch { /* File previews may disallow storage. */ }
function renderTheme() {
  const theme = chosenTheme === "dark" || chosenTheme === "light" ? chosenTheme : appearance.matches ? "dark" : "light";
  const label = theme === "dark" ? "切换到白天模式" : "切换到夜间模式";
  document.documentElement.dataset.theme = theme;
  themeToggle.setAttribute("aria-label", label);
  themeToggle.title = label;
}
appearance.addEventListener("change", renderTheme);
themeToggle.addEventListener("click", () => {
  chosenTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  try { localStorage.setItem("life-atlas-market-theme", chosenTheme); } catch { /* File previews may disallow storage. */ }
  renderTheme();
});

renderTheme();
renderCatalog();
