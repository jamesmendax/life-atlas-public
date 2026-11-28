import "@fontsource-variable/noto-sans-sc";
import React from "react";
import { createRoot } from "react-dom/client";
import { SetupApp } from "./SetupApp.jsx";
import "./setup.css";
import "./contrast.css";
import { attachWindowContrast } from "../ui/windowContrast.js";
import { I18nProvider, setupTranslator } from "../i18n/surfaces.js";

attachWindowContrast(window.lifeAtlasSetup);

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <I18nProvider bridge={window.lifeAtlasSetup?.locale} translator={setupTranslator}>
      <SetupApp />
    </I18nProvider>
  </React.StrictMode>,
);
