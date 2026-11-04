import { build } from 'esbuild';
import fs from 'fs';
const r = await build({ entryPoints: ['artifact/entry.jsx'], bundle: true, minify: true, format: 'iife', write: false, jsx: 'automatic', loader: { '.js': 'jsx' }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'error' });
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const font = (fam, file, w) => `@font-face{font-family:'${fam}';font-style:normal;font-weight:${w};font-display:swap;src:url(data:font/woff2;base64,${fs.readFileSync('node_modules/@fontsource/' + file).toString('base64')}) format('woff2');}`;
const fonts = [
  ...[400, 500, 600, 700].map((w) => font('Inter', `inter/files/inter-latin-${w}-normal.woff2`, w)),
  ...[600, 700].map((w) => font('Bodoni Moda', `bodoni-moda/files/bodoni-moda-latin-${w}-normal.woff2`, w)),
].join('');
const css = fonts + fs.readFileSync('app/globals.css', 'utf8');
const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>Azari · Reposición</title><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`;
fs.mkdirSync('artifact/dist', { recursive: true });
fs.writeFileSync('artifact/dist/index.html', html);
console.log('ok', (html.length / 1024).toFixed(0) + ' KB');
