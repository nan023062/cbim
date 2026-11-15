/** 从自包含原型的 UI_ICONS 母版生成交付用 SVG sprite，不执行原型脚本。 */
import {readFileSync, writeFileSync} from 'node:fs';
const prototype = new URL('./cbim-ux-prototype.html', import.meta.url);
const output = new URL('./cbim-icon-sprite.svg', import.meta.url);
const source = readFileSync(prototype, 'utf8');
const registry = source.match(/const UI_ICONS=\{([\s\S]*?)\n\};/);
if (!registry) throw new Error('UI_ICONS registry missing');
const entries = [...registry[1].matchAll(/^ ([A-Za-z]\w*):\['([^']*)','([^']*)','([^']*)'\]/gm)];
const names = entries.map(match => match[1]);
if (!entries.length || new Set(names).size !== names.length) throw new Error('Empty or duplicate icon registry');
const expected = registry[1].split('\n').filter(line => line.trim()).length;
if (expected !== entries.length) throw new Error('Unsupported icon entry format');
const symbols = entries.map(([, name, , , body]) => `  <symbol id="cbim-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${body}</symbol>`);
const result = ['<svg xmlns="http://www.w3.org/2000/svg">', '  <!-- Generated from cbim-ux-prototype.html UI_ICONS; do not edit by hand. -->', ...symbols, '</svg>', ''].join('\n');
if (process.argv.includes('--check')) {
  if (readFileSync(output, 'utf8') !== result) throw new Error('Sprite differs from UI_ICONS; regenerate it');
  console.log(`Icon sprite verified: ${entries.length} symbols`);
} else {
  writeFileSync(output, result, 'utf8');
  console.log(`Icon sprite generated: ${entries.length} symbols`);
}
