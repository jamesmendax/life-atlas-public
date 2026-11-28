export const SLASH_GROUP_ORDER = ["基本区块", "媒体", "数据库", "高级区块", "行内"];

const entry = (id, group, title, subtext, aliases, target) => ({ id, group, title, subtext, aliases, ...target });

export const SLASH_MENU_CATALOG = [
  entry("text", "基本区块", "文本", "从纯文本开始撰写", ["text", "p", "paragraph", "wb", "段落"], { defaultKey: "paragraph" }),
  entry("page", "基本区块", "页面", "在此页面中嵌入子页面", ["page", "ym", "子页面", "link page"], { action: "subPage" }),
  entry("todo", "基本区块", "待办事项", "使用待办清单追踪任务", ["todo", "checkbox", "dbsx", "待办", "复选框", "清单"], { defaultKey: "check_list" }),
  entry("h1", "基本区块", "标题 1", "大型版块标题", ["h1", "#", "bt1", "heading 1", "一级标题"], { defaultKey: "heading" }),
  entry("h2", "基本区块", "标题 2", "中型版块标题", ["h2", "##", "bt2", "heading 2", "二级标题"], { defaultKey: "heading_2" }),
  entry("h3", "基本区块", "标题 3", "小型版块标题", ["h3", "###", "bt3", "heading 3", "三级标题"], { defaultKey: "heading_3" }),
  entry("h4", "基本区块", "标题 4", "较小的版块标题", ["h4", "####", "bt4", "heading 4", "四级标题"], { defaultKey: "heading_4" }),
  entry("table", "基本区块", "表格", "将简易的内容表格添加到你的页面", ["table", "bg", "简易表格"], { defaultKey: "table" }),
  entry("bullet", "基本区块", "项目符号列表", "创建简单的项目符号列表", ["bullet", "ul", "xmfh", "无序列表"], { defaultKey: "bullet_list" }),
  entry("numbered", "基本区块", "有序列表", "创建带序号的列表", ["numbered", "ol", "yxlb", "编号列表"], { defaultKey: "numbered_list" }),
  entry("toggle", "基本区块", "折叠列表", "折叠列表可以隐藏或显示内部内容", ["toggle", "zdlb", "折叠", "展开"], { defaultKey: "toggle_list" }),
  entry("quote", "基本区块", "引用", "摘取引用", ["quote", "yy"], { defaultKey: "quote" }),
  entry("divider", "基本区块", "分隔线", "在视觉上分隔区块", ["divider", "hr", "fgx", "---"], { defaultKey: "divider" }),
  entry("link-to-page", "基本区块", "链接到页面", "链接到现有页面", ["link to page", "ljdym", "页面链接"], { action: "linkToPage" }),
  entry("callout", "基本区块", "标注", "醒目显示文字", ["callout", "Callout", "bz", "提示"], { action: "callout" }),
  entry("th1", "基本区块", "折叠标题 1", "将内容隐藏在大标题内", ["th1", "zdbt1", "toggle heading 1"], { defaultKey: "toggle_heading" }),
  entry("th2", "基本区块", "折叠标题 2", "将内容隐藏在中等标题内", ["th2", "zdbt2", "toggle heading 2"], { defaultKey: "toggle_heading_2" }),
  entry("th3", "基本区块", "折叠标题 3", "将内容隐藏在小标题内", ["th3", "zdbt3", "toggle heading 3"], { defaultKey: "toggle_heading_3" }),
  entry("th4", "基本区块", "折叠标题 4", "将内容隐藏在较小的标题内", ["th4", "zdbt4", "toggle heading 4"], { action: "toggleHeading4" }),

  entry("image", "媒体", "图片", "上传本地图片", ["image", "img", "tp", "图像", "照片"], { defaultKey: "image" }),
  entry("video", "媒体", "视频", "上传本地视频", ["video", "sp"], { defaultKey: "video" }),
  entry("audio", "媒体", "音频", "上传本地音频", ["audio", "yp", "声音", "音乐"], { defaultKey: "audio" }),
  entry("file", "媒体", "文件", "上传文件附件", ["file", "wj", "附件"], { defaultKey: "file" }),
  entry("pdf", "媒体", "PDF", "添加本地 PDF 附件", ["pdf", "文档"], { action: "pdf" }),
  entry("code", "媒体", "代码", "获取代码段", ["code", "dm", "代码块", "pre"], { defaultKey: "code_block" }),

  entry("view-table", "数据库", "表格视图", "新建独立的表格数据库", ["table view", "bgst"], { action: "view:table" }),
  entry("view-board", "数据库", "看板视图", "创建看板数据库视图", ["board", "board view", "kanban", "kbst"], { action: "view:board" }),
  entry("view-gallery", "数据库", "画廊视图", "创建画廊数据库视图", ["gallery", "gallery view", "hlst"], { action: "view:gallery" }),
  entry("view-list", "数据库", "列表视图", "创建列表数据库视图", ["list view", "lbst"], { action: "view:list" }),
  entry("view-calendar", "数据库", "日历视图", "创建日历数据库视图", ["calendar", "calendar view", "rlst"], { action: "view:calendar" }),
  entry("view-timeline", "数据库", "时间轴视图", "创建时间轴数据库视图", ["timeline", "timeline view", "gantt", "sjzst"], { action: "view:timeline" }),
  entry("view-roadmap", "数据库", "时间脉络", "像幻灯片一样按时间展示里程碑和阶段", ["roadmap", "sjml", "里程碑"], { action: "view:roadmap" }),
  entry("view-map", "数据库", "地图视图", "创建地图数据库视图", ["map", "map view", "dtst"], { action: "view:map" }),
  entry("view-chart", "数据库", "图表", "分组、聚合并可视化数据", ["chart", "bar", "line", "donut", "tb"], { action: "view:chart" }),
  entry("view-form", "数据库", "表单", "用表单新增数据库记录", ["form", "bd"], { action: "view:form" }),
  entry("view-dashboard", "数据库", "管理面板视图", "创建管理面板数据库视图", ["dashboard", "Dashboard", "仪表盘", "glmbst"], { action: "view:dashboard" }),
  entry("view-feed", "数据库", "动态视图", "连续阅读数据库页面和评论", ["feed", "动态", "dongtai"], { action: "view:feed" }),
  entry("database-inline", "数据库", "数据库 - 行内", "将新的行内数据库添加到此页面", ["database", "db", "数据库 - Inline", "sjkhn"], { action: "inlineDatabase" }),
  entry("database-full", "数据库", "数据库 - 整页", "将新数据库添加为子页面", ["full page database", "db", "数据库 - Full page", "整页数据库", "sjkzy"], { action: "fullPageDatabase" }),
  entry("linked-view", "数据库", "数据源的链接视图", "将现有数据源的视图添加到此页面", ["linked view", "Linked View", "linked database", "关联视图", "sjyljst"], { action: "linkedView" }),

  entry("action-button", "高级区块", "按钮", "点击后在页面末尾追加打卡文字", ["button", "action", "anniu", "an", "check-in", "打卡"], { action: "actionButton" }),
  entry("toc", "高级区块", "目录", "显示页面大纲", ["toc", "table of contents", "ml", "大纲"], { action: "toc" }),
  entry("equation", "高级区块", "公式区块", "显示独立的数学公式", ["math", "latex", "equation", "$$", "gsqk", "块公式", "公式"], { action: "equation" }),
  entry("breadcrumb", "高级区块", "路径栏", "显示当前页面的位置", ["breadcrumb", "ljl", "面包屑", "路径"], { action: "breadcrumb" }),
  entry("synced", "高级区块", "同步区块", "跨页面同步内容", ["synced", "tbqk", "同步"], { action: "syncedBlock" }),
  entry("tabs", "高级区块", "选项卡", "在选项卡中整理内容", ["tabs", "Tabs", "xxk", "标签页"], { action: "tabs" }),
  ...[2, 3, 4, 5].map((count) => entry(`columns-${count}`, "高级区块", `${count} 列`, `创建 ${count} 列区块`, [`col${count}`, `${count} columns`, `${count}l`, "分栏", "columns"], { action: `columns:${count}` })),
  entry("editorial-card", "高级区块", "Editorial Card", "图片、标签、标题与摘要的编辑卡片", ["editorial", "card", "内容卡片"], { action: "editorialCard" }),
  entry("editorial-3-cards", "高级区块", "Editorial 3 Cards", "三栏出版卡片布局", ["editorial grid", "三栏卡片"], { action: "editorial3Cards" }),
  entry("editorial-media-text", "高级区块", "Editorial Media / Text", "媒体左置、文字右置卡片", ["media text", "图文"], { action: "editorialMediaText" }),
  entry("editorial-section", "高级区块", "Editorial Section", "绑定数据源并按筛选、排序、数量渲染出版卡片", ["dynamic editorial", "动态首页", "精选内容"], { action: "editorialSection" }),

  entry("mention", "行内", "提及", "提及人员、页面或日期", ["@", "mention", "tj", "提及人员", "提及页面", "日期", "提醒", "person", "date", "reminder"], { action: "openMentionMenu" }),
  entry("inline-equation", "行内", "行内公式", "在文字中插入数学公式", ["inline math", "inline equation", "hngs", "$"], { action: "inlineEquation" }),
  entry("emoji", "行内", "表情", "插入表情符号", ["emoji", "bq", "表情符号", ":"], { defaultKey: "emoji" }),
];

