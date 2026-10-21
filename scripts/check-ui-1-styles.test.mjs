import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanText } from './check-ui-1-styles.mjs';

test('style guard rejects authored hex colors, horizontal declarations and utilities', () => {
  for (const source of [
    '.a { color: #aBc; }', '.a { margin-left: 2px; }',
    '.a { text-align: right; }', '.a { padding: 1px 2px 3px 4px; }',
  ]) assert.ok(scanText('example.css', source).length, source);
  for (const source of [
    '<div style={{ color: "#ffffff" }} />',
    '<div style={{ marginLeft: 2, right: 0 }} />',
    '<div style={{ left: 0 }} />',
    'const position = { right: 0 }; const element = <div style={position} />;',
    'const style: CSSProperties = { textAlign: "left" };',
    '<div className="flex ml-2 text-right" />',
    'const x = css`a { float: left; }`;',
  ]) assert.ok(scanText('example.tsx', source).length, source);
});

test('style guard accepts logical tokens, selectors, comments and non-style geometry', () => {
  assert.deepEqual(scanText('example.css', '/* color: #fff */ #abc { color: var(--amal-text); margin-inline: 2px; text-align: start; }'), []);
  assert.deepEqual(scanText('example.tsx', '<a href="#section" style={{ marginInline: 2, color: "var(--amal-text)" }} />'), []);
  assert.deepEqual(scanText('example.tsx', '<p className="mr-hint">Merge review hint</p>'), []);
  assert.deepEqual(scanText('example.ts', 'const rect = { left: 2, right: 10 };'), []);
});
