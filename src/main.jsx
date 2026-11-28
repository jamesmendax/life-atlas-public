import "./ui/theme-tokens.css";
import "katex/dist/katex.min.css";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { WorkspaceI18nProvider, useI18n } from "./i18n/workspaceRuntime.js";
import { DialogProvider } from "./ui/DialogProvider.jsx";
import { BackupDialog } from "./components/BackupDialog.jsx";
import { seedWorkspace } from "./domain/workspaceSeed.js";
import { createBrowserWorkspaceRepository } from "./persistence/workspaceRepository.js";
import { createDesktopWorkspaceRepository } from "./persistence/desktopWorkspaceRepository.js";
import { readDevicePreferences } from "./ui/devicePreferences.js";
import { applyContrast, applyTheme, resolveTheme, readCachedPreference, systemPrefersDark } from "./ui/theme.js";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import "./styles.css";
import "./ui/product-system.css";
import "@fontsource-variable/noto-sans-sc";
import "@fontsource-variable/noto-serif-sc";
import "./ui/themes/mobai/index.css";
import "./ui/themes/mobai/workspace-page-navigation.css";
import "./ui/themes/mobai/contrast.css";
import "./ui/themes/mobai/locale-fonts.css";

applyTheme(resolveTheme(readCachedPreference(), systemPrefersDark()));
applyContrast(readDevicePreferences().contrast);
const root = createRoot(document.getElementById("root"));

function StartupError({ error, onRetry }) {
  const { t } = useI18n();
  const [recovery, setRecovery] = useState(null);
  useEffect(() => { document.documentElement.dataset.laReady = "1"; return () => { delete document.documentElement.dataset.laReady; }; }, []);
  return <main className="mb-startup-error"><h1>{error.code === "E_CORRUPT" ? t("startup.corruptTitle") : t("startup.errorTitle")}</h1><p role="alert">{error.message}</p><p>{error.code === "E_CORRUPT" ? t("startup.corruptBody") : t("startup.errorBody")}</p><div><button type="button" className="mb-button mb-primary" onClick={onRetry}>{t("startup.retry")}</button>{window.lifeAtlas?.app?.openDataFolder && <button type="button" className="mb-button" onClick={() => window.lifeAtlas.app.openDataFolder()}>{t("startup.openDataFolder")}</button>}{window.lifeAtlas?.backup && <><button type="button" className="mb-button" onClick={() => setRecovery("backup")}>{t("startup.fromBackup")}</button><button type="button" className="mb-button" onClick={() => setRecovery("snapshots")}>{t("startup.fromSnapshot")}</button></>}</div>{recovery && <BackupDialog initialTab={recovery} recoveryMode onClose={() => setRecovery(null)} />}</main>;
}

async function start() {
  const localeBridge = window.lifeAtlas?.locale;
  try {
    const repository = window.lifeAtlas?.platform === "desktop" ? createDesktopWorkspaceRepository(window.lifeAtlas) : createBrowserWorkspaceRepository();
    const initialWorkspace = await repository.load(seedWorkspace);
    root.render(<React.StrictMode><WorkspaceI18nProvider bridge={localeBridge}><DialogProvider><App repository={repository} initialWorkspace={initialWorkspace} /></DialogProvider></WorkspaceI18nProvider></React.StrictMode>);
  } catch (error) {
    root.render(<WorkspaceI18nProvider bridge={localeBridge}><DialogProvider><StartupError error={error} onRetry={start} /></DialogProvider></WorkspaceI18nProvider>);
  }
}

void start();
