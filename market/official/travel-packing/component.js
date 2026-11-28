(() => {
  globalThis.handleComponentEvent = ({ state = {}, event = {} }) => {
    const items = Array.isArray(state.items) && state.items.length ? state.items : [
      { id: "p1", group: "证件财务", name: "身份证 / 护照", weight: 50, done: true },
      { id: "p2", group: "数码充电", name: "充电宝 + 快充线", weight: 280, done: false },
    ];
    const next = event.type === "click" && event.id === "check-next"
      ? items.map((item, idx) => (idx === items.findIndex((x) => !x.done) ? { ...item, done: true } : item))
      : items;
    const done = next.filter((i) => i.done).length;
    return {
      state: { ...state, scene: state.scene || "city", items: next },
      view: [
        { type: "text", text: "旅行智能打包清单" },
        { type: "text", text: `已装入 ${done} / ${next.length} 件` },
        { type: "progress", label: "打包进度", value: next.length ? done / next.length : 0 },
        { type: "button", id: "check-next", label: "勾选下一项", disabled: done === next.length },
      ],
    };
  };
})();
