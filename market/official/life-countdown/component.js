(() => {
  globalThis.handleComponentEvent = ({ state = {}, now }) => {
    const dt = new Date(now || Date.now());
    const start = new Date(dt.getFullYear(), 0, 1).getTime();
    const end = new Date(dt.getFullYear() + 1, 0, 1).getTime();
    const ratio = Math.max(0, Math.min(1, (dt.getTime() - start) / (end - start)));
    return {
      state,
      view: [
        { type: "text", text: `${dt.getFullYear()} 年时光进度` },
        { type: "text", text: `${(ratio * 100).toFixed(1)}%` },
        { type: "progress", label: "年度进度", value: ratio },
      ],
    };
  };
})();
