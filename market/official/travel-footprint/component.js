(() => {
  globalThis.handleComponentEvent = ({ state = {}, event = {} }) => {
    const records = state.records && typeof state.records === "object" ? { ...state.records } : {};
    const keys = Object.keys(records);
    const visited = keys.filter((k) => records[k]?.status === "visited").length;
    if (event.type === "click" && event.id === "light-chengdu") {
      records["cn-510100"] = { status: "visited", note: "成都打卡", spots: ["宽窄巷子"] };
    }
    const nextVisited = Object.keys(records).filter((k) => records[k]?.status === "visited").length;
    return {
      state: { ...state, mapMode: state.mapMode || "china", palette: state.palette || "sunset", records },
      view: [
        { type: "text", text: "交互式足迹点亮地图" },
        { type: "text", text: `已点亮 ${nextVisited} 处足迹` },
        { type: "progress", label: "中国 34 省探索进度", value: Math.min(1, nextVisited / 34) },
        { type: "button", id: "light-chengdu", label: "点亮成都足迹" },
      ],
    };
  };
})();
