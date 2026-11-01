// Excel workbook writer / reader used by the rack sheet round-trip.
const test=require('node:test'),assert=require('node:assert'),fs=require('fs'),path=require('path'),vm=require('vm'),zlib=require('zlib');
const VsdxWriter=require('../js/vsdx.js');
const ctx={VsdxWriter,TextDecoder,TextEncoder,Uint8Array,DataView,Map,Response,Blob,DecompressionStream,String,Math,Array,Object,Error,JSON,Number,isFinite,parseInt,Date,console};vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/xlsx.js'),'utf8').replace(/^const Xlsx=/m,'var Xlsx='),ctx);const Xlsx=ctx.Xlsx;

test('a workbook round-trips text, numbers, blanks and awkward characters',async()=>{
  const rows=[['U','Name','Power (W)','Notes'],[42,'core-sw-01 <A&B>',150,''],[40,'',null,'line 1\nline 2'],['',"O'Brien \"rack\"",0,'=SUM(A1)']];
  const bytes=Xlsx.build([{name:'Rack',rows,header:true,freeze:1,filter:true,widths:[6,24,10,30],lists:[{range:'B2:B50',source:'Lists!$A$1:$A$3'},{range:'D2:D50',values:['a','b']}]},{name:'Lists',hidden:true,rows:[['Server 1U'],['Switch 1U'],['PDU']]}]);
  assert.ok(Xlsx.isXlsx(bytes));const book=await Xlsx.read(bytes);
  assert.deepEqual(book.map(s=>[s.name,s.hidden]),[['Rack',false],['Lists',true]]);
  assert.deepEqual(book[0].rows,[['U','Name','Power (W)','Notes'],['42','core-sw-01 <A&B>','150'],['40','','','line 1\nline 2'],['',"O'Brien \"rack\"",'0','=SUM(A1)']]);
  assert.deepEqual(book[1].rows.map(r=>r[0]),['Server 1U','Switch 1U','PDU']);
  const sheet=new TextDecoder().decode(bytes);assert.ok(sheet.includes('<pane ySplit="1"'),'header row is frozen');assert.ok(sheet.includes('<dataValidation type="list"'),'drop-down lists are written');assert.ok(!sheet.includes('<f>'),'text starting with = stays text')});

