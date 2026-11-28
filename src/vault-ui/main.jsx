import "@fontsource-variable/noto-sans-sc";
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./vault.css";
import "./contrast.css";
import { attachWindowContrast } from "../ui/windowContrast.js";
import { VaultI18nProvider } from "./i18n.js";

attachWindowContrast(window.lifeAtlasVault);

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <VaultI18nProvider bridge={window.lifeAtlasVault?.locale}>
      <App />
    </VaultI18nProvider>
  </React.StrictMode>,
);
