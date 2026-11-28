export const SHORTCUTS = [
  { id: "search", group: "导航", keys: "Ctrl+K", description: "搜索", verify: "按下后出现搜索对话框" },
  { id: "open-page-tab", group: "导航", keys: "Ctrl+T", description: "打开页面标签", verify: "打开页面搜索，选择页面后显示标签" },
  { id: "switch-page-tab", group: "导航", keys: "Ctrl+Tab / Ctrl+Shift+Tab", description: "切换页面标签", verify: "切换到相邻的已打开页面" },
  { id: "close-page-tab", group: "导航", keys: "Ctrl+W", description: "关闭当前页面标签", verify: "关闭当前标签，关闭最后一个标签时回到首页" },
  { id: "settings", group: "导航", keys: "Ctrl+,", description: "打开设置", verify: "按下后出现设置对话框" },
  { id: "assistant", group: "导航", keys: "Ctrl+J", description: "打开 AI 助手", verify: "打开与当前页面关联的对话输入框" },
  { id: "quick-capture", group: "导航", keys: "Ctrl+Shift+N", description: "快速记录", verify: "按下后出现快速记录框" },
  { id: "back", group: "导航", keys: "Alt+←", description: "后退", verify: "依次打开两个页面后按下，回到第一个页面" },
  { id: "forward", group: "导航", keys: "Alt+→", description: "前进", verify: "后退之后按下，回到第二个页面" },
  { id: "toggle-sidebar", group: "导航", keys: "Ctrl+\\", description: "折叠或展开侧栏", verify: "按下后侧栏折叠，再按一次展开" },
  { id: "shortcuts", group: "导航", keys: "Ctrl+/", description: "快捷键面板", verify: "按下后出现快捷键面板" },
  { id: "find", group: "页面", keys: "Ctrl+F", description: "页内查找", verify: "按下后出现查找条" },
  { id: "undo", group: "编辑", keys: "Ctrl+Z", description: "撤销", verify: "输入文字后按下，文字消失" },
  { id: "redo", group: "编辑", keys: "Ctrl+Shift+Z", description: "重做", verify: "撤销之后按下，文字恢复" },
  { id: "bold", group: "编辑", keys: "Ctrl+B", description: "粗体", verify: "选中文字后按下，文字变为粗体" },
  { id: "italic", group: "编辑", keys: "Ctrl+I", description: "斜体", verify: "选中文字后按下，文字变为斜体" },
  { id: "underline", group: "编辑", keys: "Ctrl+U", description: "下划线", verify: "选中文字后按下，文字带下划线" },
  { id: "duplicate", group: "编辑", keys: "Ctrl+D", description: "复制当前区块", verify: "按下后当前区块下方出现一份副本" },
  { id: "block-menu", group: "编辑", keys: "Shift+F10", description: "打开当前区块菜单", verify: "光标在区块中时出现包含“转换为”的菜单" },
  { id: "convert-text", group: "编辑", keys: "Ctrl+Alt+0", description: "转换为文本", verify: "保留内容与子块，当前区块变为文本" },
  { id: "convert-headings", group: "编辑", keys: "Ctrl+Alt+1/2/3", description: "转换为标题 1/2/3", verify: "当前已有内容变为对应层级标题，可一次撤销" },
  { id: "convert-check", group: "编辑", keys: "Ctrl+Alt+4", description: "转换为待办列表", verify: "保留内容，出现复选框" },
  { id: "convert-lists", group: "编辑", keys: "Ctrl+Alt+5/6/7", description: "转换为项目/编号/折叠列表", verify: "原内容与子块仍在，列表类型变更" },
  { id: "convert-code", group: "编辑", keys: "Ctrl+Alt+8", description: "转换为代码", verify: "纯文本转换为代码；无法保留的格式会明确提示" },
  { id: "convert-quote", group: "编辑", keys: "Ctrl+Alt+9", description: "转换为引用", verify: "当前已有内容变为引用，可一次撤销" },
  { id: "slash", group: "插入", keys: "/", description: "斜杠菜单", verify: "在空行输入后出现斜杠菜单" },
  { id: "mention", group: "插入", keys: "@", description: "提及人员、页面或日期", verify: "输入后出现提及菜单" },
  { id: "page-link", group: "插入", keys: "[[", description: "链接页面", verify: "输入后出现页面菜单" },
  { id: "plus", group: "插入", keys: "+", description: "在空行开头新建或链接页面", verify: "在空行开头输入后出现页面菜单" },
  { id: "emoji", group: "插入", keys: ":", description: "表情（再输入至少两个字母）", verify: "输入 :sm 后出现表情网格" },
];

const SHORTCUT_GROUP_KEYS = {
  "导航": "nav",
  "页面": "page",
  "编辑": "edit",
  "插入": "insert",
};

export function getShortcuts(t) {
  return SHORTCUTS.map((shortcut) => {
    const groupKey = SHORTCUT_GROUP_KEYS[shortcut.group] || "nav";
    return {
      ...shortcut,
      groupKey,
      group: t ? t(`shortcut.group.${groupKey}`) : shortcut.group,
      description: t ? t(`shortcut.${shortcut.id}`) : shortcut.description,
    };
  });
}
