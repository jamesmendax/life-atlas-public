import { softwareDevRoadmap } from "./builtin/softwareDevRoadmap.js";

export const BUILTIN_TEMPLATES = [softwareDevRoadmap];

export function getBuiltinTemplate(id) {
  return BUILTIN_TEMPLATES.find((template) => template.id === id) || null;
}
