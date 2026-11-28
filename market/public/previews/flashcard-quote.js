(() => {
  globalThis.handleComponentEvent = ({ state = {}, event = {} }) => {
    const flipped = event.type === "click" && event.id === "flip" ? !state.flipped : Boolean(state.flipped);
    return {
      state: { ...state, flipped },
      view: [
        { type: "text", text: "3D 间隔闪卡与每日金句" },
        { type: "text", text: flipped ? "背面：用最朴素的语言复述概念，卡壳处即盲区。" : "正面：什么是费曼学习法的核心？" },
        { type: "button", id: "flip", label: flipped ? "翻回正面" : "翻转查看背面" },
      ],
    };
  };
})();
