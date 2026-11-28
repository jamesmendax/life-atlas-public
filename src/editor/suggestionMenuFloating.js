import { offset, shift, size } from "@floating-ui/react";

const MAX_HEIGHT = 400;
const GAP = 10;
const decided = new WeakMap();

const decideOnce = {
  name: "lifeAtlasDecideOnce",
  fn({ placement, elements }) {
    const rect = elements.reference.getBoundingClientRect();
    const floating = elements.floating;
    if (!rect.width && !rect.height && !rect.x && !rect.y) {
      floating.dataset.laReady = "0";
      return {};
    }
    let side = decided.get(floating);
    if (!side) {
      const viewport = document.documentElement.clientHeight;
      const below = viewport - rect.bottom - GAP * 2;
      const above = rect.top - GAP * 2;
      side = below >= 240 || below >= above ? "bottom-start" : "top-start";
      decided.set(floating, side);
    }
    floating.dataset.laReady = "1";
    return placement === side ? {} : { reset: { placement: side } };
  },
};

export const SUGGESTION_MENU_FLOATING = {
  useFloatingOptions: {
    placement: "bottom-start",
    middleware: [
      offset(GAP),
      decideOnce,
      shift({ padding: GAP }),
      size({
        padding: GAP,
        apply({ availableHeight, elements }) {
          const ready = elements.floating.dataset.laReady === "1";
          elements.floating.style.maxHeight = `${ready ? Math.max(0, Math.min(MAX_HEIGHT, availableHeight)) : 0}px`;
          elements.floating.style.visibility = ready ? "" : "hidden";
        },
      }),
    ],
  },
};
