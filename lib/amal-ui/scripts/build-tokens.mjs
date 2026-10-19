// Generates src/styles/tokens.css from the canonical tokens.json (DTCG).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const t = JSON.parse(readFileSync(resolve(root, 'tokens.json'), 'utf8'));

const modeVars = (m) =>
  [...Object.entries(m.raw), ...Object.entries(m.semantic)]
    .map(([k, v]) => `  --amal-${k}: ${v.$value};${k in m.raw ? `\n  --${k}: var(--amal-${k});` : ''}`)
    .join('\n');

const ty = t.typography;
const shared = [
  `  --amal-gold: ${t.color.brand.gold.$value};`,
  `  --brand-gold: var(--amal-gold);`,
  `  --amal-font-sans: ${ty.fontFamily.sans.$value.map((f) => (f.includes(' ') ? `'${f}'` : f)).join(', ')};`,
  ...Object.entries(ty.fontSize).map(([k, v]) => `  --amal-text-${k}: ${v.$value};`),
  `  --amal-text-body: ${ty.bodySize.$value};`,
  `  --amal-text-reception: ${ty.receptionSize.$value};`,
  `  --amal-leading: ${ty.lineHeight.$value};`,
  ...Object.entries(ty.fontWeight).map(([k, v]) => `  --amal-weight-${k}: ${v.$value};`),
  ...Object.entries(t.radius).map(([k, v]) => `  --amal-radius-${k}: ${v.$value};`),
  ...Object.entries(t.spacing).map(([k, v]) => `  --amal-space-${k}: ${v.$value};`),
  ...Object.entries(t.motion.duration).map(([k, v]) => `  --amal-duration-${k}: ${v.$value};`),
].join('\n');

const css = `/* GENERATED from tokens.json by scripts/build-tokens.mjs — do not edit by hand. */
:root {
${shared}
}

:root,
[data-theme='light'] {
  color-scheme: light;
${modeVars(t.color.light)}
}

[data-theme='dark'],
.dark {
  color-scheme: dark;
${modeVars(t.color.dark)}
}
`;
writeFileSync(resolve(root, 'src/styles/tokens.css'), css);
console.log('wrote src/styles/tokens.css');
