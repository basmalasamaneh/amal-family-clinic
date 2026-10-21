// Supported semantic usages, NOT every pigment against every other pigment.
// Read-only: unlike the existing contrast-report.mjs this never rewrites reports.
import { readFileSync } from 'node:fs';

const tokens = JSON.parse(readFileSync(new URL('../lib/amal-ui/tokens.json', import.meta.url), 'utf8'));
const surfaces = ['bg', 'surface', 'surface-2'];
const basePairs = [
  ...['text', 'muted', 'navy', 'primary-text', 'danger-strong'].flatMap(fg => surfaces.map(bg => [fg, bg, 4.5])),
  ['primary-text', 'primary-soft', 4.5],
  ...['primary', 'primary-strong', 'primary-pressed'].map(bg => ['on-primary', bg, 4.5]),
  ...['danger', 'danger-strong'].map(bg => ['on-danger', bg, 4.5]),
  ['disabled-fg', 'disabled-bg', 4.5], ['toast-fg', 'toast-bg', 4.5],
  ['toast-accent', 'toast-bg', 4.5],
  ...surfaces.map(bg => ['focus-ring', bg, 3]),
];
function luminance(hex) {
  if (!/^#[\da-f]{6}$/i.test(hex)) throw new Error(`Expected opaque six-digit canonical token, received ${hex}`);
  const channels = hex.slice(1).match(/../g).map(x => parseInt(x, 16) / 255)
    .map(x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
let failures = 0;
for (const mode of ['light', 'dark']) {
  const theme = tokens.color[mode];
  const colors = { ...theme.raw, ...theme.semantic };
  const get = key => {
    if (!colors[key]) throw new Error(`Missing ${mode} supported semantic token: ${key}`);
    return colors[key].$value;
  };
  const pairs = [...basePairs];
  // All status/consent/alert/avatar/accent text pairs added to the canonical
  // semantic dictionary are automatically covered, including future variants.
  for (const key of Object.keys(colors).filter(key => key.endsWith('-fg'))) {
    const bg = `${key.slice(0, -3)}-bg`;
    pairs.push([key, bg, 4.5]);
  }
  // Section accents are ONLY icon chips/small highlights (non-text: 3:1).
  // Accept the two conventional tint suffixes, but never silently omit a chip.
  for (const key of Object.keys(colors).filter(key => /^(?:accent|section)-(?:reception|patients|network|admin)$/.test(key))) {
    const bg = [`${key}-soft`, `${key}-bg`].find(bg => colors[bg]);
    if (!bg) throw new Error(`Missing ${mode} tint companion for ${key}`);
    pairs.push([key, bg, 3]);
  }
  const unique = new Map(pairs.map(pair => [`${pair[0]}/${pair[1]}`, pair]));
  for (const [fg, bg, minimum] of unique.values()) {
    const values = [luminance(get(fg)), luminance(get(bg))].sort((a, b) => b - a);
    const contrast = (values[0] + 0.05) / (values[1] + 0.05);
    const pass = contrast >= minimum;
    console.log(`${pass ? 'PASS' : 'FAIL'} ${mode} ${fg}/${bg}: ${contrast.toFixed(3)} >= ${minimum}`);
    if (!pass) failures++;
  }
  console.log(`${mode}: ${unique.size} supported text and UI pairs checked.`);
}
if (failures) process.exitCode = 1;