// What Excel / Numbers / LibreOffice save: deflated parts, shared strings, sparse cells, rich text runs.
function deflatedZip(files){const parts=[],central=[];let off=0;
  for(const[name,text]of Object.entries(files)){const nb=Buffer.from(name),raw=Buffer.from(text),data=zlib.deflateRawSync(raw),crc=VsdxWriter.crc32(new Uint8Array(raw));
    const lh=Buffer.alloc(30);lh.writeUInt32LE(0x04034b50,0);lh.writeUInt16LE(20,4);lh.writeUInt16LE(8,8);lh.writeUInt32LE(crc>>>0,14);lh.writeUInt32LE(data.length,18);lh.writeUInt32LE(raw.length,22);lh.writeUInt16LE(nb.length,26);
    const ch=Buffer.alloc(46);ch.writeUInt32LE(0x02014b50,0);ch.writeUInt16LE(20,4);ch.writeUInt16LE(20,6);ch.writeUInt16LE(8,10);ch.writeUInt32LE(crc>>>0,16);ch.writeUInt32LE(data.length,20);ch.writeUInt32LE(raw.length,24);ch.writeUInt16LE(nb.length,28);ch.writeUInt32LE(off,42);
    parts.push(lh,nb,data);central.push(ch,nb);off+=30+nb.length+data.length}
  const cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(central.length/2,8);end.writeUInt16LE(central.length/2,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(off,16);
  return new Uint8Array(Buffer.concat([...parts,cd,end]))}
test('reads Excel-style files: shared strings, rich text, sparse cells and booleans',async()=>{
  const bytes=deflatedZip({
    'xl/workbook.xml':'<workbook xmlns:r="r"><sheets><sheet name="Rack sheet" sheetId="1" r:id="rId7"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId7" Type="t" Target="/xl/worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml':'<sst><si><t>Name</t></si><si><r><t>edge</t></r><r><rPr><b/></rPr><t xml:space="preserve">-fw &amp; 01</t></r></si><si><t/></si></sst>',
    'xl/worksheets/sheet1.xml':'<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>Power</t></is></c></row><row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3" t="b"><v>1</v></c><c r="C3"><v>350.5</v></c><c r="D3" t="s"><v>2</v></c></row></sheetData></worksheet>'});
  const[s]=await Xlsx.read(bytes);assert.equal(s.name,'Rack sheet');assert.deepEqual(s.rows,[['Name','','Power'],[],['edge-fw & 01','TRUE','350.5','']])});

test('column letters',()=>{assert.equal(Xlsx.colName(0),'A');assert.equal(Xlsx.colName(25),'Z');assert.equal(Xlsx.colName(26),'AA');assert.equal(Xlsx.colIndex('AB12'),27);assert.equal(Xlsx.colIndex('c3'),2)});
test('a file that is not a workbook is refused clearly',async()=>{await assert.rejects(()=>Xlsx.read(new TextEncoder().encode('name,u\nx,1')),/not an Excel workbook/)});

test('text-format columns: numFmt 49 on the cells and the whole column, numbers there written as text',async()=>{
  const bytes=Xlsx.build([{name:'Rack',header:true,widths:[8,18,30],muted:[2],text:[1,2],rows:[['U','Serial no.','Row ID'],[42,'0012345','id-1'],[41,12345,''],[40,'',{v:'x',style:'muted'}]]}]),zip=new TextDecoder().decode(bytes);
  const sheet=/<worksheet[\s\S]*?<\/worksheet>/.exec(zip)[0],styles=/<styleSheet[\s\S]*?<\/styleSheet>/.exec(zip)[0];
  assert.ok(styles.includes('<cellXfs count="6">'));assert.ok(/<xf numFmtId="49" fontId="0"[^>]*applyNumberFormat="1"\/>/.test(styles),'text');assert.ok(/<xf numFmtId="49" fontId="2"[^>]*applyNumberFormat="1"[^>]*\/>/.test(styles),'grey text');
  assert.ok(sheet.includes('<col min="2" max="2" width="18" customWidth="1" style="4"/>'),'typed values stay text');assert.ok(sheet.includes('<col min="3" max="3" width="30" customWidth="1" style="5"/>'));assert.ok(sheet.includes('<col min="1" max="1" width="8" customWidth="1"/>'));
  assert.ok(sheet.includes('<c r="B2" s="4" t="inlineStr"><is><t xml:space="preserve">0012345</t>'));assert.ok(sheet.includes('<c r="B3" s="4" t="inlineStr"><is><t xml:space="preserve">12345</t>'),'a number in a text column is text');
  assert.ok(sheet.includes('<c r="C2" s="5" t="inlineStr">'));assert.ok(sheet.includes('<c r="C4" s="5" t="inlineStr">'),'muted style in a text column is grey text');assert.ok(sheet.includes('<c r="A2"><v>42</v></c>'));
  assert.ok(sheet.includes('<c r="B1" s="1" t="inlineStr">'),'the header stays bold');assert.ok(!sheet.includes('r="B4"'),'empty text cells are left to the column style');
  const[s]=await Xlsx.read(bytes);assert.deepEqual(s.rows,[['U','Serial no.','Row ID'],['42','0012345','id-1'],['41','12345'],['40','','x']]);
  const cols=Xlsx.build([{name:'T',text:[3],rows:[['a']]}]);assert.ok(new TextDecoder().decode(cols).includes('<col min="4" max="4" width="10" customWidth="1" style="4"/>'),'a text column without a width still gets one')});

test('whole-number validations: a warning between min and max; lists stay non-strict',()=>{
  const bytes=Xlsx.build([{name:'Rack',rows:[['U']],lists:[{range:'C2:C500',values:['Rack U','0U left','0U right','Roof']}],numbers:[{range:'A2:A500',min:1,max:42,error:'Enter a whole number from 1 to 42 & <no> more.'},{range:'B2:B500',min:1,max:42}]}]),sheet=new TextDecoder().decode(bytes);
  assert.ok(sheet.includes('<dataValidations count="3">'));assert.ok(sheet.includes('<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="0" sqref="C2:C500"><formula1>"Rack U,0U left,0U right,Roof"</formula1></dataValidation>'));
  assert.ok(sheet.includes('<dataValidation type="whole" operator="between" errorStyle="warning" allowBlank="1" showInputMessage="1" showErrorMessage="1" errorTitle="Check the value" error="Enter a whole number from 1 to 42 &amp; &lt;no&gt; more." sqref="A2:A500"><formula1>1</formula1><formula2>42</formula2></dataValidation>'));
  assert.ok(sheet.includes('<dataValidation type="whole" operator="between" errorStyle="warning" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="B2:B500"><formula1>1</formula1><formula2>42</formula2></dataValidation>'));
  const long=Xlsx.build([{name:'L',rows:[['a']],lists:[{range:'A2:A9',values:Array.from({length:60},(_,i)=>'Value & '+i)}]}]),f1=/<formula1>"([^<]*)"<\/formula1>/.exec(new TextDecoder().decode(long))[1];
  assert.ok(f1.replace(/&amp;/g,'&').length<=253,'inline lists stay under Excel’s 255 characters');assert.ok(!/&[a-z]*$/.test(f1),'never cut inside an entity')});

test('control characters go out as _xHHHH_ escapes and come back; raw CR LF in the XML reads as a line feed',async()=>{
  const vals=['a\u000Bb','c\r\nd','lit _x0041_ x','e\u0001f','tab\tok','line\nfeed'],bytes=Xlsx.build([{name:'T',rows:vals.map(v=>[v])}]),xml=/<worksheet[\s\S]*?<\/worksheet>/.exec(new TextDecoder().decode(bytes))[0];
  assert.ok(xml.includes('a_x000B_b')&&xml.includes('c_x000D_\nd')&&xml.includes('lit _x005F_x0041_ x'),'escaped the way Excel writes them');assert.ok(!xml.includes('\r'),'no raw CR in the sheet');
  assert.deepEqual((await Xlsx.read(bytes))[0].rows.map(r=>r[0]),vals);
  const ex=deflatedZip({'xl/workbook.xml':'<workbook xmlns:r="r"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml':'<sst><si><t>raw\r\nbreak</t></si><si><t>kept&#13;</t></si></sst>','xl/worksheets/sheet1.xml':'<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="str"><v>f_x000B_</v></c></row></sheetData></worksheet>'});
  assert.deepEqual((await Xlsx.read(ex))[0].rows,[['raw\nbreak','kept\r','f\u000B']])});

test('sheet names are cut to 31 characters without splitting an emoji',async()=>{const[s]=await Xlsx.read(Xlsx.build([{name:'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234🔥 tail',rows:[['a']]}]));assert.equal(s.name,'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234')});
