import { coreParityWorkspace } from "./core-parity-workspace.mjs";

function columns(widths, children) {
  return {
    type: "columnList",
    props: { columns: widths.length },
    children: widths.map((width, index) => ({
      type: "column",
      props: { width, index, count: widths.length },
      children: children[index],
    })),
  };
}

export function notionGoldenWorkspace() {
  const workspace = coreParityWorkspace();
  const page = workspace.pages.find((entry) => entry.id === "editor-page");
  workspace.ui = { ...(workspace.ui || {}), selectedPageId: page.id, selectedFolderId: page.folderId, expandedFolderIds: [page.folderId] };
  page.title = "Mendax 的 Vibe Coding Wiki";
  page.icon = "🧭";
  page.settings = { ...(page.settings || {}), presentationMode: "full", fullWidth: true };
  page.content = [
    { type: "paragraph", content: [{ type: "text", text: "VIBE CODING · WIKI", styles: { textColor: "purple" } }] },
    { type: "heading", props: { level: 1 }, content: "Mendax 的 Vibe Coding Wiki" },
    { type: "paragraph", content: "关于工具、实践与项目的个人首页。让信息保持轻量、清晰，也保留足够的视觉节奏。" },
    { type: "image", props: { url: "/notion-golden-cover.svg", caption: "Vibe Coding" } },

    columns([56, 44], [
      [{ type: "callout", props: { icon: "✦", tone: "gray" }, content: "从这里开始", children: [{ type: "paragraph", content: "精选入口与最近更新。" }] }],
      [{ type: "callout", props: { icon: "☕", tone: "brown" }, content: "维护这个空间", children: [{ type: "paragraph", content: "保持内容短、链接清楚。" }, { type: "paragraph", content: "每周做一次整理。" }] }],
    ]),

    { type: "heading", props: { level: 2 }, content: "精选入口" },
    columns([33.33, 32.67, 34], [
      [{ type: "editorialCard", props: { eyebrow: "工具 · 8 min", title: "Vibe Coding 工具箱", excerpt: "我最常用的编辑器、模型和自动化组合。", imageUrl: "/notion-golden-cover.svg", pageId: "alpha-page", layout: "card" } }],
      [{ type: "editorialCard", props: { eyebrow: "实践 · 12 min", title: "从想法到交付", excerpt: "把模糊需求变成可以验证的产品循环。", imageUrl: "", pageId: "beta-page", layout: "card" } }],
      [{ type: "editorialCard", props: { eyebrow: "项目 · 6 min", title: "正在做什么", excerpt: "当前项目、进度和下一步。", imageUrl: "", pageId: "gamma-page", layout: "card" } }],
    ]),

    { type: "divider" },
    { type: "heading", props: { level: 2 }, content: "最近更新" },
    columns([50, 50], [
      [{ type: "editorialCard", props: { eyebrow: "2026 · NOTE", title: "模型协作笔记", excerpt: "多模型工作流的取舍与约束。", imageUrl: "", pageId: "", layout: "media-left" } }],
      [{ type: "quote", content: "做更少的界面，给内容更多空间。" }],
    ]),

    { type: "heading", props: { level: 2 }, content: "当前 / 进行中" },
    columns([54, 46], [
      [{ type: "editorialSection", props: { sourceId: "projects", layout: "cards-2", filterJson: JSON.stringify({ kind: "condition", propertyId: "status", operator: "equals", value: "doing" }), sortsJson: JSON.stringify([{ propertyId: "amount", direction: "desc" }]), limit: 2, titlePropertyId: "title", eyebrowPropertyId: "status", excerptPropertyId: "notes", imagePropertyId: "" } }],
      [{ type: "callout", props: { icon: "→", tone: "gray" }, content: "一个公开主页不需要解释一切。", children: [{ type: "paragraph", content: "优先显示入口、状态和最近更新。" }] }],
    ]),

    { type: "heading", props: { level: 2 }, content: "分类浏览" },
    columns([33, 33, 34], [
      [{ type: "pageLink", props: { pageId: "alpha-page", label: "工具与配置" } }],
      [{ type: "pageLink", props: { pageId: "beta-page", label: "实践与方法" } }],
      [{ type: "pageLink", props: { pageId: "gamma-page", label: "项目与复盘" } }],
    ]),

    columns([24, 76], [
      [{ type: "callout", props: { icon: "i", tone: "brown" }, content: "About", children: [{ type: "paragraph", content: "个人知识地图。" }] }],
      [{ type: "paragraph", content: "这个页面是用于回归的 Golden Page：它覆盖关键栏宽、图片、链接、引用、Callout、分隔线、彩色 meta 与动态内容段。" }],
    ]),
    { type: "paragraph", content: "" },
  ];
  return workspace;
}
