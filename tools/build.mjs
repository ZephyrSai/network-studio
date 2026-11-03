// Build step (no dependencies): stamps ?v=<content hash> on every css/js URL in index.html so GitHub Pages visitors never get stale files.
// Usage: node tools/build.mjs
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const ROOT=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8'),hash=s=>crypto.createHash('sha1').update(s).digest('hex').slice(0,8);
let html=read('index.html');
html=html.replace(/(src|href)="((?:js|css)\/[^"?]+)(\?v=[^"]*)?"/g,(m,attr,file)=>`${attr}="${file}?v=${hash(read(file))}"`);
fs.writeFileSync(path.join(ROOT,'index.html'),html);
console.log('index.html stamped');
