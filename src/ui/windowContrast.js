import { applyContrast, watchSystemContrast } from "./theme.js";

export function attachWindowContrast(api, root = document.documentElement) {
  let preference = "system", active = true;
  const apply = () => { if (active) applyContrast(preference, root); };
  const receive = (value) => {
    if (["system", "standard", "high"].includes(value?.preference)) { preference = value.preference; apply(); }
  };
  apply();
  const stopSystem = watchSystemContrast(apply);
  const stopRemote = api?.onContrastPreferenceChanged?.(receive);
  void api?.getContrastPreference?.().then((result) => { if (result.ok) receive(result.value); }).catch(() => {});
  return () => { active = false; stopSystem(); stopRemote?.(); };
}
