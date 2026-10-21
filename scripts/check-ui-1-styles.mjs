// Authored application + shared UI only. Canonical token output is the sole CSS
// exception. SVG artwork (including its unchanged inline brand renderer) is not UI
// styling. Build output, dependencies, test fixtures and the unrelated canvas/API
// are outside these two source roots; do not add blanket component exclusions.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const roots = ['artifacts/amal-network/src', 'lib/amal-ui/src'];
const exceptions = new Map([
  ['lib/amal-ui/src/styles/tokens.css', 'generated from canonical lib/amal-ui/tokens.json'],
  ['lib/amal-ui/src/components/Logo.tsx', 'unchanged supplied SVG brand artwork renderer'],
]);
const hex = /#[\da-f]{8}\b|#[\da-f]{6}\b|#[\da-f]{4}\b|#[\da-f]{3}\b/gi;
const physicalProperty = /^(?:left|right|(?:margin|padding|border)-(?:left|right)(?:-(?:width|style|color))?|border-(?:top|bottom)-(?:left|right)-radius|scroll-(?:margin|padding)-(?:left|right))$/i;
const directionalValue = /^(?:text-align|float|clear|caption-side|resize|background-position(?:-x)?|transform-origin|perspective-origin|object-position)$/i;
// Recognize utility scales/arbitrary values, not unrelated authored class names
// such as the merge-review component's .mr-hint.
const scale = String.raw`(?:[\d.[(][^\s"'\x60]*|(?:px|auto|full|screen|none|sm|md|lg|xl|2xl|3xl)(?:\/[^\s"'\x60]+)?)`;
const utility = new RegExp(String.raw`(?:^|[\s:'"\x60])(?:-?(?:left|right|ml|mr|pl|pr|border-l|border-r|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br|scroll-ml|scroll-mr|scroll-pl|scroll-pr)-${scale}|(?:border|rounded)-(?:l|r)|(?:text|float|clear)-(?:left|right))(?=$|[\s"'\x60])`, 'g');
const kebab = value => value.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);

export function scanText(file, source) {
  const issues = [];
  const add = (offset, rule, value) => issues.push({
    file, line: source.slice(0, offset).split('\n').length, rule, value,
  });
  const inspectValue = (value, offset) => {
    for (const match of value.matchAll(hex)) add(offset + match.index, 'hex color outside canonical tokens', match[0]);
  };
  const declaration = (name, value, offset) => {
    name = kebab(name);
    if (physicalProperty.test(name)) add(offset, 'physical CSS property', name);
    if (directionalValue.test(name) && /\b(?:left|right)\b/.test(value)) add(offset, 'physical CSS direction value', `${name}: ${value}`);
    // Four-value shorthands encode distinct physical horizontal sides.
    if (/^(?:margin|padding|border-(?:width|style|color)|scroll-margin|scroll-padding)$/.test(name)
      && value.trim().split(/\s+(?![^()]*\))/).length === 4) {
      add(offset, 'four-side CSS shorthand; use block/inline properties', `${name}: ${value}`);
    }
  };
  if (/\.css$/.test(file)) {
    const clean = source.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '));
    // Only declaration values, not selectors such as #abc or fragment hrefs.
    for (const match of clean.matchAll(/(?:^|[;{])\s*([\w-]+)\s*:\s*([^;{}]+)/g)) {
      declaration(match[1], match[2], match.index);
      inspectValue(match[2], match.index);
    }
  } else {
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const styleNames = new Set();
    const collect = node => {
      if (ts.isJsxAttribute(node) && node.name.getText(tree) === 'style' && node.initializer) {
        const identifiers = child => {
          if (ts.isIdentifier(child)) styleNames.add(child.text);
          ts.forEachChild(child, identifiers);
        };
        identifiers(node.initializer);
      }
      ts.forEachChild(node, collect);
    };
    collect(tree);
    const visit = node => {
      if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)
        || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
        inspectValue(node.text, node.getStart(tree));
        for (const match of node.text.matchAll(utility)) add(node.getStart(tree), 'physical directional CSS utility', match[0].trim());
        // CSS-in-JS template declarations and style-tag string content.
        for (const match of node.text.matchAll(/(?:^|[;{])\s*([\w-]+)\s*:\s*([^;{}]+)/g)) declaration(match[1], match[2], node.getStart(tree));
      }
      if (ts.isPropertyAssignment(node)) {
        const name = ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name) ? node.name.text : '';
        let inStyle = /(?:margin|padding|border|scroll)(?:Left|Right)/.test(name);
        for (let parent = node.parent; parent && !ts.isSourceFile(parent); parent = parent.parent) {
          if (ts.isJsxAttribute(parent) && parent.name.getText(tree) === 'style') inStyle = true;
          if (ts.isVariableDeclaration(parent)) {
            if (styleNames.has(parent.name.getText(tree)) || /style|CSSProperties/i.test(parent.name.getText(tree) + (parent.type?.getText(tree) ?? ''))) inStyle = true;
            break;
          }
          if (ts.isAsExpression(parent) && /CSSProperties/.test(parent.type.getText(tree))) inStyle = true;
        }
        if (inStyle) declaration(name, node.initializer.getText(tree).replace(/^['"]|['"]$/g, ''), node.getStart(tree));
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  return issues;
}

function* files(dir) {
  for (const entry of readdirSync(resolve(root, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!/^(?:__tests__|__fixtures__|fixtures|generated|node_modules|dist)$/.test(entry.name)) yield* files(path);
    } else if (/\.(?:css|tsx?|jsx?)$/.test(path) && !/\.(?:test|spec)\.[^.]+$/.test(path)) yield path;
  }
}

export function checkStyles() {
  const issues = [];
  let count = 0;
  for (const dir of roots) for (const file of files(dir)) {
    if (exceptions.has(file)) continue;
    count++;
    issues.push(...scanText(file, readFileSync(resolve(root, file), 'utf8')));
  }
  console.log(`Scanned ${count} authored CSS/TS/JS files in ${roots.join(', ')}.`);
  for (const [file, reason] of exceptions) console.log(`Explicit exception: ${file} (${reason}).`);
  for (const issue of issues) console.error(`${issue.file}:${issue.line}: ${issue.rule}: ${issue.value}`);
  if (issues.length) process.exitCode = 1;
  else console.log('PASS: no non-token hex colors or physical horizontal CSS.');
  return issues;
}

if (process.argv[1] && relative(resolve(root), resolve(process.argv[1])) === 'scripts/check-ui-1-styles.mjs') checkStyles();