export const SLASH_MARKDOWN_HINTS = {
  todo: "[]", h1: "#", h2: "##", h3: "###", h4: "####",
  bullet: "-", numbered: "1.", quote: ">", divider: "---", code: "```",
};

const SLASH_GROUP_KEYS = {
  "基本区块": "basic",
  "媒体": "media",
  "数据库": "database",
  "高级区块": "advanced",
  "行内": "inline",
};

export function getSlashGroupOrder(t) {
  if (!t) return SLASH_GROUP_ORDER;
  return ["basic", "media", "database", "advanced", "inline"].map((key) => t(`slash.group.${key}`));
}

export function getSlashMenuCatalog(t) {
  if (!t) return SLASH_MENU_CATALOG;
  return SLASH_MENU_CATALOG.map((item) => {
    const baseId = item.id.startsWith("columns-") ? "columns" : item.id;
    const params = item.id.startsWith("columns-") ? { count: item.id.split("-")[1] } : undefined;
    const title = t(`slash.${baseId}.title`, params);
    const subtext = t(`slash.${baseId}.sub`, params);
    const group = t(`slash.group.${SLASH_GROUP_KEYS[item.group] || "basic"}`);
    return {
      ...item,
      group,
      title,
      subtext,
      aliases: [...new Set([...item.aliases, item.title, title])],
    };
  });
}
