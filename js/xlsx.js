// Minimal Excel workbook (.xlsx) writer and reader — enough for sheets people fill in and send back: text and number
// cells, column widths, text-format columns, a bold frozen header row, a filter, drop-down lists, whole-number checks
// and hidden sheets. Reads what Excel,
// Numbers, LibreOffice and Google Sheets save (shared or inline strings, deflated parts). No dependencies beyond
// VsdxWriter.zip; works in the browser and in Node.
const Xlsx=(()=>{
const esc=s=>String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
// Cell text: control characters (CR, vertical tab…) go out as Excel's _xHHHH_ escapes, and a literal "_x0041_" keeps its
// underscore as _x005F_, so the text reads back exactly; unX undoes it on the way in.
const escT=s=>esc(String(s).replace(/_(?=x[0-9A-Fa-f]{4}_)/g,'_x005F_').replace(/[\u0000-\u0008\u000B-\u001F\uFFFE\uFFFF]/g,c=>'_x'+c.charCodeAt(0).toString(16).toUpperCase().padStart(4,'0')+'_'));
const unX=s=>s.replace(/_x([0-9A-Fa-f]{4})_/g,(_,h)=>String.fromCharCode(parseInt(h,16)));
const cut=(s,n)=>{s=String(s);if(s.length<=n)return s;s=s.slice(0,n);return/[\uD800-\uDBFF]$/.test(s)?s.slice(0,-1):s};// never half an emoji
const unesc=s=>String(s).replace(/&#x([0-9a-f]+);/gi,(_,h)=>String.fromCodePoint(parseInt(h,16))).replace(/&#(\d+);/g,(_,d)=>String.fromCodePoint(+d)).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
const colName=i=>{let s='';for(i++;i>0;i=Math.floor((i-1)/26))s=String.fromCharCode(65+(i-1)%26)+s;return s};
const colIndex=ref=>{let n=0;for(const ch of String(ref).replace(/[^A-Z]/gi,'').toUpperCase())n=n*26+ch.charCodeAt(0)-64;return n-1};
const XML='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n',NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main',R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const STYLE={header:1,muted:2,wrap:3,text:4,mutedText:5};

// sheets: [{name, rows:[[value | {v, style}]], widths:[characters], freeze:rows, filter:true, hidden:true,
//           header:true (first row bold), muted:[column indexes in grey], text:[column indexes kept as text — the cells and
//           the whole column, so values typed later keep leading zeros], lists:[{range:'D2:D300', source:'Lists!$A$1:$A$9'} |
//           {range, values:[...]}], numbers:[{range:'A2:A500', min:1, max:42, error}] (whole numbers, a warning only)}]
function build(sheets,{date}={}){
  const ws=sheets.map((s,i)=>({...s,file:`sheet${i+1}.xml`,name:cut(String(s.name||'Sheet'+(i+1)).replace(/[\\/?*[\]:]/g,' '),31)}));
  const cell=(v,r,c,s)=>{const o=v&&typeof v==='object'?v:{v},ref=colName(c)+(r+1),hd=s.header&&r===0,tx=!hd&&s.text?.includes(c);let st=o.style?STYLE[o.style]:hd?1:s.muted?.includes(c)?2:0;if(tx)st=st===2?5:st===0?4:st;const sa=st?` s="${st}"`:'';
    if(o.v==null||o.v==='')return st&&st<4?`<c r="${ref}"${sa}/>`:'';if(typeof o.v==='number'&&isFinite(o.v)&&!tx)return`<c r="${ref}"${sa}><v>${o.v}</v></c>`;if(typeof o.v==='boolean')return`<c r="${ref}"${sa} t="b"><v>${o.v?1:0}</v></c>`;
    return`<c r="${ref}"${sa} t="inlineStr"><is><t xml:space="preserve">${escT(o.v)}</t></is></c>`};
  const sheetXml=s=>{const rows=s.rows||[],ncol=Math.max(1,...rows.map(r=>r.length),(s.widths||[]).length),last=colName(ncol-1)+Math.max(1,rows.length);
    const view=s.freeze?`<sheetViews><sheetView workbookViewId="0"${s.hidden?'':' tabSelected="'+(s===ws.find(x=>!x.hidden)?1:0)+'"'}><pane ySplit="${s.freeze}" topLeftCell="A${s.freeze+1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${s.freeze+1}" sqref="A${s.freeze+1}"/></sheetView></sheetViews>`:'<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
    const nc=Math.max(s.widths?.length||0,...(s.text||[]).map(i=>i+1)),cst=i=>s.text?.includes(i)?(s.muted?.includes(i)?5:4):0;
    const cols=nc?`<cols>${Array.from({length:nc},(_,i)=>`<col min="${i+1}" max="${i+1}" width="${s.widths?.[i]||10}" customWidth="1"${cst(i)?` style="${cst(i)}"`:''}/>`).join('')}</cols>`:'';
    const data=rows.map((r,ri)=>`<row r="${ri+1}">${r.map((v,ci)=>cell(v,ri,ci,s)).join('')}</row>`).join('');
    const filter=s.filter&&rows.length?`<autoFilter ref="A1:${colName(ncol-1)}${rows.length}"/>`:'';
    const lists=[...(s.lists||[]).map(l=>`<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="${l.strict?1:0}" sqref="${l.range}"><formula1>${l.source?esc(l.source):'"'+esc(cut(l.values.join(','),253))+'"'}</formula1></dataValidation>`),
      ...(s.numbers||[]).map(l=>`<dataValidation type="whole" operator="between" errorStyle="warning" allowBlank="1" showInputMessage="1" showErrorMessage="1"${l.error?` errorTitle="Check the value" error="${esc(String(l.error).slice(0,225))}"`:''} sqref="${l.range}"><formula1>${+l.min||0}</formula1><formula2>${+l.max||0}</formula2></dataValidation>`)];
    return`${XML}<worksheet xmlns="${NS}" xmlns:r="${R}"><dimension ref="A1:${last}"/>${view}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${data}</sheetData>${filter}${lists.length?`<dataValidations count="${lists.length}">${lists.join('')}</dataValidations>`:''}<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/></worksheet>`};
  const now=(date||new Date()).toISOString().replace(/\.\d+Z$/,'Z');
  const files=[
    {name:'[Content_Types].xml',data:`${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${ws.map(s=>`<Override PartName="/xl/worksheets/${s.file}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`},
    {name:'_rels/.rels',data:`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`},
    {name:'docProps/core.xml',data:`${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>Port Network Studio</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`},
    {name:'xl/workbook.xml',data:`${XML}<workbook xmlns="${NS}" xmlns:r="${R}"><bookViews><workbookView activeTab="${Math.max(0,ws.findIndex(s=>!s.hidden))}"/></bookViews><sheets>${ws.map((s,i)=>`<sheet name="${esc(s.name)}" sheetId="${i+1}"${s.hidden?' state="hidden"':''} r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`},
    {name:'xl/_rels/workbook.xml.rels',data:`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${ws.map((s,i)=>`<Relationship Id="rId${i+1}" Type="${R}/worksheet" Target="worksheets/${s.file}"/>`).join('')}<Relationship Id="rId${ws.length+1}" Type="${R}/styles" Target="styles.xml"/></Relationships>`},
    {name:'xl/styles.xml',data:`${XML}<styleSheet xmlns="${NS}"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><sz val="11"/><color rgb="FF8A94A6"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF6"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF9AA8BC"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="49" fontId="2" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`},
    ...ws.map(s=>({name:'xl/worksheets/'+s.file,data:sheetXml(s)}))];
  return VsdxWriter.zip(files,{date})}

// ---------- reading ----------
async function unzip(bytes){const buf=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes),dv=new DataView(buf.buffer,buf.byteOffset,buf.byteLength),out=new Map();let eocd=-1;
  for(let i=buf.length-22;i>=Math.max(0,buf.length-70000);i--)if(dv.getUint32(i,true)===0x06054b50){eocd=i;break}if(eocd<0)throw Error('This is not an Excel workbook (.xlsx).');
  const dec=new TextDecoder();let p=dv.getUint32(eocd+16,true);const count=dv.getUint16(eocd+10,true);
  for(let i=0;i<count&&dv.getUint32(p,true)===0x02014b50;i++){const method=dv.getUint16(p+10,true),csize=dv.getUint32(p+20,true),nlen=dv.getUint16(p+28,true),xlen=dv.getUint16(p+30,true),clen=dv.getUint16(p+32,true),lho=dv.getUint32(p+42,true),name=dec.decode(buf.subarray(p+46,p+46+nlen));p+=46+nlen+xlen+clen;
    if(!/\.(xml|rels)$/i.test(name))continue;const start=lho+30+dv.getUint16(lho+26,true)+dv.getUint16(lho+28,true),data=buf.subarray(start,start+csize);
    if(method===0)out.set(name,dec.decode(data));else if(method===8)out.set(name,await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text())}
  return out}
const attrs=tag=>{const o={};for(const m of tag.matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g))o[m[1]]=unesc(m[2]);return o};
// as an XML parser reads it: a raw CR LF or CR is a line feed, &#13; stays a CR; then Excel's _xHHHH_ escapes
const texts=x=>[...String(x).replace(/<rPh\b[\s\S]*?<\/rPh>/g,'').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)].map(m=>unX(unesc((m[1]||'').replace(/\r\n?/g,'\n')))).join('');
// → [{name, hidden, rows:[[string]]}] in workbook order; empty cells are ''.
async function read(bytes){const parts=await unzip(bytes),wb=parts.get('xl/workbook.xml');if(!wb)throw Error('This workbook has no sheets — save it from Excel as an .xlsx workbook.');
  const rels=new Map([...(parts.get('xl/_rels/workbook.xml.rels')||'').matchAll(/<Relationship\b[^>]*>/g)].map(m=>attrs(m[0])).map(a=>[a.Id,a.Target]));
  const shared=[...(parts.get('xl/sharedStrings.xml')||'').matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)].map(m=>texts(m[1]||''));
  return[...wb.matchAll(/<sheet\b[^>]*>/g)].map(m=>attrs(m[0])).map(a=>{const t=String(rels.get(a['r:id'])||'').replace(/^\/?(xl\/)?/,''),xml=parts.get('xl/'+t)||'',rows=[];
    for(const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)){const ra=attrs(rm[1]),ri=ra.r?+ra.r-1:rows.length,row=[];let next=0;
      for(const cm of(rm[2]||'').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){const ca=attrs(cm[1]),ci=ca.r?colIndex(ca.r):next,body=cm[2]||'',v=/<v>([\s\S]*?)<\/v>/.exec(body)?.[1];next=ci+1;
        const val=ca.t==='s'?shared[+v]??'':ca.t==='inlineStr'?texts(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1]||''):ca.t==='b'?(v==='1'?'TRUE':'FALSE'):ca.t==='str'?unX(unesc((v||'').replace(/\r\n?/g,'\n'))):v!=null?unesc(v):'';row[ci]=val}
      rows[ri]=Array.from(row,x=>x??'')}
    return{name:a.name||'',hidden:a.state==='hidden'||a.state==='veryHidden',rows:Array.from(rows,r=>r||[])}})}
const isXlsx=bytes=>{const b=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);return b.length>4&&b[0]===0x50&&b[1]===0x4b};

return{build,read,isXlsx,colName,colIndex,MIME:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
})();
if(typeof module!=='undefined')module.exports=Xlsx;
