import { useRef } from "react";
import { createBacklinkIndex } from "../domain/backlinks.js";

export function useBacklinkIndex(workspace) {
  const index = useRef(null);
  const previous = useRef(null);
  if (!index.current) index.current = createBacklinkIndex();
  if (previous.current !== workspace) {
    index.current.update(previous.current, workspace);
    previous.current = workspace;
  }
  return index.current;
}

export default useBacklinkIndex;
