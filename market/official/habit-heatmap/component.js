(() => {
  globalThis.handleComponentEvent = ({ state = {}, event = {}, now }) => {
    const count = Number.isFinite(state.todayCount) ? state.todayCount : 0;
    const nextCount = event.type === "click" && event.id === "checkin" ? count + 1
      : event.type === "click" && event.id === "undo" ? Math.max(0, count - 1) : count;
    return {
      state: { ...state, todayCount: nextCount, updatedAt: now },
      view: [
        { type: "text", text: "习惯打卡热力日历图" },
        { type: "text", text: `今日打卡 ${nextCount} / 3 次` },
        { type: "progress", label: "今日目标进度", value: Math.min(1, nextCount / 3) },
        { type: "button", id: "checkin", label: "+ 今日打卡" },
        { type: "button", id: "undo", label: "撤销", disabled: nextCount === 0 },
      ],
    };
  };
})();
