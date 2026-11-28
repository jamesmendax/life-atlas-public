export function loadCommonPasswords(fileText) {
  return new Set(fileText.split(/\r?\n/).map((line) => line.trim().toLowerCase()).filter((line) => line && !line.startsWith("#")));
}

export function isCommonPassword(password, commonPasswords = new Set()) {
  const normalized = password.normalize("NFKC").toLowerCase();
  const core = normalized.replace(/^\P{L}+|\P{L}+$/gu, "");
  return commonPasswords.has(normalized) || (
    [...core].length >= 4 && [...core].length * 2 >= [...normalized].length && commonPasswords.has(core)
  );
}

export function isSimplePasswordPattern(password) {
  const normalized = password.normalize("NFKC").toLowerCase();
  const characters = [...normalized];
  if (!characters.length) return false;
  for (const sequence of ["0123456789", "abcdefghijklmnopqrstuvwxyz", "qwertyuiopasdfghjklzxcvbnm"]) {
    const repetitions = Math.ceil(normalized.length / sequence.length) + 1;
    if (sequence.repeat(repetitions).includes(normalized) || [...sequence].reverse().join("").repeat(repetitions).includes(normalized)) return true;
  }
  for (let width = 1; width <= Math.floor(characters.length / 2); width += 1) {
    if (characters.length % width === 0 && characters.slice(0, width).join("").repeat(characters.length / width) === normalized) return true;
  }
  return false;
}

export function checkMasterPassword(password, commonPasswords = new Set()) {
  const normalized = typeof password === "string" ? password.normalize("NFKC") : "";
  const characters = [...normalized];
  const failures = [];
  if (characters.length < 12) failures.push("length");
  if (new Set(characters).size < 5) failures.push("distinct");
  if (isCommonPassword(normalized, commonPasswords)) failures.push("common");
  if (isSimplePasswordPattern(normalized)) failures.push("pattern");
  let alphabetSize = 0;
  if (/[a-z]/.test(normalized)) alphabetSize += 26;
  if (/[A-Z]/.test(normalized)) alphabetSize += 26;
  if (/[0-9]/.test(normalized)) alphabetSize += 10;
  if (/[\x20-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]/.test(normalized)) alphabetSize += 33;
  if (/[^\x00-\x7f]/.test(normalized)) alphabetSize += 100;
  const bits = Number((characters.length * Math.log2(alphabetSize || 1)).toFixed(1));
  return { ok: failures.length === 0, failures, bits, strength: bits < 60 ? "weak" : bits <= 80 ? "medium" : "strong" };
}
