export function passwordRules(password) {
  const normalized = password.normalize("NFKC");
  const characters = [...normalized];
  let pattern = false;
  if (normalized) {
    const lower = normalized.toLowerCase();
    for (const sequence of ["0123456789", "abcdefghijklmnopqrstuvwxyz", "qwertyuiopasdfghjklzxcvbnm"]) {
      const repeats = Math.ceil(lower.length / sequence.length) + 1;
      if (sequence.repeat(repeats).includes(lower) || [...sequence].reverse().join("").repeat(repeats).includes(lower)) pattern = true;
    }
    const lowerCharacters = [...lower];
    for (let size = 1; size <= Math.floor(lowerCharacters.length / 2); size += 1) {
      if (lowerCharacters.length % size === 0 && lowerCharacters.slice(0, size).join("").repeat(lowerCharacters.length / size) === lower) pattern = true;
    }
  }
  let alphabetSize = 0;
  if (/[a-z]/.test(normalized)) alphabetSize += 26;
  if (/[A-Z]/.test(normalized)) alphabetSize += 26;
  if (/[0-9]/.test(normalized)) alphabetSize += 10;
  if (/[\x20-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]/.test(normalized)) alphabetSize += 33;
  if (/[^\x00-\x7f]/.test(normalized)) alphabetSize += 100;
  const bits = Number((characters.length * Math.log2(alphabetSize || 1)).toFixed(1));
  return { length: characters.length >= 12, distinct: new Set(characters).size >= 5, pattern: Boolean(normalized) && !pattern, bits, strength: bits < 60 ? "weak" : bits <= 80 ? "medium" : "strong" };
}
