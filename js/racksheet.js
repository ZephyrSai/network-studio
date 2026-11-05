// Rack spreadsheets: one rack as an Excel or CSV table to fill in — a row per U (highest first), then the 0U side
// channels, with the roof on top — and the way back: rows matched to units by Row ID, serial no. or name, planned as a
// whole (moves, swaps, conflicts, new rows) before anything changes, then applied in one go. Pure: no S, DOM or Conn.
const RackSheet=(()=>{
const C=Core,RU=()=>Shapes.RU;
const MOUNTS={u:'Rack U',left:'0U left',right:'0U right',roof:'Roof'},HEIGHTS=[42,45,47,48],ROWS=500;
const norm=h=>String(h??'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
const has=v=>v!=null&&String(v).trim()!=='',first=t=>String(t??'').split(/\r\n|\r|\n/)[0],nl=v=>String(v??'').replace(/\r\n?/g,'\n'),unitsOf=r=>r.units||42,isSide=m=>m==='left'||m==='right',mounted=m=>m==='u'||isSide(m);
const span=(u,h)=>`U${u}${h>1?'–'+(u+h-1):''}`,fansTxt=k=>`${k} fan${k===1?'':'s'}`,plural=(n,w)=>`${n} ${w}${n===1?'':'s'}`,show=v=>has(v)?String(v):'(empty)';
const art=f=>(/^(?:[AEIO]|NVR|LCD)/.test(f)?'An ':'A ')+f;
const setFirst=(t,v)=>{const ls=String(t??'').split('\n');ls[0]=v;return ls.join('\n')};
const tidy=v=>nl(v).trim(),clean=v=>tidy(v).replace(/^'(?='*[=+\-@])/,'');// the CSV formula guard comes off again
// Workbook cells follow the CSV convention on the way in (a leading ' before = + - @ is the guard), so a value that
// really starts with ' keeps it: fromRows takes one ' off again.
const guard=v=>{const t=tidy(v);return/^'+[=+\-@]/.test(t)?"'"+t:v};
const cut=(s,n)=>{s=String(s);if(s.length<=n)return s;s=s.slice(0,n);return/[\uD800-\uDBFF]$/.test(s)?s.slice(0,-1):s};// never half an emoji
const posText=(p,fans)=>!p?'Skipped':p.mount==='u'?span(p.u,p.h):isSide(p.mount)?`0U ${p.mount} · ${span(p.u,p.h)}`:p.mount==='roof'?(fans?`Roof · ${fansTxt(fans)}`:'Roof'):p.mount==='park'?'Beside the rack':'not mounted';
const samePlace=(a,b)=>a.mount===b.mount&&(!mounted(a.mount)||a.u===b.u&&a.h===b.h);
const HOWTO=['One row per U, highest first. Fill in Name and Equipment on a free row to add a unit; U covered by a taller unit have no row.',
  'The drop-down lists are suggestions — you can type any value.','0U left and 0U right are the vertical PDU channels as seen from the front; Roof is the roof fan tray.',
  'Leave Row ID as it is — it ties a row to its unit in the drawing. New rows need none.','Save, then drop the file on the rack in Port Network Studio (or right-click the rack ▸ Spreadsheet ▸ Import…).'];

// ---------- names and values ----------
// The first line of a unit's name as the drawing shows it ({{asset}} is the linked device's name).
function namer(env){const find=id=>env.find?.(id)||null;
  const own=n=>first(n?.labels?.[0]?.text).replace(/\{\{\s*([\w.]+)\s*\}\}/g,(m,k)=>{const a=n.ref&&find(n.ref);if(k==='asset')return a?first(a.labels?.[0]?.text||a.data?.hostname||Shapes.nameOf(a.type)):'(device removed)';if(k.startsWith('asset.'))return a?.data?.[k.slice(6)]??'';return n.data?.[k]??a?.data?.[k]??''});
  return n=>n?first(env.nameOf?env.nameOf(n):own(n)).trim():''}
const devOf=(n,env)=>n?.ref?env.find?.(n.ref)||null:null;
const valOf=(n,k,dev)=>has(n?.data?.[k])?n.data[k]:has(dev?.data?.[k])?dev.data[k]:'';// the unit's own value, else its device's
const numOut=v=>typeof v==='string'&&/^-?\d+(\.\d+)?$/.test(v.trim())?+v:v;
const pageOf=(n,env)=>{const d=env.devices?.find(x=>x.n===n);return d?d.page:env.doc?.pages?.find(p=>p.items.includes(n))||null};
const pageName=(n,env)=>{const p=pageOf(n,env);return typeof p==='string'?p:p?.name||''};
const rackOfAny=(it,env)=>{if(!Racks.isItem(it))return null;const p=env.doc?.pages?.find(p=>p.items.includes(it));return p?Racks.rackOf(it,p.items):null};
const fieldsOf=doc=>doc?.fields||C.FIELDS;
const labelOf=(doc,k)=>k==='depth'?'Depth (mm)':fieldsOf(doc).find(f=>f.key===k)?.label||k,isNum=(doc,k)=>k==='depth'||fieldsOf(doc).find(f=>f.key===k)?.type==='number';
function equipmentOf(n){const f=Racks.family(n.type)||Shapes.nameOf(n.type);return Racks.mountOf(n)==='roof'?`${f} (${fansTxt(Racks.fansOf(n))})`:f}

// ---------- export ----------
// Columns of the rack table: [{key, field?, header, width, text?, muted?, number?}]
function columns(doc){const L=(k,d)=>fieldsOf(doc).find(f=>f.key===k)?.label||d,builtin=new Set(C.FIELDS.map(f=>f.key));
  return[{key:'u',header:'U (bottom)',width:10},{key:'height',header:'Height (U)',width:10},{key:'mount',header:'Mount',width:11},{key:'equipment',header:'Equipment',width:24},{key:'name',header:'Name',width:24,text:true},
    {key:'field',field:'status',header:L('status','Status'),width:11},{key:'field',field:'vendor',header:L('vendor','Vendor'),width:14},{key:'field',field:'model',header:L('model','Model'),width:18,text:true},{key:'field',field:'serial',header:L('serial','Serial no.'),width:18,text:true},
    {key:'field',field:'power',header:'Power draw (W)',width:14,number:true},{key:'typical',header:'Typical W (not imported)',width:12,muted:true},{key:'depth',header:'Depth (mm)',width:11,number:true},{key:'field',field:'notes',header:'Notes',width:30,text:true},
    ...fieldsOf(doc).filter(f=>!builtin.has(f.key)).map(f=>({key:'field',field:f.key,header:f.label||f.key,width:16,number:f.type==='number',text:f.type!=='number'})),
    {key:'linked',header:'Linked device (not imported)',width:24,muted:true},{key:'rowId',header:'Row ID (leave as is)',width:38,muted:true,text:true}]}
const tabName=name=>{let t=cut(String(name||'').replace(/[\\/?*[\]:]/g,' ').replace(/^'+|'+$/g,'').trim(),31).trim()||'Rack';if(/^(about|lists|history)$/i.test(t))t+=' rack';return t};
// One rack as a table: {name, sheet, units, columns, rows:[[cell]], ids:[unit id | null], about:[[key, value]], lists, statuses}.
// Only stored values go out (typical power has its own column), so importing it straight back changes nothing.
// the art units a drawing uses are offered by name, with the families; the type registry itself outlives a document
const artNames=doc=>doc?.pages?Racks.artTypes(doc.pages.flatMap(p=>p.items)).map(t=>Shapes.rackItems[t].name):[];
function exportTable(r,items,env={},name){const doc=env.doc,cols=columns(doc),H=unitsOf(r),nm=namer(env),rows=[],ids=[];
  const cell=(c,n,w)=>{if(!n)return c.key==='u'?w.u??'':c.key==='height'?w.h??'':c.key==='mount'?MOUNTS[w.mount]:'';const dev=devOf(n,env);
    switch(c.key){case'u':return w.mount==='roof'?'':w.u;case'height':return w.mount==='roof'?'':w.h;case'mount':return MOUNTS[w.mount];case'equipment':return equipmentOf(n);case'name':return nm(n);
      case'field':{const v=valOf(n,c.field,dev);return c.number?numOut(v):typeof v==='boolean'?String(v):v}case'depth':return numOut(valOf(n,'depth',dev));
      case'typical':{if(has(valOf(n,'power',dev)))return'';const s=Racks.specs(n,env.find);return s.estimated?s.power:''}
      case'linked':return dev?`${nm(dev)}${pageName(dev,env)?` (${pageName(dev,env)})`:''}`:'';case'rowId':return n.id}return''};
  const add=(n,w)=>{rows.push(cols.map(c=>{const v=cell(c,n,w);return typeof v==='string'?nl(v):v}));ids.push(n?.id||null)};// line breaks as LF (import compares them that way)
  const ex=Racks.extras(r,items).map(n=>({n,w:Racks.where(r,n)})),pick=m=>ex.filter(x=>x.w.mount===m).sort((a,b)=>(b.w.u||0)-(a.w.u||0)||a.n.y-b.n.y);
  const roof=pick('roof');if(roof.length)roof.forEach(x=>add(x.n,x.w));else add(null,{mount:'roof'});
  const at=new Map(),occ=Racks.occupied(r,items);for(const n of Racks.contents(r,items)){const u=Racks.uOf(r,n);if(!at.has(u))at.set(u,[]);at.get(u).push(n)}
  for(let u=H;u>=1;u--)if(at.has(u))at.get(u).forEach(n=>add(n,{mount:'u',u,h:Racks.heightU(n)}));else if(!occ.has(u))add(null,{mount:'u',u,h:1});
  for(const s of['left','right']){const l=pick(s);if(l.length)l.forEach(x=>add(x.n,x.w));else add(null,{mount:s})}
  const p=env.page||pageOf(r,env),D=env.date||new Date(),pad=x=>String(x).padStart(2,'0'),rn=name??nm(r),num=v=>numOut(v??'');
  const about=[['Rack',rn],['Rack ID',{v:r.id||'',style:'muted'}],['Height (U)',H],['Width (mm)',num(r.data?.width)],['Depth (mm)',num(r.data?.depth)],['Power budget (W)',num(r.data?.powerBudget)],['Voltage (V)',num(r.data?.voltage)],
    ['Page',typeof p==='string'?p:p?.name||''],['Drawing',doc?.name||''],['Exported',`${D.getFullYear()}-${pad(D.getMonth()+1)}-${pad(D.getDate())} ${pad(D.getHours())}:${pad(D.getMinutes())}`],[],...HOWTO.map(t=>[t])];
  return{name:rn,sheet:tabName(rn),units:H,columns:cols,rows,ids,about,lists:[...new Set([...Racks.families(),...artNames(doc)]),...[2,4,6].map(k=>`Roof fan tray (${k} fans)`)],statuses:fieldsOf(doc).find(f=>f.key==='status')?.options||[],date:D}}
// An empty rack of a given height to plan in Excel.
function blankTable(units=42,name='Rack',env={}){const r={id:'',kind:'node',type:'rack',x:0,y:0,w:1,h:1,units:Math.max(1,Math.round(+units)||42),labels:[{text:name}],data:{}};return exportTable(r,[],{...env,page:''},name)}
function toXlsx(t){const cols=t.columns,ix=f=>cols.flatMap((c,i)=>f(c)?[i]:[]),at=k=>cols.findIndex(c=>c.key===k),last=Math.max(ROWS,t.rows.length+1),rng=i=>`${Xlsx.colName(i)}2:${Xlsx.colName(i)}${last}`,st=cols.findIndex(c=>c.field==='status');
  const lists=[{range:rng(at('equipment')),source:`Lists!$A$1:$A$${t.lists.length}`},{range:rng(at('mount')),values:Object.values(MOUNTS)},...(st>=0&&t.statuses?.length?[{range:rng(st),values:t.statuses}]:[])];
  const numbers=['u','height'].map(k=>({range:rng(at(k)),min:1,max:t.units,error:`Enter a whole number of U from 1 to ${t.units} (U1 is at the bottom).`}));
  return Xlsx.build([{name:t.sheet,rows:[cols.map(c=>c.header),...t.rows],header:true,freeze:1,filter:true,widths:cols.map(c=>c.width),muted:ix(c=>c.muted),text:ix(c=>c.text),lists,numbers},
    {name:'About',rows:t.about,widths:[18,44]},{name:'Lists',hidden:true,rows:t.lists.map(x=>[x])}],{date:t.date})}
// CSV (UTF-8 with a BOM so Excel reads "·" and "–"); text starting with = + - @ gets a leading ' so it never runs as a formula.
function toCSV(t){const q=v=>{let s=v==null?'':String(v);if(typeof v==='string'&&/^'*[=+\-@]/.test(s))s="'"+s;return/[",;\t|\r\n]|^\s|\s$/.test(s)?'"'+s.replace(/"/g,'""')+'"':s};
  return'﻿'+[t.columns.map(c=>c.header),...t.rows].map(r=>r.map(q).join(',')).join('\r\n')+'\r\n'}

// ---------- reading ----------
// The separator that splits the first lines most consistently: the field count (above 1) shared by the most lines,
// so a title line above the header does not decide it.
function separator(text){let best=',',top=0;const ls=text.split(/\r\n|\r|\n/).filter(l=>l.trim()).slice(0,10);
  for(const d of[',',';','\t','|']){const seen=new Map();for(const l of ls){let k=1,q=false;for(const c of l)if(c==='"')q=!q;else if(c===d&&!q)k++;if(k>1)seen.set(k,(seen.get(k)||0)+1)}
    for(const[k,c]of seen)if(c*1000+k>top){top=c*1000+k;best=d}}return best}
// Rows of a CSV, blank rows kept so row numbers match the spreadsheet (; tab and | separators are recognised too).
function parseCSV(text){text=String(text??'').replace(/^﻿/,'');const d=separator(text),rows=[];let row=[],cur='',q=false,quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(q){if(c==='"'){if(text[i+1]==='"'){cur+='"';i++}else q=false}else cur+=c}else if(c==='"'&&!cur.trim()){q=quoted=true;cur=''}else if(c===d){row.push(cur);cur='';quoted=false}
    else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cur);rows.push(row);row=[];cur='';quoted=false}else cur+=c}
  if(cur||quoted||row.length){row.push(cur);rows.push(row)}return rows}
const decode=b=>{try{return new TextDecoder('utf-8',{fatal:true}).decode(b)}catch{return new TextDecoder('windows-1252').decode(b)}};
const ALIAS={u:['u','u_bottom','position','ru','rack_u','start_u','lowest_u','starts_at_u'],height:['height','height_u','u_height','size','length','length_u'],mount:['mount','mounting','face','side'],
  equipment:['equipment','type','kind','item','role','device_role'],name:['name','device','device_name','unit_name','label','asset_name'],model:['model','device_type','product','part_number'],vendor:['vendor','manufacturer','make','brand'],
  serial:['serial','serial_no','serial_number','sn'],status:['status','state'],power:['power','power_w','power_draw','power_draw_w','watts'],depth:['depth','depth_mm'],notes:['notes','description','comments'],rowId:['row_id','row_id_leave_as_is','id','key','unit_id']};
const FIELD_ALIAS=new Set(['model','vendor','serial','status','power','notes']);
// Header cells → [{i, header, key:'u'|'height'|'mount'|'equipment'|'name'|'depth'|'rowId'|'field', field}] and the ignored headers.
function mapHeader(row,doc){const own=columns(doc).filter(c=>c.key!=='linked'&&c.key!=='typical'),cols=[],seen=new Set(),ignored=[];
  (row||[]).forEach((h,i)=>{const raw=clean(h),k=norm(raw);if(!raw)return;let c=own.find(c=>c.header.trim().toLowerCase()===raw.toLowerCase());
    if(!c&&/^(linked_device|typical)/.test(k))return;// our own grey columns (a custom field of that name matched above)
    if(!c){const a=Object.keys(ALIAS).find(f=>ALIAS[f].includes(k));if(a)c=FIELD_ALIAS.has(a)?{key:'field',field:a}:{key:a};else{const f=fieldsOf(doc).find(f=>norm(f.label)===k||norm(f.key)===k);if(f)c={key:'field',field:f.key}}}
    const id=c&&(c.key==='field'?'f:'+c.field:c.key);if(!c||seen.has(id)){ignored.push(raw);return}seen.add(id);cols.push({i,header:raw,key:c.key,field:c.field})});
  return{cols,ignored}}
const headerAt=(rows,doc)=>{for(let i=0;i<Math.min(10,rows.length);i++){const m=mapHeader(rows[i],doc),k=new Set(m.cols.map(c=>c.key));if(k.has('u')&&(k.has('name')||k.has('equipment')))return{i,...m,keys:k}}return null};
// CSV routing: a U column, Name or Equipment, and Height (U), Mount or Row ID — NetBox device lists stay device imports.
function isRackTable(rows){if(typeof rows==='string')rows=parseCSV(rows);for(const row of(rows||[]).slice(0,10)){const ks=(row||[]).map(norm),any=a=>ks.some(k=>a.includes(k));
  if(any(ALIAS.u)&&any([...ALIAS.name,...ALIAS.equipment])&&ks.some(k=>k==='height_u'||k==='u_height'||k==='mount'||k.startsWith('row_id')))return true}return false}

// ---------- cells ----------
// "1,200 W" → 1200, "0,5" → 0.5, "ca. 350 W" → 350, "1e3" → 1000, "" → null; no number, or two of them ("350-400") → NaN.
function parseNum(s){let t=String(s??'').trim();if(!t)return null;t=t.replace(/(\d)[\s  ']+(?=\d)/g,'$1');
  const e=t.replace(/\s+/g,'');if(/^[-+]?(\d+\.?\d*|\.\d+)e[-+]?\d+$/i.test(e))return+e;
  const m=[...t.matchAll(/\d[\d.,]*/g)];if(m.length!==1)return NaN;const pre=t.slice(0,m[0].index),dot=/(^|[^\w.])\.$/.test(pre);let v=(dot?'.':'')+m[0][0].replace(/[.,]+$/,'');
  const neg=/(^|[\s(~≈<>:=])[-−]\.?$/.test(pre)?-1:1;
  if(/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(v))v=v.replace(/,/g,'');else if(/^\d{1,3}(\.\d{3})+,\d+$/.test(v))v=v.replace(/\./g,'').replace(',','.');else if(/^\d{1,3}(\.\d{3}){2,}$/.test(v))v=v.replace(/\./g,'');else if(/^\d+,\d+$/.test(v))v=v.replace(',','.');
  return/^(\d+\.?\d*|\.\d+)$/.test(v)?neg*v:NaN}
// "38", "U38", "12.0", "U38–39" (also gives the height) → {u, h}; anything else → {bad}
function parseU(s){const t=String(s??'').trim();if(!t)return{u:null};const m=/^u?\s*(\d+)(?:[.,]0+)?\s*(?:[-–—]|to)\s*u?\s*(\d+)(?:[.,]0+)?$/i.exec(t);if(m){const a=+m[1],b=+m[2];return{u:Math.min(a,b),h:Math.abs(b-a)+1}}
  const v=parseNum(t.replace(/^u\s*/i,''));return Number.isInteger(v)?{u:v}:{u:null,bad:t}}
function parseH(s){const t=String(s??'').trim();if(!t)return{h:null};if(/^full(\s*height)?$/i.test(t))return{h:'full'};const v=parseNum(t.replace(/\s*u$/i,''));return v===0?{h:null}:Number.isInteger(v)&&v>0?{h:v}:{h:null,bad:t}}
function parseMount(s){const raw=String(s??'').trim(),t=raw.toLowerCase();if(!t)return{mount:null};if(/roof|^top\b/.test(t))return{mount:'roof'};if(/\bleft\b|^l$/.test(t))return{mount:'left'};if(/\bright\b|^r$/.test(t))return{mount:'right'};
  if(/^(front|rear|back|rails?|rack|rack ?u|in rack|u|rack[- ]?mount(ed)?|front ?\/ ?rear)$/.test(t))return{mount:'u'};return{mount:'u',note:`Mount “${raw}” not recognised — treated as Rack U`}}
// Equipment text → {type (when it names one exactly), fam, fans}; null when it is not a family, catalogue name or type key.
function parseEquipment(text){const t=String(text??'').trim();if(!t)return null;const fm=/\(\s*(\d+)\s*fans?\s*\)/i.exec(t),fans=fm?Math.max(1,Math.min(6,+fm[1])):null,b=t.replace(/\(\s*\d+\s*fans?\s*\)/i,'').replace(/\(guessed\)/i,'').replace(/\s+/g,' ').trim().toLowerCase();
  const named=art=>{for(const[k,v]of Object.entries(Shapes.rackItems))if((v.face==='art')===art&&(k===b||v.name.toLowerCase()===b))return{type:k,fam:v.fam,fans,...(art?{art:k===b?'type':'name'}:{})}};const fam=Racks.families().find(f=>f.toLowerCase()===b);return named(false)||(fam?{type:null,fam,fans}:null)||named(true)||null}
function parseRow(cells,cols,line){const get=k=>{const c=cols.find(c=>c.key===k);return c?String(cells[c.i]??''):undefined},nameCell=(get('name')||'').trim(),name=first(nameCell).trim(),eqText=(get('equipment')||'').trim();if(!name&&!eqText)return null;
  const notes=[],problems=[],values={};if(/\n/.test(nameCell))notes.push('Name has more than one line — only the first line is used');for(const c of cols)if(c.key==='field')values[c.field]=String(cells[c.i]??'');else if(c.key==='depth')values.depth=String(cells[c.i]??'');
  const U=parseU(get('u')),Hh=parseH(get('height')),M=parseMount(get('mount')),eq=parseEquipment(eqText),fm=/\(\s*(\d+)\s*fans?\s*\)/i.exec(eqText),guess=eq?null:Racks.guessType(`${eqText} ${name} ${values.model||''}`);
  if(M.note)notes.push(M.note);if(Hh.bad)problems.push(`Height “${Hh.bad}” is not a whole number of U — not changed`);if(eqText&&!eq)notes.push(`Equipment “${eqText}” not recognised — guessed ${Racks.family(guess.type)}`);
  return{line,name,rowId:(get('rowId')||'').trim(),u:U.u,spanH:U.h??null,uBad:U.bad||null,h:Hh.h,mount:M.mount,eqText,eq,guess,fans:fm?Math.max(1,Math.min(6,+fm[1])):null,values,notes,problems}}
// Spreadsheet rows (strings; from read(), parseCSV or Builder.parseCSV) → {columns, rows:[parsed row], ignored, hasRowId,
// header, blank, tops, error}. The header is the first of the first 10 rows with a U and a Name or Equipment column; row
// numbers are Excel's. tops: [the unbroken run of Rack U rows from U1, the highest U of the exported rows alone (Row ID
// and free rows)] — where the top of the rack was when the spreadsheet was made, even with rows typed above it or deleted.
// guard:false for rows straight from Xlsx.read (no CSV formula guard to take off).
function fromRows(rows,{doc,guard:g=true}={}){const cl=g===false?tidy:clean;rows=(rows||[]).map(r=>Array.from(r||[],v=>cl(v)));const h=headerAt(rows,doc);
  if(!h)return{columns:[],rows:[],ignored:[],hasRowId:false,header:0,blank:0,tops:[],error:'No U and Name columns were found.'};
  const out=[],all=new Set(),ex=new Set(),ci=k=>h.cols.find(c=>c.key===k)?.i;let blank=0,top=0;
  for(let j=h.i+1;j<rows.length;j++){const r=rows[j],p=parseRow(r,h.cols,j+1);if(p)out.push(p);else blank++;
    const U=parseU(r[ci('u')]),m=parseMount(r[ci('mount')]).mount,hh=parseH(r[ci('height')]).h,e=!p||!!p.rowId;
    if(Number.isInteger(U.u)&&U.u>0&&(!m||m==='u'))for(let k=0;k<Math.min(100,Number.isInteger(hh)?hh:U.h||1);k++){all.add(U.u+k);if(e)ex.add(U.u+k)}}
  while(all.has(top+1))top++;
  return{columns:h.cols,rows:out,ignored:h.ignored,hasRowId:h.keys.has('rowId'),header:h.i+1,blank,tops:[top,Math.max(0,...ex)],error:null}}
const ABOUT={rack:'name',rack_name:'name',rack_id:'id',height_u:'units',height:'units',width_mm:'width',depth_mm:'depth',power_budget_w:'powerBudget',voltage_v:'voltage',page:'page',drawing:'drawing',exported:'exported'};
// The About tab → {name, id, units, width, depth, powerBudget, voltage, page, drawing, exported} (strings), or null.
function about(tabRows){const o={};for(const r of tabRows||[]){const k=ABOUT[norm(r?.[0])];if(k&&!(k in o))o[k]=clean(r?.[1])}return'id'in o||'name'in o?o:null}
// A dropped or picked file (a File, bytes, or CSV text) → {format:'xlsx'|'csv', tabs:[{name, rows, rack}], tab, about}; throws a
// message to show for old .xls files and files that cannot be read. Hidden tabs (Lists) and About are not offered. The
// rows go to fromRows as they are (workbook cells carry the same formula-guard convention as CSV).
async function read(input,fileName=input?.name||'',{doc}={}){if(input&&typeof input.arrayBuffer==='function'&&!(input instanceof Uint8Array))input=new Uint8Array(await input.arrayBuffer());const ext=(/\.([^.]+)$/.exec(fileName)?.[1]||'').toLowerCase(),base=String(fileName).replace(/^.*[\\/]/,'').replace(/\.[^.]+$/,'')||'Rack';
  let text=typeof input==='string'?input:null;
  if(text==null){const b=input instanceof Uint8Array?input:new Uint8Array(input),ole=b.length>8&&b[0]===0xD0&&b[1]===0xCF&&b[2]===0x11&&b[3]===0xE0;
    if(ext==='xls'||ole&&ext!=='xlsx')throw Error('Old Excel files (.xls) cannot be read in a browser — open the file in Excel and save it as .xlsx or CSV.');
    if(ole||ext==='xlsx'||Xlsx.isXlsx(b)){let book;try{book=await Xlsx.read(b)}catch{throw Error(`“${fileName||'This file'}” could not be read — it may be damaged or password-protected. Save a fresh copy from Excel and try again.`)}
      const g=rows=>rows.map(r=>Array.from(r||[],guard)),ab=book.find(s=>norm(s.name)==='about'),tabs=book.filter(s=>!s.hidden&&s!==ab).map(s=>{const rows=g(s.rows);return{name:s.name,rows,rack:!!headerAt(rows.map(r=>r.map(clean)),doc)}});
      return{format:'xlsx',tabs,tab:Math.max(0,tabs.findIndex(t=>t.rack)),about:ab?about(g(ab.rows)):null}}
    text=decode(b)}
  const rows=parseCSV(text);return{format:'csv',tabs:[{name:base,rows,rack:!!headerAt(rows.map(r=>r.map(clean)),doc)}],tab:0,about:null}}

// ---------- import plan ----------
// What importing rows into rack r would do, without changing anything (re-run it on every change in the preview).
// opts: {resolve:{[row]:'keep'|'near'|'park'|'skip'}, off:[rows unticked], types:{[row]:type} (new rows), updateLinked=true,
//        linkByName=true, alsoLocked, removeMissing, growTo, about (from about()), rackChanges=true, newRack}
function plan(r,items,src,opts={},env={}){
  const P=Array.isArray(src)?{rows:src,hasRowId:src.some(p=>p.rowId)}:src||{rows:[]},doc=env.doc,nm=namer(env),o={updateLinked:true,linkByName:true,...opts},off=new Set((o.off||[]).map(Number)),H0=unitsOf(r),rname=nm(r)||'the rack',tops=P.tops||[];
  const placeOf=n=>{const w=Racks.where(r,n);return w.u==null?{mount:w.mount}:{mount:w.mount,u:w.u,h:w.h}},atH=(i,H)=>isSide(i.cur.mount)&&i.n.fullHeight&&i.cur.u===1?{...i.cur,h:H}:i.cur;// full height follows the rack
  const own=o.newRack?[]:[...Racks.contents(r,items),...Racks.extras(r,items)],info=new Map(own.map(n=>[n.id,{n,dev:devOf(n,env),name:nm(n),cur:placeOf(n),fam:Racks.family(n.type)}]));
  const rows=(P.rows||[]).map(p=>({line:p.line,p,on:!off.has(p.line),kind:'new',id:null,name:p.name,notes:[...(p.notes||[])],problems:[...(p.problems||[])],changes:[],skipped:[],conflict:null,place:null,link:null}));
  const notes=[],taken=new Map(),how=[],match=(x,id,h)=>{x.kind='match';x.id=id;x.how=h;taken.set(id,x);if(!how.includes(h))how.push(h)},open=x=>x.kind!=='match'&&!x.noMatch,lc=v=>String(v??'').trim().toLowerCase();
  if(P.hasRowId===false)notes.push('No Row ID column — matched by serial no. and name');
  // 1. matching: Row ID; then a serial no. or name unique among the rows and units still open; then the same name (or,
  // for a row without one, the same family) at the same U and mount; then rows with no U, anywhere on that mount
  for(const x of rows){const id=x.p.rowId;if(!id)continue;if(info.has(id)){if(taken.has(id)){x.noMatch=true;x.notes.push(`Same Row ID as row ${taken.get(id).line} — added as a new unit`)}else match(x,id,'Row ID');continue}
    const it=env.find?.(id);if(it){x.noMatch=true;const rk=rackOfAny(it,env);x.notes.push(`Row ID belongs to ${nm(it)||Shapes.nameOf(it.type)}${rk?' in '+nm(rk):''} — added as a new unit`)}}
  const unique=(h,ofRow,ofUnit)=>{const rc=new Map(),uc=new Map();for(const x of rows)if(open(x)){const v=ofRow(x);if(v)rc.set(v,(rc.get(v)||0)+1)}for(const i of info.values())if(!taken.has(i.n.id)){const v=ofUnit(i);if(v)uc.set(v,[...(uc.get(v)||[]),i.n.id])}
    for(const x of rows){if(!open(x))continue;const v=ofRow(x);if(v&&rc.get(v)===1&&uc.get(v)?.length===1&&!taken.has(uc.get(v)[0]))match(x,uc.get(v)[0],h)}};
  unique('serial no.',x=>lc(x.p.values?.serial),i=>lc(valOf(i.n,'serial',i.dev)));
  unique('name',x=>lc(x.p.name),i=>lc(i.name));
  for(const exact of[true,false])for(const x of rows){if(!open(x))continue;const key=lc(x.p.name),m=x.p.mount,t=key?null:x.p.eq?.type||(x.p.eq?Racks.typeFor(x.p.eq.fam,1):x.p.guess?.type),fam=t?Racks.family(t):'',fm=t?Racks.mountOf(t):null;
    if(!key&&!fam||(x.p.u!=null&&m!=='roof'&&fm!=='roof')!==exact)continue;
    const hit=[...info.values()].find(i=>{const c=i.cur;if(taken.has(i.n.id)||exact&&c.u!==x.p.u)return false;if(key)return lc(i.name)===key&&(!m||m===c.mount);
      return i.fam===fam&&(fm==='roof'?c.mount==='roof':fm==='side'?isSide(c.mount)&&(!isSide(m)||c.mount===m):c.mount==='u')});
    if(hit)match(x,hit.n.id,key?'name':'position')}
  for(const x of rows)if(x.kind==='new'&&x.p.rowId&&!x.noMatch)x.notes.push('Row ID not found in the drawing — added as a new unit');
  // 2. the rack itself, from the About tab of a workbook exported from this rack
  const ab=o.about,rack=[],rackProblems=[],mine=!!ab?.id&&!o.newRack&&ab.id===r.id,mismatch=ab?.id&&!o.newRack&&ab.id!==r.id?{id:ab.id,name:ab.name||'',drawing:ab.drawing||'',text:`This spreadsheet was exported from “${ab.name||'another rack'}”${ab.drawing?` (${ab.drawing})`:''}. You are importing into “${rname}”.`}:null;
  let aboutH=null;
  if(mine&&o.rackChanges!==false){const l=r.labels?.[0],tm=/\{\{\s*([\w.]+)\s*\}\}/.exec(first(l?.text));if(has(ab.name)&&ab.name!==nm(r)){if(tm||!l)rackProblems.push(`Rack name comes from {{${tm?.[1]||'name'}}} — not changed`);else rack.push({key:'name',label:'Name',from:nm(r),to:ab.name,text:`Name ${nm(r)} → ${ab.name}`})}
    const hu=parseNum(ab.units);if(Number.isInteger(hu)&&hu>=1&&hu!==H0)aboutH=hu;
    for(const[k,lb,u]of[['width','Width','mm'],['depth','Depth','mm'],['powerBudget','Power budget','W'],['voltage','Voltage','V']]){if(!(k in ab))continue;const raw=tidy(ab[k]),cur=r.data?.[k];if(tidy(cur)===raw)continue;const v=raw?parseNum(raw):'';
      if(raw&&!Number.isFinite(v)){rackProblems.push(`${lb} “${raw}” is not a number — not changed`);continue}if(has(cur)?v!==''&&parseNum(cur)===v:v==='')continue;rack.push({key:k,label:lb,from:has(cur)?cur:'',to:v,text:`${lb} ${has(cur)?cur:'—'} → ${v===''?'—':v} ${u}`})}}
  const base=aboutH||H0;let H=+o.growTo>0?Math.round(+o.growTo):base;
  // 3. what each row asks for: equipment type, mount, U and height
  // Picture names repeat, so a name alone may not say which: the unit a row's Row ID points at, while the row still names it; else the only picture of that name this drawing uses, else the only one known here. Several: the user picks.
  const artHere=doc?.pages?Racks.artTypes(doc.pages.flatMap(p=>p.items)):[],artNamed=name=>{const is=t=>lc(Shapes.rackItems[t].name)===lc(name),here=artHere.filter(is);return here.length?here:Object.keys(Shapes.rackItems).filter(t=>Shapes.rackItems[t].face==='art'&&is(t))};
  for(const x of rows){const p=x.p,i=x.id?info.get(x.id):null,n=i?.n,cur=i?.cur,ov=!n&&Shapes.rackItems[o.types?.[x.line]]?o.types[x.line]:null,by=!n&&p.rowId&&p.eq?env.find?.(p.rowId):null;let t0,pic=by&&Racks.isArtUnit(by)&&lc(Racks.family(by.type))===lc(p.eq.fam)?by.type:null;
    if(!ov&&!pic&&p.eq?.art==='name'&&Racks.family(n?.type)!==p.eq.fam){const c=artNamed(p.eq.fam);if(c.length===1)pic=c[0];else if(n){pic=n.type;x.problems.push(`Several pictures are called “${p.eq.fam}” — equipment not changed`)}else{x.pickArt=true;x.problems.push(`Several pictures are called “${p.eq.fam}” — choose one under Equipment, or this row is skipped`)}}
    if(ov)t0=ov;else if(pic)t0=pic;else if(p.eq)t0=p.eq.type||Racks.typeFor(p.eq.fam,1);else if(p.eqText){t0=p.guess.type;x.guessed=true}else if(n)t0=n.type;else{t0=isSide(p.mount)?'rk-vpdu':p.mount==='roof'?'rk-rooffan':p.guess.type;x.guessed=true}
    const fam=Racks.family(t0),fm=Racks.mountOf(t0),keep=n&&Racks.family(n.type)===fam;x.fam=fam;
    if(p.uBad&&n)x.problems.push(`U “${p.uBad}” is not a whole number — position kept`);
    if(fm==='u'){if(isSide(p.mount))x.notes.push(`${art(fam)} can't go in a side channel — treated as Rack U`);else if(p.mount==='roof')x.notes.push(`${art(fam)} can't go on the roof — treated as Rack U`);
      const h=p.h==='full'?H:p.h??p.spanH??(cur?.mount==='u'?cur.h:Shapes.rackItems[t0].u||1);
      x.type=ov||pic||(keep?n.type:p.eq?.type&&Shapes.rackItems[p.eq.type].u===h?p.eq.type:Racks.typeFor(fam,h)||t0);x.want={mount:'u',u:p.u??(cur?.mount==='u'?cur.u:null),h}}
    else if(fm==='side'){const cs=isSide(cur?.mount)?cur.mount:null,side=isSide(p.mount)?p.mount:cs||'left';if(p.mount&&!isSide(p.mount))x.notes.push(`${fam} goes in a side channel — mount set to ${MOUNTS[side]}`);
      // full height follows the rack: "full", a blank length on a new or loose PDU, or a full-height PDU still as long as
      // the rack was when the spreadsheet was made (it may have grown or shrunk since): the unbroken run of rows, or up to
      // the highest exported row
      const hh=p.h??p.spanH,full=p.h==='full'||(hh==null?!cs||!!n?.fullHeight:!!cs&&!!n?.fullHeight&&(hh===H0||hh===tops[0]||tops[1]>0&&hh>=tops[1])&&(p.u==null||p.u===1)),len=full?H:hh??cur.h;
      x.type=keep?n.type:t0;x.want={mount:side,u:p.u??(cs?cur.u:null),h:len,full}}
    else{if(p.mount&&p.mount!=='roof')x.notes.push(`${fam} goes on the roof — mount set to Roof`);x.type=keep?n.type:t0;x.want={mount:'roof'};x.fans=p.fans??(n?Racks.fansOf(n):4)}
    if(p.uBad&&!n)x.want.bad=`U “${p.uBad}” is not a whole number`;
    if(!x.name)x.name=n?i.name:'';
    if(n&&x.on&&Racks.isLocked(n,r)&&!o.alsoLocked){x.fixed=x.locked=true;const mc=Racks.mountOf(x.type)!==Racks.mountOf(n.type),w={...x.want,h:x.want.full?H:x.want.h};delete w.full;
      if(mc||!samePlace(atH(i,H),w)){x.lockedMove=true;x.problems.push(`Locked at ${posText(atH(i,H))} — data updated, position kept`);if(mc){x.type=n.type;x.fam=i.fam}}}
    if(n&&!x.on)x.fixed=true}
  // 4. new rows linked to drawing devices of the same name (exactly, else ignoring case — then the device takes the row's spelling)
  const linked=new Map();
  if(o.linkByName)for(const x of rows){if(x.kind!=='new'||!x.p.name||!x.on)continue;const ds=env.devices||[],ex=ds.filter(d=>nm(d.n)===x.p.name),c=ex.length?ex:ds.filter(d=>lc(nm(d.n))===lc(x.p.name));if(c.length!==1){if(c.length>1)x.notes.push(`${c.length} drawing devices are named ${x.p.name} — added unlinked`);continue}
    const d=c[0].n,u=env.unitOf?.(d);if(u){const rk=rackOfAny(u,env);x.notes.push(`${nm(d)} is already in ${rk?`${nm(rk)} · ${Racks.position(rk,u)}`:'a rack'} — added unlinked`);continue}
    if(linked.has(d.id)){x.notes.push(`${nm(d)} is already linked by row ${linked.get(d.id).line} — added unlinked`);continue}linked.set(d.id,x);x.link={id:d.id,name:nm(d),page:pageName(d,env)}}
  // 5. name, field, equipment and fan changes. An empty cell clears a value only on a row that came from an export
  // (matched by Row ID); on rows typed in, empty means "not filled in".
  const renames=[];
  // A new first label line on tl — the unit's, or the linked device's (dv) when the unit shows {{asset}}; other templates stay.
  const rename=(x,from,to,tl,dv,check)=>{const tm=check&&/\{\{\s*([\w.]+)\s*\}\}/.exec(first(tl?.text));if(!tl)return x.problems.push('This unit has no name label — name not changed');if(tm)return x.problems.push(`Name comes from {{${tm[1]}}} — not changed`);
    const pn=dv?pageName(dv,env):'',ch={kind:'name',label:'Name',from,to,target:dv?'device':'unit',device:dv?.id,text:`Name: ${from||'(empty)'} → ${to}${dv?` — renames the linked device${pn?` on “${pn}”`:''}`:''}`};
    if(dv)renames.push({id:dv.id,from,to,applied:!!o.updateLinked});(dv&&!o.updateLinked?x.skipped:x.changes).push(ch)};
  const fields=(x,n,dev)=>{for(const[k,raw0]of Object.entries(x.p.values||{})){const raw=tidy(raw0),num=isNum(doc,k),lb=labelOf(doc,k),mine=n?.data?.[k],theirs=dev?.data?.[k],cur=has(mine)?mine:has(theirs)?theirs:'';if(tidy(cur)===raw)continue;let to=raw;
    if(num&&raw){const v=parseNum(raw);if(!Number.isFinite(v)){x.problems.push(`${lb} “${raw}” is not a number — not changed`);continue}if(has(cur)&&parseNum(cur)===v)continue;to=v}if(to===''&&x.how!=='Row ID')continue;
    const target=k==='depth'||!dev||has(mine)?'unit':'device',also=to===''&&has(mine)&&has(theirs),ch={kind:'field',key:k,label:lb,from:cur,to,target,also,text:`${lb}: ${show(cur)} → ${show(to)}${target==='device'?' (linked device)':also?' (also on the linked device)':''}`};
    ((target==='device'||also)&&!o.updateLinked?x.skipped:x.changes).push(ch)}};
  for(const x of rows){if(!x.on)continue;const i=x.id?info.get(x.id):null,n=i?.n;if(!n){const d=x.link?env.find?.(x.link.id):null;if(d&&x.link.name!==x.p.name)rename(x,x.link.name,x.p.name,d.labels?.[0],d,true);fields(x,null,d);continue}
    if(x.p.name&&x.p.name!==i.name){const l=n.labels?.[0],asset=/^\{\{\s*asset\s*\}\}$/.test(first(l?.text).trim()),dv=asset?i.dev:null;rename(x,i.name,x.p.name,dv?dv.labels?.[0]:l,dv,!!dv||!asset)}
    if(x.type!==n.type&&Racks.family(x.type)!==i.fam){const tray=x.type==='rk-rooffan',to=Racks.family(x.type)+(tray?` (${fansTxt(x.fans)})`:'');x.changes.push({kind:'type',label:'Equipment',from:i.fam,to,type:x.type,fans:tray?x.fans:undefined,text:`Equipment: ${i.fam} → ${to}`})}
    if(x.type==='rk-rooffan'&&n.type==='rk-rooffan'&&x.fans!==Racks.fansOf(n))x.changes.push({kind:'fans',label:'Fans',from:Racks.fansOf(n),to:x.fans,text:`Fans: ${Racks.fansOf(n)} → ${x.fans}`});
    fields(x,n,i.dev)}
  // 6. layout: every row's target first — units that stay put (only a lower top can flag them), then moves (so swaps never
  // clash), then new rows, each against what is fixed and what earlier rows took — then the conflicts are resolved from
  // what is left, existing units before new rows
  const missing=[...info.values()].filter(i=>!taken.has(i.n.id)),fixed=[...(o.removeMissing?[]:missing.map(i=>({i,line:null}))),...rows.filter(x=>x.fixed).map(x=>({i:info.get(x.id),line:x.line}))];
  const layout=H=>{const occ={u:new Map(),left:new Map(),right:new Map(),roof:null},at=i=>atH(i,H);let blocker=null;
    const clash=p=>{if(p.mount==='roof')return occ.roof?{who:occ.roof}:null;if(!mounted(p.mount))return null;if(p.u==null)return{none:true};if(p.u<1||p.h<1||p.u+p.h-1>H)return{range:true};const m=occ[p.mount];for(let k=0;k<p.h;k++)if(m.has(p.u+k))return{who:m.get(p.u+k)};return null};
    const claim=(p,who)=>{if(p.mount==='roof')occ.roof??=who;else if(mounted(p.mount))for(let k=0;k<p.h;k++)if(!occ[p.mount].has(p.u+k))occ[p.mount].set(p.u+k,who)};
    for(const f of fixed){const p=at(f.i);claim(p,{name:f.i.name,line:f.line});if(!blocker&&H<H0&&mounted(p.mount)&&p.u+p.h-1>H)blocker=`${f.i.name||Shapes.nameOf(f.i.n.type)} ${isSide(p.mount)?'reaches':'is at'} U${p.u+p.h-1} — ${isSide(p.mount)?'shorten it':'move it down'} first.`}
    const runs=(m,h)=>{const c=[];if(h>=1)for(let u=1;u+h-1<=H;u++)if(!clash({mount:m,u,h}))c.push(u);return c};
    const near=w=>{if(!mounted(w.mount))return null;for(const m of isSide(w.mount)?[w.mount,w.mount==='left'?'right':'left']:[w.mount]){const c=runs(m,w.h),to=w.u??(m==='u'?H:1);if(c.length)return{mount:m,u:c.sort((a,b)=>Math.abs(a-to)-Math.abs(b-to)||(m==='u'?b-a:a-b))[0],h:w.h}}return null};
    for(const x of rows){x.place=null;x.conflict=null;x.keepType=false}
    const act=rows.filter(x=>x.on&&!x.fixed&&!x.pickArt),W=new Map(act.map(x=>{const w={...x.want};delete w.bad;delete w.full;if(x.want.full)w.h=H;return[x,w]})),stay=new Set(act.filter(x=>x.kind==='match'&&samePlace(at(info.get(x.id)),W.get(x)))),pend=[];
    for(const x of[...act.filter(x=>stay.has(x)),...act.filter(x=>x.kind==='match'&&!stay.has(x)),...act.filter(x=>x.kind==='new')]){const w=W.get(x);
      if(mounted(w.mount)&&w.u==null&&!x.want.bad){const c=runs(w.mount,w.h);if(c.length)w.u=w.mount==='u'?c.at(-1):c[0]}
      const c=x.want.bad?{bad:x.want.bad}:stay.has(x)?(mounted(w.mount)&&w.u+w.h-1>H?{range:true}:null):clash(w);if(c)pend.push([x,w,c]);else{x.place=w;claim(w,{name:x.name||x.fam,line:x.line})}}
    for(const[x,w,c]of pend.sort((a,b)=>(a[0].kind==='new')-(b[0].kind==='new')||a[0].line-b[0].line)){const i=x.id?info.get(x.id):null,choices=[];
      // keeping a unit whose equipment would change mount (U ↔ 0U ↔ roof) keeps its equipment too
      if(i){const k=at(i),mc=Racks.mountOf(x.type)!==Racks.mountOf(i.n.type);if(!clash(k))choices.push({v:'keep',text:(mounted(k.mount)||k.mount==='roof'?`Keep at ${posText(k)}`:'Leave it where it is')+(mc?` (stays ${art(i.fam).replace(/^A/,'a')})`:''),p:k,keepType:mc})}else choices.push({v:'skip',text:'Skip',p:null});
      const nr=near(w);if(nr)choices.push({v:'near',text:`Put at ${posText(nr)} (nearest free)`,p:nr});choices.push({v:'park',text:'Park beside the rack',p:{mount:'park'}});
      const pick=choices.find(q=>q.v===o.resolve?.[x.line])||choices[0],pos=posText(w);x.keepType=!!pick.keepType;
      x.conflict={text:c.bad||(c.none?(isSide(w.mount)?`No room for a ${w.h}U PDU on the ${w.mount} side`:`No free ${w.h}U space in ${rname}`):c.range?`${pos} is ${w.u<1?'below U1':`above the top of the ${H}U rack`}`:w.mount==='roof'?`${rname} already has a roof fan tray${c.who.line?` (row ${c.who.line})`:''}`:`${pos} overlaps ${c.who.name||'a unit'}${c.who.line?` (row ${c.who.line})`:''}`),
        options:choices.map(({v,text})=>({v,text})),choice:pick.v};x.place=pick.p;if(pick.p)claim(pick.p,{name:x.name||x.fam,line:x.line})}
    return{blocker}};
  let L=layout(H);if(H<H0&&L.blocker){rackProblems.push(L.blocker);H=H0;L=layout(H)}
  // 7. rack height, frame and what each row ends up doing
  let need=0;for(const x of rows)if(x.on&&!x.fixed&&mounted(x.want.mount)&&x.want.u!=null&&!x.want.full)need=Math.max(need,x.want.u+x.want.h-1);
  const grow=need>base?{need,suggest:HEIGHTS.find(h=>h>=need)||need,on:H>=need}:null;if(H!==H0)rack.unshift({key:'units',label:'Height',from:H0,to:H,text:`Height ${H0}U → ${H}U`});
  const frame={};for(const x of rows){if(isSide(x.place?.mount)&&!r.sides)frame.sides=true;if(x.place?.mount==='roof'&&!r.roof)frame.roof=true}
  const names=new Set([...info.values()].filter(i=>!o.removeMissing||taken.has(i.n.id)).map(i=>i.name.toLowerCase()));for(const x of rows)if(x.p.name)names.add(x.p.name.toLowerCase());
  for(const x of rows){const i=x.id?info.get(x.id):null,fz=x.fans??(i?.n.type==='rk-rooffan'?Racks.fansOf(i.n):0);if(x.keepType){x.type=i.n.type;x.fam=i.fam;x.changes=x.changes.filter(c=>c.kind!=='type')}
    x.position=x.place?posText(x.place,fz):x.fixed&&i?posText(atH(i,H),fz):'Skipped';
    if(x.kind==='new'){if(x.on&&x.place&&!x.p.name&&x.type==='rk-vpdu'){const k=isSide(x.place.mount)?x.place.mount:x.want.mount,b=`PDU ${k==='right'?'B':'A'}`;let nmx=b;for(let j=2;names.has(nmx.toLowerCase());j++)nmx=b+j;names.add(nmx.toLowerCase());x.newName=nmx;x.name=nmx}
      x.status=!x.on?'off':x.place?'new':'skip';x.what=x.status==='new'?['New'+(x.link?` · links to ${x.link.name}${x.link.page?` (${x.link.page})`:''}`:''),...x.changes.map(c=>c.text)].join(' · '):'';continue}
    const cur=i.cur,p=x.place;
    if(x.on&&p&&!x.fixed){x.moved=p.mount==='park'||p.mount!==cur.mount||mounted(p.mount)&&p.u!==cur.u;x.resized=mounted(p.mount)&&mounted(cur.mount)&&p.h!==atH(i,H).h;
      if(x.resized)x.changes.unshift({kind:'height',label:isSide(p.mount)?'Length':'Height',from:cur.h,to:p.h,text:`${isSide(p.mount)?'Length':'Height'}: ${cur.h}U → ${p.h}U`});
      if(x.moved)x.changes.unshift({kind:'move',label:'Position',from:posText(cur),to:posText(p),text:p.mount==='park'?`Parked beside the rack (was ${posText(cur)})`:mounted(cur.mount)||cur.mount==='roof'?`Moved from ${posText(cur)}`:`Mounted (was ${posText(cur)})`})}
    x.updated=x.on&&x.changes.some(c=>c.kind!=='move'&&c.kind!=='height'||c.kind==='height'&&!x.moved);x.status=!x.on?'off':x.moved?'move':x.changes.length?'update':'same';x.what=x.on?x.changes.map(c=>c.text).join(' · '):''}
  // 8. units not in the spreadsheet, totals
  const miss=missing.map(i=>({id:i.n.id,name:i.name||Shapes.nameOf(i.n.type),where:posText(atH(i,H),i.n.type==='rk-rooffan'?Racks.fansOf(i.n):0)})),remove=o.removeMissing?miss.map(m=>m.id):[];
  const counts={same:rows.filter(x=>x.status==='same').length,add:rows.filter(x=>x.status==='new').length,update:rows.filter(x=>x.updated).length,move:rows.filter(x=>x.moved).length,skip:rows.filter(x=>x.status==='skip'||x.status==='off').length,missing:miss.length,remove:remove.length};
  const total=counts.add+rows.filter(x=>x.status==='move'||x.status==='update').length+remove.length+(rack.length?1:0),pending=rows.some(x=>x.on&&(x.conflict||x.problems.length||x.skipped.length))||rackProblems.length>0;
  return{rack:r.id,units:H,rows,missing:miss,missingMany:own.length>0&&miss.length>own.length/2,remove,grow,frame:frame.sides||frame.roof?frame:null,rackChanges:rack,rackText:rack.length?'Rack: '+rack.map(c=>c.text).join(' · '):'',rackProblems,mismatch,
    renames,lockedMoves:rows.filter(x=>x.lockedMove).length,linkedChanges:rows.reduce((s,x)=>s+[...x.changes,...x.skipped].filter(c=>c.target==='device'||c.also).length,0),matchedBy:how,notes,ignored:Array.isArray(src)?[]:src?.ignored||[],counts,changes:total,empty:total===0&&!pending}}

// ---------- apply ----------
// Carry out a plan on rack r and its page — call it inside one undo step. It only changes r, page.items and the linked
// devices it writes to; the caller re-routes links (frame.moved), makes room (frame.band, units.dy) and syncs `pages`.
// env.setFrame(r, flags) and env.removeItems(page, ids) replace the plain Racks.setFrame / removal when given.
function apply(P,r,page,env={}){let items=page.items;if(!items.includes(r))items.push(r);const nm=namer(env),H=P.units||unitsOf(r),H0=unitsOf(r),byId=id=>page.items.find(n=>n.id===id),pagesT=new Set();
  const out={ids:[],added:[],updated:[],moved:[],removed:[],devices:[],pages:[],frame:null,units:null,summary:''},write=(t,k,v)=>{t.data??={};if(v===''||v==null)delete t.data[k];else t.data[k]=v};
  const dev=id=>{const d=env.find?.(id);if(d){if(!out.devices.includes(d.id))out.devices.push(d.id);const p=pageOf(d,env);if(p&&typeof p==='object'&&p!==page)pagesT.add(p)}return d};
  // rack changes, then the height when it grows (so new top U exist), then the side channels and roof
  let data=false;for(const c of P.rackChanges||[]){if(c.key==='name'){const l=r.labels?.[0];if(l)l.text=setFirst(l.text,c.to)}else if(c.key!=='units'){write(r,c.key,c.to);data=true}}if(data)Racks.resize(r);
  const y0=r.y;if(H>H0)out.units={...Racks.setUnits(r,H,items),from:H0,to:H};
  if(P.frame)out.frame=env.setFrame?env.setFrame(r,{...P.frame}):Racks.setFrame(r,items,{...P.frame},{margin:env.margin||0});
  if(P.remove?.length){if(env.removeItems)env.removeItems(page,P.remove);else removeItems(page,P.remove);items=page.items;out.removed=[...P.remove]}
  // equipment that changed mount: no rear label on 0U items, fullHeight only on a side PDU; parked, it takes the new type's
  // own size and label (placed, placeAt / placeSide / placeRoof do that)
  const retype=(n,was)=>{const m=Racks.mountOf(n);if(m===was)return;if(m!=='u'&&n.labels)n.labels=n.labels.filter(l=>l.view!=='rear');if(m!=='side')delete n.fullHeight};
  const reshape=(n,hU)=>{const t=Shapes.rackItems[n.type],m=Racks.mountOf(n),l=n.labels?.[0],sz=l?.size||8.5;n.w=t.w||Shapes.RACK.inner;n.h=m==='roof'?t.h:Math.max(1,hU||t.u||1)*RU();if(!l||l.anchor)return;
    l.rotation=m==='side'?-90:0;l.align=m==='side'?'middle':'start';l.x=n.x+(m==='side'?8+sz*.36:m==='roof'?6:12);l.y=n.y+n.h/2+(m==='side'?0:sz*.36)};
  const put=(n,p,was)=>{if(p.mount==='u'){const l=n.labels?.[0];if(was!=='u'&&l&&!l.anchor)l.rotation=0;n.h=p.h*RU();Racks.placeAt(r,n,p.u)}else if(isSide(p.mount))Racks.placeSide(r,n,p.mount,p.u,p.h);else if(p.mount==='roof')Racks.placeRoof(r,n)};
  const parked=[],sides=[];
  for(const x of P.rows){if(!x.on)continue;let n;
    if(x.kind==='match'){n=byId(x.id);if(!n)continue;const was=Racks.mountOf(n),ty=x.changes.find(c=>c.kind==='type');if(ty){n.type=ty.type;if(ty.fans)write(n,'fans',ty.fans);retype(n,was);if(Shapes.rackItems[ty.type]?.face!=='art'){delete n.artFit;if(n.inset){delete n.inset;if(Racks.isU(n))Racks.placeAt(r,n,Racks.uOf(r,n))}}}
      if(x.place&&!x.fixed&&(x.moved||x.resized||was!==Racks.mountOf(n))){if(x.place.mount==='park'){if(was!==Racks.mountOf(n))reshape(n,x.want.h);parked.push(n)}else{put(n,x.place,was);if(isSide(x.place.mount))sides.push([n,x.place])}}
      if(x.moved)out.moved.push(n.id);if(x.updated)out.updated.push(n.id)}
    else{if(!x.place)continue;n=Shapes.make(x.type,0,0,x.link?'{{asset}}':x.newName||x.p.name||undefined);const ly=r.layer||env.layer;if(ly)n.layer=ly;if(x.link)n.ref=x.link.id;if(x.type==='rk-rooffan')n.data.fans=x.fans;items.push(n);out.added.push(n.id);
      if(x.place.mount==='park'){if(Racks.mountOf(n)==='u'){n.h=x.want.h*RU();const l=n.labels[0];l.y=n.y+n.h/2+l.size*.36}parked.push(n)}else{put(n,x.place,Racks.mountOf(n));if(isSide(x.place.mount))sides.push([n,x.place])}}
    for(const c of x.changes){if(c.kind==='name'){const t=c.target==='device'?dev(c.device):n,l=t?.labels?.[0];if(l)l.text=setFirst(l.text,c.to)}else if(c.kind==='fans')write(n,'fans',c.to);
      else if(c.kind==='field'){const d=n.ref&&(c.target==='device'||c.also)?dev(n.ref):null;write(c.target==='device'&&d?d:n,c.key,c.to);if(c.also&&d)write(d,c.key,'')}}}
  // parked units stack down beside the rack; a smaller rack once everything is below its new top (the floor stays)
  let py=r.y+(H<H0?(H0-H)*RU():0)+30;const px=r.x+r.w+40;for(const n of parked){C.move(n,px-n.x,py-n.y);py+=n.h+12}
  if(H<H0)out.units={...Racks.setUnits(r,H,page.items),from:H0,to:H};if(out.units)out.units.dy=r.y-y0;
  for(const[n,p]of sides){if(p.h>=H)n.fullHeight=true;else delete n.fullHeight}
  out.pages=[...pagesT];out.ids=[...new Set([...out.added,...out.updated,...out.moved])];
  const parts=[out.added.length&&`${out.added.length} added`,out.updated.length&&`${out.updated.length} updated`,out.moved.length&&`${out.moved.length} moved`,out.removed.length&&`${out.removed.length} removed`,P.rackChanges?.length&&`${nm(r)||'rack'} ${P.rackChanges.map(c=>c.label.toLowerCase()).join(', ')} changed`].filter(Boolean);
  out.summary=parts.join(', ')||'nothing changed';return out}
// Delete units (and the links that end on them) — the same as erasing them in the editor.
function removeItems(page,ids){const gone=new Set(ids);for(const e of page.items)if(e.kind==='edge'&&(e.from&&gone.has(e.from.node)||e.to&&gone.has(e.to.node)))gone.add(e.id);page.items=page.items.filter(n=>!gone.has(n.id));for(const t of page.items)if(t.target&&gone.has(t.target))delete t.target}

return{columns,exportTable,blankTable,toXlsx,toCSV,parseCSV,fromRows,about,read,isRackTable,plan,apply,parseNum,parseU,parseH,parseMount,parseEquipment,norm,MOUNTS,HEIGHTS};
})();
if(typeof module!=='undefined')module.exports=RackSheet;
