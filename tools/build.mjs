// Build step (no dependencies):
//  1. stamps ?v=<content hash> on every css/js URL in index.html so GitHub Pages visitors never get stale files;
//  2. writes dist/port-network-studio.html — one self-contained file that runs offline (double-click to open).
// Usage: node tools/build.mjs
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const ROOT=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8'),hash=s=>crypto.createHash('sha1').update(s).digest('hex').slice(0,8);
let html=read('index.html');
html=html.replace(/(src|href)="((?:js|css)\/[^"?]+)(\?v=[^"]*)?"/g,(m,attr,file)=>`${attr}="${file}?v=${hash(read(file))}"`);
fs.writeFileSync(path.join(ROOT,'index.html'),html);
const single=html.replace(/<link rel="stylesheet" href="(css\/[^"?]+)\?v=[^"]*">/g,(m,f)=>`<style>\n${read(f)}\n</style>`)
  .replace(/<script src="(js\/[^"?]+)\?v=[^"]*"><\/script>/g,(m,f)=>`<script>\n${read(f).replace(/<\/script/gi,'<\\/script')}\n</script>`)
  .replace('<title>Port Network Studio</title>','<title>Port Network Studio (offline)</title>');
fs.mkdirSync(path.join(ROOT,'dist'),{recursive:true});fs.writeFileSync(path.join(ROOT,'dist/port-network-studio.html'),single);
console.log('index.html stamped; dist/port-network-studio.html',(single.length/1024).toFixed(0),'KB');
