// Revisions: the revision log (doc.revisions), revision tables that fill themselves from it, revision clouds and
// deltas, and change tracking against the last issued revision so the app can ask (or bump automatically) on save.
const Revisions=(()=>{
const C=Core;
const MARKUP=new Set(['revcloud','revdelta']);
const today=()=>new Date().toISOString().slice(0,10);

// Next revision after r: 1.0→1.1, A→B, Z→AA, P01→P02, "Rev 3"→"Rev 4". major: 1.4→2.0, P03→C01-style schemes just step.
function nextRev(r,major=false){r=String(r??'').trim();if(!r)return'A';
  let m=/^(.*?)(\d+)\.(\d+)$/.exec(r);if(m)return major?`${m[1]}${+m[2]+1}.0`:`${m[1]}${m[2]}.${+m[3]+1}`;
  m=/^(.*?)(\d+)$/.exec(r);if(m)return m[1]+String(+m[2]+1).padStart(m[2].length,'0');
  m=/^(.*?)([A-Za-z]+)$/.exec(r);if(m){const up=m[2]===m[2].toUpperCase(),s=m[2].toUpperCase().split('');let i=s.length-1;while(i>=0&&s[i]==='Z'){s[i]='A';i--}if(i<0)s.unshift('A');else s[i]=String.fromCharCode(s[i].charCodeAt(0)+1);const v=s.join('');return m[1]+(up?v:v.toLowerCase())}
  return r+'.1'}

// What counts as a change: geometry, text, data and style of real content — not routing noise, legends,
// revision tables or the revision markup itself.
const round=v=>Math.round((+v||0)*2)/2;
function fingerprint(n){const o={k:n.kind,t:n.type,l:(n.labels||[]).map(l=>l.text),d:n.data,s:n.stroke,f:n.fill,ds:n.dash,dp:n.display,lt:n.linkType,ly:n.layer};
  if(n.kind==='edge'){o.a=n.from?.node||null;o.b=n.to?.node||null;o.w=n.strokeWidth}else{o.x=round(n.x);o.y=round(n.y);o.w=round(n.w);o.h=round(n.h);o.r=n.rotation||0}
  if(n.kind==='table')o.rows=n.rows;let h=2166136261;const s=JSON.stringify(o);for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return(h>>>0).toString(36)}
const tracked=n=>!MARKUP.has(n.type)&&n.kind!=='legend'&&!n.revTable&&n.pin!=='frame';
function snapshot(doc){const out={};for(const p of doc.pages)for(const n of p.items)if(tracked(n))out[n.id]=fingerprint(n);return out}
function changes(doc){const base=doc.revBaseline?.items;if(!base)return{added:[],modified:[],removed:[],count:0,known:false};const seen=new Set(),added=[],modified=[];
  for(const p of doc.pages)for(const n of p.items){if(!tracked(n))continue;seen.add(n.id);const f=base[n.id];if(f==null)added.push(n.id);else if(f!==fingerprint(n))modified.push(n.id)}
  const removed=Object.keys(base).filter(id=>!seen.has(id));return{added,modified,removed,count:added.length+modified.length+removed.length,known:true}}
function setBaseline(doc){doc.revBaseline={rev:doc.meta.revision,at:new Date().toISOString(),items:snapshot(doc)}}

// Log and tables.
function ensureLog(doc){if(!Array.isArray(doc.revisions)||!doc.revisions.length)doc.revisions=[{rev:doc.meta?.revision||'1.0',date:(doc.meta?.created||new Date().toISOString()).slice(0,10),description:'Initial issue',by:doc.meta?.author||''}];return doc.revisions}
const HEAD=['Rev','Date','Description','By'];
function tableRows(doc,n){const log=ensureLog(doc).map(r=>[r.rev,r.date,r.description,r.by]);const rows=n.newestFirst?log.slice().reverse():log;return[HEAD,...rows.slice(n.newestFirst?0:Math.max(0,rows.length-(n.maxRows||99)),n.newestFirst?(n.maxRows||99):undefined)]}
function syncTables(doc){let n=0;for(const p of doc.pages)for(const t of p.items)if(t.revTable){t.rows=tableRows(doc,t);if(typeof tableLayout==='function')tableLayout(t);else{t.w=t.cols.reduce((a,b)=>a+b,0);t.h=t.rows.length*t.rowH}n++}return n}
function newTable(doc,x,y,layer){ensureLog(doc);const t={id:C.uid(),kind:'table',revTable:true,x,y,cols:[46,82,200,86],rowH:20,size:10.5,header:true,rows:[],labels:[],stroke:'#94a3b8',headerFill:'#eef2f7',layer};t.rows=tableRows(doc,t);t.w=t.cols.reduce((a,b)=>a+b,0);t.h=t.rows.length*t.rowH;return t}

// Markup items.
function markupLayer(doc){let l=doc.layers.find(x=>x.name.toLowerCase()==='revisions');if(!l){l={id:C.uid(),name:'Revisions',visible:true,locked:false,print:true};doc.layers.push(l)}return l.id}
function cloud(x,y,w,h,rev,layer){const n=C.node('revcloud',x,y,'',w,h);Object.assign(n,{display:'shape',fill:'none',stroke:'#dc2626',strokeWidth:1.6,dash:'',ports:[],layer});n.labels=[];n.data={rev};return n}
function delta(x,y,rev,layer){const w=30,h=26,n=C.node('revdelta',x,y,String(rev),w,h);Object.assign(n,{display:'shape',fill:'#ffffff',stroke:'#dc2626',strokeWidth:1.6,dash:'',ports:[],layer});const l=n.labels[0];l.x=x+w/2;l.y=y+h*.72+3.5;l.size=10.5;l.bold=true;l.color='#dc2626';l.wrapWidth=0;n.data={rev:String(rev)};return n}
// Group changed items that sit close together, so each area of change gets one cloud.
function clusters(boxes,gap=48){const groups=[];for(const b of boxes){let g=groups.find(g=>b.x<g.x+g.w+gap&&b.x+b.w>g.x-gap&&b.y<g.y+g.h+gap&&b.y+b.h>g.y-gap);if(!g){groups.push({...b});continue}const x0=Math.min(g.x,b.x),y0=Math.min(g.y,b.y);g.w=Math.max(g.x+g.w,b.x+b.w)-x0;g.h=Math.max(g.y+g.h,b.y+b.h)-y0;g.x=x0;g.y=y0}
  // merging can make clusters overlap; repeat until stable
  for(let again=true;again;){again=false;for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++){const a=groups[i],b=groups[j];if(b.x<a.x+a.w+gap&&b.x+b.w>a.x-gap&&b.y<a.y+a.h+gap&&b.y+b.h>a.y-gap){const x0=Math.min(a.x,b.x),y0=Math.min(a.y,b.y);a.w=Math.max(a.x+a.w,b.x+b.w)-x0;a.h=Math.max(a.y+a.h,b.y+b.h)-y0;a.x=x0;a.y=y0;groups.splice(j,1);again=true;j--}}}return groups}
function cloudChanges(doc,ch,rev){const ids=new Set([...ch.added,...ch.modified]),layer=markupLayer(doc);let made=0;
  for(const p of doc.pages){const boxes=p.items.filter(n=>ids.has(n.id)&&n.kind!=='zone'&&n.kind!=='edge').map(n=>C.bounds([n],true));
    // a changed zone or link with no changed device near it still deserves a cloud
    for(const n of p.items)if(ids.has(n.id)&&(n.kind==='edge'||n.kind==='zone')){const b=n.kind==='zone'?{x:n.x,y:n.y,w:Math.min(n.w,160),h:Math.min(n.h,60)}:C.bounds([n]);if(!boxes.some(x=>b.x<x.x+x.w+48&&b.x+b.w>x.x-48&&b.y<x.y+x.h+48&&b.y+b.h>x.y-48))boxes.push(b)}
    // areas already clouded by hand for this revision keep their cloud
    const own=p.items.filter(n=>n.type==='revcloud'&&String(n.data?.rev)===String(rev)),covered=b=>own.some(c=>b.x+b.w/2>=c.x&&b.x+b.w/2<=c.x+c.w&&b.y+b.h/2>=c.y&&b.y+b.h/2<=c.y+c.h);
    for(const g of clusters(boxes.filter(b=>!covered(b)))){const pad=14,c=cloud(g.x-pad,g.y-pad,g.w+2*pad,g.h+2*pad,rev,layer);p.items.push(c,delta(c.x+c.w-6,c.y-30,rev,layer));made++}}return made}

// Issue a revision: log it, update the document revision, tables and (optionally) clouds, and reset the baseline.
function issue(doc,{rev,date=today(),description='',by='',clouds=false,clearClouds=false}={}){const ch=changes(doc);ensureLog(doc);
  if(clearClouds)for(const p of doc.pages)p.items=p.items.filter(n=>n.type!=='revcloud');
  let made=0;if(clouds&&ch.known)made=cloudChanges(doc,ch,rev);
  doc.revisions.push({rev,date,description,by});doc.meta.revision=rev;syncTables(doc);setBaseline(doc);return{changes:ch,clouds:made}}

return{nextRev,fingerprint,snapshot,changes,setBaseline,ensureLog,syncTables,newTable,tableRows,cloud,delta,markupLayer,clusters,cloudChanges,issue,MARKUP,today};
})();
if(typeof module!=='undefined')module.exports=Revisions;
