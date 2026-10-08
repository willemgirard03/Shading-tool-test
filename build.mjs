/* Builds the single-file edition: dist/solar-shading.html, and the same page
   as docs/index.html, which GitHub Pages serves.

   The working copy is ES modules, which a browser will only load over http.
   This bundles them with esbuild and inlines the result, and the stylesheet,
   into one page that opens straight from disk and can be emailed or shared.
   rhino3dm is the one thing not inlined - it is 2.7 MB of WebAssembly - so the
   built page fetches it from a CDN the first time Rhino export is used.

   Run:  node build.mjs   (or npm run build)                                */

import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const out = await build({
  entryPoints: ['src/main.js'], bundle: true, format: 'iife', write: false,
  minify: false, legalComments: 'none', target: 'es2020', logLevel: 'warning'
});
let js = out.outputFiles[0].text;
const css = readFileSync('styles.css', 'utf8');
let html = readFileSync('index.html', 'utf8');

const problems = [];
if (js.includes('</script')) js = js.replace(/<\/script/g, '<\\/script');       // cannot end the element early
const before = html;
html = html.replace('<link rel="stylesheet" href="styles.css">', () => '<style>\n' + css + '</style>');
html = html.replace('<script type="module" src="src/main.js"></script>', () => '<script>\n' + js + '</script>');
html = html.replace('<title>Vancouver Solar Shading Explorer</title>',
  '<title>Vancouver Solar Shading Explorer</title>\n<!-- single-file build of v8: open directly, no server needed -->');
if (html === before) problems.push('nothing was inlined');
if (html.includes('src="src/main.js"')) problems.push('the module script tag is still there');
if (html.includes('href="styles.css"')) problems.push('the stylesheet link is still there');
if (/\bimport\s*\{/.test(js) || /^export /m.test(js)) problems.push('a static import or export survived bundling');
if (!js.includes('rhino3dm.module.min.js')) problems.push('the rhino3dm loader is missing');

mkdirSync('dist', { recursive: true });
writeFileSync('dist/solar-shading.html', html);
mkdirSync('docs', { recursive: true });
writeFileSync('docs/index.html', html);
console.log(`dist/solar-shading.html  ${(html.length / 1024).toFixed(0)} kB  (script ${(js.length / 1024).toFixed(0)} kB, styles ${(css.length / 1024).toFixed(0)} kB)`);
if (problems.length) { problems.forEach(p => console.error('FAILED: ' + p)); process.exit(1); }
console.log('checks passed: one file, no module imports left, rhino3dm loader present');
