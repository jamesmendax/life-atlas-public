import { createContext } from "react";

// Kept separate from the schema so embedded editors and property controls can
// share workspace services without importing their parent editor component.
export const LifeAtlasEditorRuntimeContext = createContext(null);