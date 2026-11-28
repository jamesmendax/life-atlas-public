import { lazy, Suspense, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import IconChevronLeft from "@tabler/icons-react/dist/esm/icons/IconChevronLeft.mjs";
import IconChevronRight from "@tabler/icons-react/dist/esm/icons/IconChevronRight.mjs";
import IconX from "@tabler/icons-react/dist/esm/icons/IconX.mjs";
import { isComposingKeyboardEvent } from "../ui/keyboard.js";
import { useModalFocus } from "../ui/Dialog.jsx";
import { AppearanceGlyph } from "./AppearanceGlyph.jsx";
import { createPresentationSlides, snapshotPresentationSources } from "./pagePresentationModel.js";
import { useI18n } from "../i18n/workspaceRuntime.js";
import "./pagePresentation.css";

const PageEditor = lazy(() => import("../editor/PageEditor.jsx").then((module) => ({ default: module.PageEditor })));

export function PagePresentation({ page, databaseRuntime, onClose, restoreFocusRef }) {
  const { t } = useI18n();
  const [presentation] = useState(() => ({
    title: page.title || t("backlinks.untitled"),
    icon: page.icon,
    iconColor: page.iconColor,
    slides: createPresentationSlides(page.content),
    runtime: {
      workspace: databaseRuntime?.workspace,
      platform: databaseRuntime?.platform,
      resolveEditorAttachmentUrl: databaseRuntime?.resolveEditorAttachmentUrl,
      attachmentUrl: databaseRuntime?.attachmentUrl,
      breadcrumb: databaseRuntime?.breadcrumb,
      syncedStore: snapshotPresentationSources(page.content, databaseRuntime?.syncedStore),
      pageId: page.id,
      locked: true,
      presentation: true,
    },
  }));
  const [index, setIndex] = useState(0);
  const dialogRef = useRef(null);
  const viewportRef = useRef(null);
  const titleId = useId();
  useModalFocus(dialogRef, { initialFocusRef: dialogRef, restoreFocusRef, onClose });
  const last = presentation.slides.length;
  const go = (position) => {
    const next = Math.min(last, Math.max(0, position));
    if (next !== index) {
      setIndex(next);
      viewportRef.current?.scrollTo({ top: 0, left: 0, behavior: "instant" });
      dialogRef.current?.focus({ preventScroll: true });
    }
  };
  const handleKey = (event) => {
    if (isComposingKeyboardEvent(event) || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.target.closest?.('input, textarea, select, audio, video, [role="tablist"]')) return;
    const next = { ArrowLeft: index - 1, PageUp: index - 1, ArrowRight: index + 1, PageDown: index + 1, Home: 0, End: last }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    go(next);
  };
  const handleToggle = (event) => {
    const button = event.target.closest?.(".bn-toggle-button");
    const wrapper = button?.closest(".bn-toggle-wrapper");
    if (!wrapper) return;
    // BlockNote's default toggle writes into localStorage. The slide owns this
    // DOM, so updating it here keeps the source and future sessions separate.
    event.preventDefault();
    event.stopPropagation();
    const open = wrapper.dataset.showChildren !== "true";
    wrapper.dataset.showChildren = String(open);
    button.setAttribute("aria-expanded", String(open));
  };

  return createPortal(
    <section className="page-presentation" ref={dialogRef} role="dialog" aria-modal="true"
      aria-labelledby={titleId} data-la-dialog="page-presentation" tabIndex={-1}
      onKeyDownCapture={handleKey} onClickCapture={handleToggle}>
      <header className="page-presentation-header">
        <span id={titleId}>{t("actions.present")}</span>
        <button type="button" aria-label={t("present.exitAria")} title={t("present.exitTitle")} onClick={onClose}><IconX size={21} stroke={1.7} /></button>
      </header>
      <div ref={viewportRef} className="page-presentation-viewport">
        {index === 0
          ? <div className="page-presentation-title">
            <AppearanceGlyph icon={presentation.icon} color={presentation.iconColor} />
            <h1>{presentation.title}</h1>
          </div>
          : <div className="page-presentation-slide" key={index}>
            <Suspense fallback={<p role="status">{t("present.loadingSlide")}</p>}>
              <PageEditor pageId={page.id} initialContent={presentation.slides[index - 1]}
                locked presentation databaseRuntime={presentation.runtime} />
            </Suspense>
          </div>}
      </div>
      <footer className="page-presentation-controls" aria-label={t("present.navAria")}>
        <button type="button" aria-label={t("present.prevAria")} title={t("present.prevTitle")} disabled={index === 0} onClick={() => go(index - 1)}>
          <IconChevronLeft size={21} stroke={1.7} />
        </button>
        <output aria-live="polite" aria-label={t("present.pageAria")}>{index + 1} / {last + 1}</output>
        <button type="button" aria-label={t("present.nextAria")} title={t("present.nextTitle")} disabled={index === last} onClick={() => go(index + 1)}>
          <IconChevronRight size={21} stroke={1.7} />
        </button>
      </footer>
    </section>,
    document.body,
  );
}
