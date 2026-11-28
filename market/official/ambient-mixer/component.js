(() => {
  const presets = ["study", "forest", "cafe"];
  const names = { study: "雨夜书房", forest: "森林木屋", cafe: "午后咖啡" };
  globalThis.handleComponentEvent = ({ state = {}, event = {} }) => {
    let preset = presets.includes(state.preset) ? state.preset : "study";
    if (event.type === "click" && event.id === "next-preset") {
      preset = presets[(presets.indexOf(preset) + 1) % presets.length];
    }
    return {
      state: { ...state, preset },
      view: [
        { type: "text", text: "白噪音专注混音台" },
        { type: "text", text: `当前场景：${names[preset]}` },
        { type: "button", id: "next-preset", label: "切换场景预设" },
      ],
    };
  };
})();
