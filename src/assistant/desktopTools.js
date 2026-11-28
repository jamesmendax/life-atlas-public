const sections = ["appearance", "workspace", "data", "backup", "assistant", "shortcuts", "about"];
const flag = (description) => ({ type: "boolean", description });
const integer = (description, minimum, maximum) => ({ type: "integer", description, minimum, maximum });

export const desktopToolCatalog = [
  ["open_settings", "打开设置", "Open one of the listed application settings panes.", {
    section: { type: "string", enum: sections },
  }, ["section"]],
  ["read_backup_settings", "读取备份计划", "Read the local weekly backup schedule when the user asks about backups. Returns timing and protection settings only.", {}, []],
  ["update_backup_schedule", "调整备份计划", "Change the timing, retention or enabled state of a workspace backup schedule. The native folder picker lets the user select the destination. Existing encryption is preserved.", {
    enabled: flag("Enable or disable the weekly schedule."),
    weekday: integer("Day of week, 0 Sunday to 6 Saturday.", 0, 6),
    hour: integer("Local hour, 0 to 23.", 0, 23),
    keep_last: integer("Number of scheduled backups to retain.", 1, 52),
    choose_folder: flag("Open the native folder picker when the user wants to choose a different destination."),
  }, []],
  ["create_workspace_snapshot", "创建工作区快照", "Save pending edits and take a local snapshot of the workspace database.", {}, []],
];
export const desktopToolNames = new Set(desktopToolCatalog.map(([name]) => name));

const failed = (error) => ({ ok: false, error });
const success = (message, fields = {}) => ({ ok: true, message, ...fields });
const unwrap = (result) => {
  if (!result?.ok) throw new Error("桌面操作未完成，请在应用中查看当前状态。");
  return result.value;
};
function publicSchedule(schedule) {
  return { enabled: schedule.enabled, weekday: schedule.weekday, hour: schedule.hour, keep_last: schedule.keepLast,
    has_folder: Boolean(schedule.folder), encrypted: schedule.encrypt };
}

const canceled = () => failed("操作已停止。");
export async function executeDesktopTool(name, args, { api, openPane, flushWorkspace, signal }) {
  if (!desktopToolNames.has(name)) return failed("未知桌面操作。");
  if (signal?.aborted) return canceled();
  if (!args || typeof args !== "object" || Array.isArray(args)) return failed("工具参数须为对象。");
  const [, , , properties, required] = desktopToolCatalog.find(([entry]) => entry === name);
  if (Object.keys(args).some((key) => !Object.hasOwn(properties, key)) || required.some((key) => !Object.hasOwn(args, key))) return failed("工具参数与此操作不符。");
  for (const [key, value] of Object.entries(args)) {
    const field = properties[key];
    if ((field.enum && !field.enum.includes(value)) || (field.type === "boolean" && typeof value !== "boolean")
      || (field.type === "integer" && (!Number.isInteger(value) || value < field.minimum || value > field.maximum))) return failed("设置值超出可选范围。");
  }
  try {
    if (name === "open_settings") {
      openPane(args.section);
      return success("已打开指定设置。");
    }
    if (!api?.backup) return failed("请在桌面版中使用备份与快照。");
    if (name === "create_workspace_snapshot") {
      const saved = await flushWorkspace();
      if (!saved?.ok) return failed("请先保存当前更改。");
      if (signal?.aborted) return canceled();
      unwrap(await api.backup.createWorkspaceSnapshot());
      return success("工作区快照已创建。");
    }
    const current = unwrap(await api.backup.getSchedule()).schedule;
    if (name === "read_backup_settings") return success("已读取定期备份计划。", { schedule: publicSchedule(current) });
    if (current.includeVault) return failed("请在应用的备份设置中管理这项受保护的计划。");
    if (signal?.aborted) return canceled();
    const patch = {
      ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
      ...(args.weekday !== undefined ? { weekday: args.weekday } : {}),
      ...(args.hour !== undefined ? { hour: args.hour } : {}),
      ...(args.keep_last !== undefined ? { keepLast: args.keep_last } : {}),
    };
    if (!args.choose_folder && !Object.keys(patch).length) return failed("请指定要更改的备份计划设置。");
    if (args.choose_folder || ((patch.enabled ?? current.enabled) && !current.folder)) {
      const picked = unwrap(await api.backup.chooseScheduleFolder());
      if (picked.cancelled || !picked.folder) return failed("已取消选择备份目录，计划未修改。");
      patch.folder = picked.folder;
    }
    if (signal?.aborted) return canceled();
    const saved = unwrap(await api.backup.updateWorkspaceSchedule(patch)).schedule;
    return success("已保存定期备份计划。", { schedule: publicSchedule(saved) });
  } catch {
    return failed("桌面操作未完成，请在对应的设置面板查看或重试。");
  }
}
