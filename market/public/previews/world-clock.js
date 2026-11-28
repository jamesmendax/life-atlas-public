(() => {
  globalThis.handleComponentEvent = ({ state = {}, now }) => {
    const dt = new Date(now || Date.now());
    const hh = String(dt.getHours()).padStart(2, "0");
    const mm = String(dt.getMinutes()).padStart(2, "0");
    return {
      state: { cities: Array.isArray(state.cities) && state.cities.length ? state.cities : ["Asia/Shanghai", "Asia/Tokyo", "Europe/London", "America/New_York"] },
      view: [
        { type: "text", text: "世界时钟与跨区换算" },
        { type: "text", text: `${hh}:${mm}` },
      ],
    };
  };
})();
