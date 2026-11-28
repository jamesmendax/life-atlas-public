(() => {
  const durations = { focus: 25 * 60_000, break: 5 * 60_000 };

  globalThis.handleComponentEvent = ({ state = {}, event = {}, now }) => {
    let phase = state.phase === "break" ? "break" : "focus";
    let remaining = Number.isFinite(state.remaining) ? Math.max(0, Math.min(state.remaining, durations[phase])) : durations[phase];
    let endsAt = Number.isFinite(state.endsAt) ? state.endsAt : null;

    if (endsAt !== null && endsAt <= now) {
      remaining = 0;
      endsAt = null;
    }

    if (event.type === "click") {
      if (event.id === "focus" || event.id === "break") {
        phase = event.id;
        remaining = durations[phase];
        endsAt = null;
      } else if (event.id === "reset") {
        remaining = durations[phase];
        endsAt = null;
      } else if (event.id === "toggle") {
        if (endsAt !== null) {
          remaining = Math.max(0, endsAt - now);
          endsAt = null;
        } else {
          if (remaining === 0) remaining = durations[phase];
          endsAt = now + remaining;
        }
      }
    }

    const visibleRemaining = endsAt === null ? remaining : Math.max(0, Math.min(endsAt - now, durations[phase]));
    const seconds = Math.ceil(visibleRemaining / 1_000);
    const clock = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    const label = phase === "focus" ? "专注" : "短休息";

    return {
      state: { phase, remaining, endsAt },
      view: [
        { type: "text", text: label },
        { type: "text", text: clock },
        { type: "progress", label: `${label}进度`, value: 1 - visibleRemaining / durations[phase] },
        { type: "button", id: "toggle", label: endsAt !== null ? "暂停" : remaining > 0 && remaining < durations[phase] ? "继续" : "开始" },
        { type: "button", id: "reset", label: "重置", disabled: endsAt === null && remaining === durations[phase] },
        { type: "button", id: phase === "focus" ? "break" : "focus", label: phase === "focus" ? "切换到短休息" : "切换到专注" },
        ...(remaining === 0 ? [{ type: "text", text: phase === "focus" ? "本轮专注完成，可以休息一下。" : "休息结束，可以开始下一轮。" }] : []),
      ],
    };
  };
})();
