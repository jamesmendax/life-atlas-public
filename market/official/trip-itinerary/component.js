(() => {
  const modes = ["drive", "transit", "bike", "walk"];
  const labels = { drive: "驾车", transit: "轨交", bike: "骑行", walk: "步行" };
  globalThis.handleComponentEvent = ({ state = {}, event = {} }) => {
    let mode = modes.includes(state.mode) ? state.mode : "drive";
    if (event.type === "click" && event.id === "cycle-mode") {
      mode = modes[(modes.indexOf(mode) + 1) % modes.length];
    }
    return {
      state: { ...state, mode },
      view: [
        { type: "text", text: "旅行日程时间轴与登机牌" },
        { type: "text", text: `当前出行方式：${labels[mode]}` },
        { type: "button", id: "cycle-mode", label: "切换出行方式" },
      ],
    };
  };
})();
