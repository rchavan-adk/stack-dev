interface Semver {
  major: number;
  minor: number;
  patch: number;
}

export function parseSemver(value: string): Semver | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/**
 * Templates are immutable: saving bumps the patch and skips versions that
 * already exist in history (`@@unique([kind, version])`).
 */
export function nextPatchVersion(current: string, taken: string[]): string | null {
  const parsed = parseSemver(current);
  if (!parsed) return null;
  const used = new Set(taken);
  for (let patch = parsed.patch + 1; patch <= parsed.patch + 100; patch += 1) {
    const candidate = `${parsed.major}.${parsed.minor}.${patch}`;
    if (!used.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Harness drafts move by minor version (0.1.0 -> 0.2.0 -> ...), skipping
 * versions the pack already has, so cloning a row never collides.
 */
export function nextDraftVersion(source: string, taken: string[]): string {
  const used = new Set(taken);
  const parsed = parseSemver(source);
  if (!parsed) return "0.1.0";
  for (let minor = parsed.minor + 1; minor < parsed.minor + 100; minor += 1) {
    const candidate = `${parsed.major}.${minor}.0`;
    if (!used.has(candidate)) return candidate;
  }
  return `${parsed.major}.${parsed.minor + 100}.0`;
}
