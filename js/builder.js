// Diagram generation: auto-layout (incl. zone clusters), and topology import from CSV / NetBox exports,
// a small "diagram as text" language, and Cisco CDP / LLDP neighbour output.
const Builder=(()=>{
const C=Core;
const tierOf=n=>Stencils?.shapes?.[n.type]?.tier??(n.type==='internet'||n.type==='cloud'?0:5);

// ---------- layout ----------
function effBox(n){const ls=(n.labels||[]).map(l=>C.labelMetrics(l,resolveLabel(n,l)));const lw=Math.max(n.w,...ls.map(m=>m.w+8)),below=(n.labels||[]).reduce((s,l,i)=>l.y>n.y+n.h?Math.max(s,l.y-n.y-n.h+ls[i].h):s,0),data=S.doc.display?.fields?.length?S.doc.display.fields.length*12:0;return{w:lw,h:n.h+below+data+4,dx:(lw-n.w)/2}}
function runLayout(kind,nodes,edges,opts){const L=typeof Layout!=='undefined'?Layout:null;if(!L)return null;const o={nodeSep:opts.nodeSep??60,rankSep:opts.rankSep??100,direction:opts.direction||'TB',origin:opts.origin||[0,0]};
  if(kind==='grid')return L.grid(nodes,o);if(kind==='circular')return L.circular(nodes,edges,o);if(kind==='radial')return L.radial(nodes,edges,o);if(kind==='force')return L.force(nodes,edges,o);return L.hierarchical(nodes,edges,o)}
function layoutPage(kind='hier',opts={}){
  const page=pg(),sel=picked().filter(n=>n.kind==='node'),scope=sel.length>1?sel:page.items.filter(n=>n.kind==='node');
  const nodes=scope.filter(n=>n.type!=='rack'&&!rackOf(n,page)&&!isLocked(n)&&itemVisible(n,{doc:S.doc}));if(nodes.length<2)return notify('Nothing to lay out — add at least two devices.');
  const ids=new Set(nodes.map(n=>n.id)),links=page.items.filter(e=>e.kind==='edge'&&e.from&&e.to&&ids.has(e.from.node)&&ids.has(e.to.node));
  const zones=opts.clusters===false||sel.length>1?[]:page.items.filter(z=>z.kind==='zone'&&!isLocked(z));
  mutate(()=>{
    const member=new Map();for(const n of nodes){const c=C.center(n);let best=null;for(const z of zones)if(C.inside({x:c[0],y:c[1],w:0,h:0},C.box(z))&&!zones.some(o=>o!==z&&C.inside(C.box(o),C.box(z))&&C.inside({x:c[0],y:c[1],w:0,h:0},C.box(o)))&&(!best||z.w*z.h<best.w*best.h))best=z;if(best)member.set(n.id,best)}
    const origin=opts.origin||[pg().margin*C.PX+40,pg().margin*C.PX+50];
    const blocks=[],inner=new Map();
    // lay out each zone's members, then treat the zone as one block
    for(const z of zones){const ms=nodes.filter(n=>member.get(n.id)===z);if(!ms.length)continue;const mi=new Set(ms.map(n=>n.id)),me=links.filter(e=>mi.has(e.from.node)&&mi.has(e.to.node)).map(e=>({from:e.from.node,to:e.to.node}));
      const pos=runLayout(kind,ms.map(n=>{const b=effBox(n);return{id:n.id,w:b.w,h:b.h,rank:tierOf(n),name:Analysis.nameOf(n)}}),me,{...opts,origin:[0,0],nodeSep:opts.nodeSep??44,rankSep:opts.rankSep??70});if(!pos)return;
      let x1=0,y1=0;for(const n of ms){const p=pos.get(n.id),b=effBox(n);x1=Math.max(x1,p.x+b.w);y1=Math.max(y1,p.y+b.h)}inner.set(z.id,{pos,ms});blocks.push({id:z.id,w:x1+60,h:y1+86,rank:Math.min(...ms.map(tierOf)),zone:z})}
    for(const n of nodes)if(!member.has(n.id)){const b=effBox(n);blocks.push({id:n.id,w:b.w,h:b.h,rank:tierOf(n),node:n})}
    const blockOf=id=>member.has(id)?member.get(id).id:id,be=[];const seen=new Set();for(const e of links){const a=blockOf(e.from.node),b=blockOf(e.to.node);if(a===b)continue;const k=a<b?a+b:b+a;if(seen.has(k))continue;seen.add(k);be.push({from:a,to:b})}
    const top=runLayout(blocks.length>1&&zones.length?'hier':kind,blocks.map(b=>({id:b.id,w:b.w,h:b.h,rank:b.rank})),be,{...opts,origin,nodeSep:zones.length?70:opts.nodeSep,rankSep:zones.length?90:opts.rankSep});if(!top)return notify('Layout engine not available.');
    for(const b of blocks){const p=top.get(b.id);if(!p)continue;if(b.node){const eb=effBox(b.node);C.move(b.node,grid(p.x+eb.dx)-b.node.x,grid(p.y)-b.node.y)}else{const z=b.zone,{pos,ms}=inner.get(z.id);for(const n of ms){const q=pos.get(n.id),eb=effBox(n);C.move(n,grid(p.x+30+q.x+eb.dx)-n.x,grid(p.y+56+q.y)-n.y)}const dx=p.x-z.x,dy=p.y-z.y;z.labels.forEach(l=>{l.x+=dx;l.y+=dy});z.x=p.x;z.y=p.y;z.w=b.w;z.h=b.h}}
    for(const e of links){if(e.routing!=='straight')e.routing='auto';Conn.markDirty(e.id)}
    for(const e of page.items)if(e.kind==='edge'&&(e.from&&ids.has(e.from.node)||e.to&&ids.has(e.to.node))&&!links.includes(e))Conn.markDirty(e.id);
    if(opts.fitPage!==false)autoSizePage(page)});fit()}
// Grow the page to the smallest standard sheet (or a custom size) that holds the drawing.
function autoSizePage(page,{allowShrink=false,notify:say=true}={}){const all=page.items;if(!all.length)return;const b=C.bounds(all,true),m=page.margin*C.PX,need={w:b.x+b.w+m+20,h:b.y+b.h+m+20},cur=C.pageSize(page);if(!allowShrink&&need.w<=cur.w&&need.h<=cur.h)return;
  for(const paper of['A4','A3','A2','A1','A0'])for(const orientation of[page.orientation,page.orientation==='landscape'?'portrait':'landscape']){const s=C.pageSize({...page,paper,orientation});if(s.w>=need.w&&s.h>=need.h){if(page.paper!==paper||page.orientation!==orientation){page.paper=paper;page.orientation=orientation;if(say)notify(`Page set to ${paper} ${orientation} to fit the drawing.`)}return}}
  page.paper='Custom';page.customW=Math.ceil(need.w/C.PX);page.customH=Math.ceil(need.h/C.PX);if(say)notify(`Page set to a custom ${page.customW} × ${page.customH} mm sheet.`)}

// ---------- type & link-type matching ----------
const TYPE_RULES=[[/internet|isp\b|wan cloud/,'internet'],[/fire ?wall|\bfw\b|fw\d|asa|fortigate|palo ?alto|srx|check ?point|ngfw|utm/,'firewall'],[/\bwlc\b|wireless (lan )?controller/,'wlc'],[/load ?balanc|\blb\d*\b|\badc\b|f5|netscaler/,'loadbalancer'],[/\bvpn\b|concentrator/,'vpn'],[/sd-?wan/,'sdwan'],[/\bips\b|\bids\b|intrusion/,'ids'],[/\bwaf\b/,'waf'],[/proxy/,'proxy'],[/siem|\bsoc\b/,'siem'],[/radius|\bnac\b|\baaa\b|ise\b|clearpass/,'nac'],
  [/industrial ?sw|din ?rail/,'industrialswitch'],[/\bcore\b|\bl3\b|distribution|\bdist\b|multilayer|spine|nexus|cat ?9[45]|9500|9600/,'l3switch'],[/switch|\bsw\b|\bsw\d|access|leaf|catalyst|\bex\d|aruba ?\d|tor\b|stack/,'switch'],[/router|\brtr\b|\bgw\b|gateway|\bisr\d*|\basr\d*|\bmx\d|\bce\b|\bpe\b|edge/,'router'],
  [/\bap\b|\bap\d|access ?point|wi-?fi|\bwap\b/,'wap'],[/\bnvr\b|\bvms\b|\bdvr\b|recorder/,'nvr'],[/ptz/,'ptzcamera'],[/dome/,'domecamera'],[/anpr|\blpr\b|plate/,'anpr'],[/thermal/,'thermal'],[/cam\b|cam\d|camera|cctv|bullet/,'camera'],[/video ?wall/,'videowall'],[/access ?control|card ?reader|reader/,'accesscontrol'],[/barrier|boom|gate/,'barrier'],[/intercom/,'intercom'],
  [/\bplc\b/,'plc'],[/\bhmi\b/,'hmi'],[/\brtu\b/,'rtu'],[/scada/,'scada'],[/historian/,'historian'],[/\bups\b/,'ups'],[/\bpdu\b/,'pdu'],[/sensor|\biot\b/,'sensor'],[/iot ?gw|iot gateway/,'iotgateway'],
  [/database|\bdb\b|\bsql|oracle|postgres/,'database'],[/\bsan\b|storage|array/,'storage'],[/\bnas\b/,'nas'],[/backup|tape/,'backup'],[/web/,'webserver'],[/mail|smtp|exchange/,'mailserver'],[/\bdns\b|dhcp|ntp/,'dnsserver'],[/\bvm\b|virtual/,'vm'],[/esxi?|hyper-?v|hypervisor|proxmox/,'hypervisor'],[/k8s|kubernetes|cluster/,'cluster'],[/server|\bsrv\b|\bhost\b|blade/,'server'],
  [/cloud|aws|azure|gcp|saas/,'cloud'],[/laptop|notebook/,'laptop'],[/phone|voip|\bsip\b/,'ipphone'],[/mobile|smartphone/,'smartphone'],[/tablet|ipad/,'tablet'],[/printer|mfp/,'printer'],[/display|screen|signage|\btv\b/,'display'],[/\bpc\b|workstation|desktop|client|\bws\b/,'workstation'],[/modem|\bont\b|\bcpe\b/,'modem'],[/\bolt\b|pon/,'olt'],[/tower|mast|\bcell\b/,'tower'],[/satellite|vsat/,'dish'],[/microwave|\bp2p\b|ptp|radio link/,'microwave'],[/pbx|voice gateway/,'pbx'],[/patch/,'patchpanel'],[/building|office|hq|site/,'building'],[/data ?cent/,'datacenter'],[/user|staff|people/,'users']];
function matchType(s,fallback='server'){const t=String(s||'').toLowerCase().trim(),st=Stencils?.shapes||{};if(!t)return st[fallback]?fallback:Object.keys(st)[0];if(st[t])return t;if(Shapes.rackItems[t]||Shapes.basic[t])return t;
  for(const[id,sh]of Object.entries(st))if(sh.name.toLowerCase()===t)return id;for(const[re,id]of TYPE_RULES)if(re.test(t)&&st[id])return id;for(const[id,sh]of Object.entries(st))if((sh.tags||'').split(/\s+/).includes(t))return id;return st[fallback]?fallback:Object.keys(st)[0]}
function ruleType(s){const t=String(s||'').toLowerCase(),st=Stencils?.shapes||{};for(const[re,id]of TYPE_RULES)if(re.test(t)&&st[id])return id;return null}
const LINK_RULES=[[/100g|40g|400g/,'fiber100'],[/10g|25g|fib|fiber|fibre|smf|mmf|sfp/,'fiber10'],[/stack|lag|port-?channel|bond|lacp|vpc|mlag/,'stack'],[/\bha\b|heartbeat|sync|cluster/,'ha'],[/mgmt|management|oob|ilo|idrac|ipmi/,'mgmt'],[/vpn|ipsec|tunnel|gre/,'vpn'],[/wan|mpls|leased|circuit/,'wan'],[/internet|isp|broadband/,'internet'],[/wireless|wifi|wi-fi|radio|rf|lte|5g|4g|microwave/,'wireless'],[/serial|console|rs-?232/,'serial'],[/rs-?485|modbus|fieldbus|profibus/,'fieldbus'],[/power|psu|mains/,'power'],[/logical|flow|traffic/,'logical'],[/eth|copper|cat\d|1g|utp/,'eth']];
function matchLink(s){const t=String(s||'').toLowerCase();if(Shapes.linkTypes[t])return t;for(const[id,l]of Object.entries(Shapes.linkTypes))if(l.name.toLowerCase()===t)return id;for(const[re,id]of LINK_RULES)if(re.test(t))return id;return S.linkType||'eth'}

// ---------- CSV ----------
function parseCSV(text){text=String(text||'').replace(/^\uFEFF/,'');const first=text.split(/\r?\n/).find(l=>l.trim())||'';const delim=[',',';','\t','|'].map(d=>[d,first.split(d).length]).sort((a,b)=>b[1]-a[1])[0][0];const rows=[];let row=[],cur='',q=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(q){if(c==='"'){if(text[i+1]==='"'){cur+='"';i++}else q=false}else cur+=c}else if(c==='"')q=true;else if(c===delim){row.push(cur);cur=''}else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cur);cur='';if(row.some(v=>v.trim()))rows.push(row);row=[]}else cur+=c}
  row.push(cur);if(row.some(v=>v.trim()))rows.push(row);if(!rows.length)return{header:[],rows:[]};return{header:rows[0].map(h=>h.trim()),rows:rows.slice(1).map(r=>r.map(v=>v.trim()))}}
const norm=h=>h.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
const DEV_COLS={name:['name','device','device_name','hostname','node','label','host','asset_name'],type:['type','role','device_role','role_name','category','kind','function','device_type_role'],group:['zone','site','group','area','network_zone','segment','site_name','tenant'],ip:['ip','ip_address','primary_ip','primary_ip4','address','ipv4','ip_addr'],mgmtIp:['mgmt_ip','management_ip','oob_ip','oob'],vlan:['vlan','vlan_id','access_vlan'],model:['model','device_type','product','part_number','sku'],vendor:['vendor','manufacturer','make','brand'],serial:['serial','serial_number','sn','asset_tag'],status:['status','state','lifecycle'],location:['location','room','floor','rack','building'],os:['os','platform','software','firmware','version'],owner:['owner','contact','tenant_group'],notes:['notes','description','comments','comment'],power:['power','power_w','watts'],poeDraw:['poe','poe_draw','poe_w'],poeBudget:['poe_budget'],bitrate:['bitrate','bitrate_mbps','stream_mbps'],retention:['retention','retention_days'],storageTB:['storage_tb','storage'],unitPrice:['price','unit_price','cost','unit_cost']};
const LINK_COLS={from:['from','source','src','a','device_a','a_device','termination_a_device','side_a_device','local_device','from_device','device1','endpoint_a'],to:['to','target','dst','b','device_b','b_device','termination_b_device','side_b_device','remote_device','neighbor','neighbour','to_device','device2','endpoint_b'],fromIf:['from_port','source_port','from_interface','interface_a','termination_a_name','side_a_name','local_interface','local_port','port_a','a_port','if_a','interface1','src_port'],toIf:['to_port','target_port','to_interface','interface_b','termination_b_name','side_b_name','remote_interface','remote_port','port_b','b_port','if_b','interface2','dst_port'],type:['type','link_type','media','cable_type','medium','kind'],speed:['speed','bandwidth','rate','capacity'],label:['label','description','name','circuit'],vlans:['vlans','vlan','allowed_vlans','trunk'],cableId:['cable_id','cable','id','tag']};
function mapCols(header,spec){const map={},used=new Set();header.forEach((h,i)=>{const k=norm(h);for(const[f,alts]of Object.entries(spec))if(!(f in map)&&alts.includes(k)){map[f]=i;used.add(i);break}});return{map,extra:header.map((h,i)=>used.has(i)?null:{i,h}).filter(Boolean)}}
function fromCSV(devText,linkText){
  const devices=[],links=[],extras=[];
  if(String(devText||'').trim()){const{header,rows}=parseCSV(devText),{map,extra}=mapCols(header,DEV_COLS);if(map.name===undefined)throw Error('Devices CSV needs a "name" (or hostname/device) column.');
    extras.push(...extra.map(e=>e.h));for(const r of rows){const name=r[map.name];if(!name)continue;const data={};for(const[f,i]of Object.entries(map))if(!['name','type','group'].includes(f)&&r[i])data[f]=r[i];for(const e of extra)if(r[e.i])data['x_'+norm(e.h)]=r[e.i];if(!data.hostname&&/^[\w.-]+$/.test(name))data.hostname=name;devices.push({name,type:map.type!==undefined?r[map.type]:(map.model!==undefined?r[map.model]:'')||name,group:map.group!==undefined?r[map.group]:'',data})}}
  if(String(linkText||'').trim()){const{header,rows}=parseCSV(linkText),{map}=mapCols(header,LINK_COLS);if(map.from===undefined||map.to===undefined)throw Error('Links CSV needs "from" and "to" columns (NetBox cable exports are recognised too).');for(const r of rows){if(!r[map.from]||!r[map.to])continue;links.push({from:r[map.from],to:r[map.to],fromIf:r[map.fromIf]||'',toIf:r[map.toIf]||'',type:r[map.type]||r[map.speed]||'',label:map.label!==undefined&&map.label!==map.cableId?r[map.label]:'',data:{speed:r[map.speed]||'',vlans:r[map.vlans]||'',cableId:r[map.cableId]||''}})}}
  return{devices,links,extraFields:extras}}

// ---------- diagram-as-text ----------
// Device:  Name : type [key=value ...] [@Zone]      Link:  A[ifA] -- B[ifB] : linktype "label"   (== stack, -> logical flow, ~~ wireless, .. vpn)
function fromText(text){const devices=[],links=[];const dev=new Map();
  for(let raw of String(text||'').split(/\r?\n/)){const line=raw.replace(/\s+#.*$/,'').replace(/^#.*$/,'').trim();if(!line)continue;
    const op=/\s(--|==|->|<->|~~|\.\.)\s/.exec(line);
    if(op){const l=line.slice(0,op.index),rest=line.slice(op.index+op[0].length);const tm=/^(.+?)(?:\s*:\s*([^"]*?))?\s*(?:"([^"]*)")?\s*$/.exec(rest)||[];const r=tm[1]||rest,lt=(tm[2]||'').trim(),label=tm[3]||'';const side=s=>{const m=/^(.*?)\s*(?:\[(.+)\])?$/.exec(s.trim());return{name:m[1].trim(),port:m[2]||''}};const a=side(l),b=side(r);
      const type=lt||({'==':'stack','->':'logical','<->':'logical','~~':'wireless','..':'vpn'}[op[1]]||'');links.push({from:a.name,to:b.name,fromIf:a.port,toIf:b.port,type,label,data:{},arrow:op[1]==='->'?'end':op[1]==='<->'?'both':null});for(const s of[a,b])if(!dev.has(s.name.toLowerCase()))dev.set(s.name.toLowerCase(),{name:s.name,type:'',group:'',data:{}});continue}
    const m=/^([^:]+?)\s*(?::\s*(.*))?$/.exec(line);if(!m)continue;const name=m[1].trim(),rest=m[2]||'',d={name,type:'',group:'',data:{}};for(const tok of rest.match(/@"[^"]+"|@\S+|\S+="[^"]*"|\S+/g)||[]){if(tok.startsWith('@'))d.group=tok.slice(1).replace(/"/g,'');else if(tok.includes('=')){const[k,...v]=tok.split('=');d.data[k]=v.join('=').replace(/^"|"$/g,'')}else d.type=d.type?d.type+' '+tok:tok}dev.set(name.toLowerCase(),{...dev.get(name.toLowerCase()),...d})}
  for(const d of dev.values())devices.push({...d,type:d.type||d.name});return{devices,links}}

// ---------- CDP / LLDP neighbour output ----------
function fromNeighbors(text,localName=''){
  const devices=new Map(),links=[],put=(name,type,data={})=>{name=String(name||'');if(!/^\d+(\.\d+){3}$/.test(name))name=name.replace(/\.[a-z][\w-]*(\.[\w-]+)*$/i,'');name=name.replace(/\(.*\)$/,'').trim();if(!name)return null;const k=name.toLowerCase();const d=devices.get(k)||{name,type:'',group:'',data:{}};if(type&&!d.type)d.type=type;Object.assign(d.data,Object.fromEntries(Object.entries(data).filter(([,v])=>v)));devices.set(k,d);return d.name};
  const capType=c=>{c=String(c||'');if(/router|\bR\b/i.test(c)&&/switch|\bS\b/i.test(c))return'l3switch';if(/router|\bR\b/.test(c))return'router';if(/switch|\bS\b|\bB\b|bridge/i.test(c))return'switch';if(/trans-bridge|\bT\b|wlan|\bW\b/i.test(c))return'wap';if(/phone|\bP\b/i.test(c))return'ipphone';if(/host|\bH\b|station/i.test(c))return'server';return''};
  const ifn=s=>String(s||'').trim().replace(/^(Gig|Gi)\s?(?=\d)/i,'Gi').replace(/^(Ten|Te)\s?(?=\d)/i,'Te').replace(/^(Fas|Fa)\s?(?=\d)/i,'Fa').replace(/^GigabitEthernet/i,'Gi').replace(/^TenGigabitEthernet/i,'Te').replace(/^FastEthernet/i,'Fa').replace(/^FortyGigabitEthernet/i,'Fo').replace(/^HundredGig(?:abit)?E(?:thernet)?/i,'Hu').replace(/^TwentyFiveGigE/i,'Twe').replace(/^Ethernet/i,'Eth').replace(/\s+/g,'');
  let local=localName;const blocks=String(text).split(/\r?\n/);
  // detail format (cdp detail / lldp detail): key: value blocks separated by dashes
  if(/Device ID\s*:|System Name\s*:/i.test(text)){let cur=null;const lldp=/System Name\s*:/i.test(text);
    const lldpType=c=>{c=String(c||'');const has=x=>new RegExp('(^|[,\\s])'+x+'($|[,\\s])').test(c);return has('R')&&has('B')?'l3switch':has('W')?'wap':has('T')?'ipphone':has('R')?'router':has('B')?'switch':has('S')?'server':''};
    const flush=()=>{if(cur?.remote&&local){const t=ruleType(cur.platform)||(lldp?lldpType(cur.cap):capType(cur.cap))||matchType(cur.remote);const r=put(cur.remote,t,{ip:cur.ip||'',model:cur.platform||'',os:cur.os||''});if(r)links.push({from:local,to:r,fromIf:ifn(cur.lif),toIf:ifn(cur.rif),type:/^(te|xe|hu|fo|twe)/i.test(ifn(cur.lif))?'fiber10':'eth',label:'',data:{}})}cur=null};
    for(const line of blocks){const prompt=/^([\w.-]+)[#>]\s*show/i.exec(line);if(prompt){flush();local=put(prompt[1],'switch')||local;continue}
      if(/^\s*-{6,}\s*$/.test(line)){flush();continue}
      let m;cur??={};
      if((m=/^\s*(?:Device ID|System Name)\s*:\s*(.+)$/i.exec(line))){if(cur.remote){flush();cur={}}cur.remote=m[1].trim()}
      else if((m=/Interface:\s*([^,]+),\s*Port ID \(outgoing port\):\s*(.+)$/i.exec(line))){cur.lif=m[1];cur.rif=m[2]}else if((m=/^\s*Local Intf:\s*(.+)$/i.exec(line)))cur.lif=m[1];else if((m=/^\s*Port id:\s*(.+)$/i.exec(line)))cur.rif=m[1];else if((m=/Platform:\s*([^,]+),\s*Capabilities:\s*(.+)$/i.exec(line))){cur.platform=m[1].replace(/^cisco\s+/i,'');cur.cap=m[2]}else if((m=/^\s*System Capabilities:\s*(.+)$/i.exec(line)))cur.cap=m[1];else if((m=/^\s*System Description:\s*(.+)$/i.exec(line))&&!cur.platform)cur.platform=m[1].slice(0,60);else if((m=/IP(?:v4)? address:\s*([\d.]+)/i.exec(line))&&!cur.ip)cur.ip=m[1];else if((m=/^\s*IP:\s*([\d.]+)/i.exec(line))&&!cur.ip)cur.ip=m[1];else if((m=/(Cisco IOS.*?Version [^,\s]+)/i.exec(line))&&!cur.os)cur.os=m[1]}
    flush()}
  else{// table format
    let inTable=false,pending='';for(const line of blocks){const prompt=/^([\w.-]+)[#>]\s*show/i.exec(line);if(prompt){local=put(prompt[1],'switch')||local;inTable=false;continue}if(/Device[ -]ID/i.test(line)&&/Local Int/i.test(line)){inTable=true;continue}if(!inTable||!line.trim()||/^Total|entries displayed|Capability codes/i.test(line))continue;
      let tok=line.trim().split(/\s+/);if(tok.length===1){pending=tok[0];continue}if(pending){tok.unshift(pending);pending=''}
      const remote=tok.shift();let lif=tok.shift();if(/^[a-z]+$/i.test(lif)&&/^\d/.test(tok[0]||''))lif+=tok.shift();let rif=tok.pop();if(/^[a-z]+$/i.test(tok.at(-1)||'')&&/^\d/.test(rif)&&tok.length>1)rif=tok.pop()+rif;const caps=tok.filter(t=>/^[RTBSHIrPDCMW]$/.test(t)).join(' '),hold=tok.find(t=>/^\d+$/.test(t)),platform=tok.filter(t=>t!==hold&&!/^[RTBSHIrPDCMW]$/.test(t)).join(' ');
      if(local){const r=put(remote,ruleType(platform)||capType(caps)||matchType(remote),{model:platform});if(r)links.push({from:local,to:r,fromIf:ifn(lif),toIf:ifn(rif),type:/^te|^xe|^hu|^fo|^twe/i.test(ifn(lif))?'fiber10':'eth',label:'',data:{}})}}}
  if(!local)throw Error('Could not tell which device the output came from. Include the prompt line (e.g. “CORE-SW1#show cdp neighbors”) or type the local device name.');
  // merge duplicate links seen from both ends
  const seen=new Set(),uniq=[];for(const l of links){const a=[l.from.toLowerCase(),l.fromIf].join('/'),b=[l.to.toLowerCase(),l.toIf].join('/'),k=[a,b].sort().join('|');if(seen.has(k))continue;seen.add(k);uniq.push(l)}
  return{devices:[...devices.values()].map(d=>({...d,type:d.type||d.name})),links:uniq}}

// ---------- build ----------
function build(spec,{target='new',pageName='Imported topology',layout='hier',display=S.prefs.newDisplay||'symbol',update=false}={}){
  let page;const created=[];
  const run=()=>{
    if(target==='new'){page=C.page(pageName);S.doc.pages.push(page);S.pageIndex=S.doc.pages.length-1}else page=pg();
    for(const f of spec.extraFields||[]){const key='x_'+norm(f);if(!S.doc.fields.some(x=>x.key===key))S.doc.fields.push({key,label:f})}
    const byName=new Map();for(const n of page.items)if(n.kind==='node'){for(const k of[resolveLabel(n,n.labels?.[0]||{text:''}),n.data?.hostname,...C.ipsIn(n.data?.ip)])if(k)byName.set(String(k).toLowerCase(),n)}
    let updated=0;
    for(const d of spec.devices){const ex=byName.get(d.name.toLowerCase())||byName.get(String(d.data?.hostname||'').toLowerCase());if(ex){Object.assign(ex.data,d.data);updated++;continue}if(update)continue;const n=Shapes.make(matchType(d.type),0,0,d.name);n.data={...d.data};if(display!=='symbol'&&Shapes.kindOf(n.type)==='device')n.display=display;n.layer=S.activeLayer;applyThemeToNew(n);n._group=d.group||'';page.items.push(n);byName.set(d.name.toLowerCase(),n);created.push(n)}
    if(!update)for(const l of spec.links){let a=byName.get(String(l.from).toLowerCase()),b=byName.get(String(l.to).toLowerCase());for(const[k,nm]of[['a',l.from],['b',l.to]]){if(k==='a'&&a||k==='b'&&b)continue;const n=Shapes.make(matchType(nm),0,0,nm);n.layer=S.activeLayer;n._group='';page.items.push(n);byName.set(String(nm).toLowerCase(),n);created.push(n);if(k==='a')a=n;else b=n}
      const e=C.edge([C.center(a),C.center(b)],{node:a.id,port:null},{node:b.id,port:null});e.routing='auto';Shapes.applyLinkType(e,matchLink(l.type||l.data?.speed));if(l.data?.speed)e.data.speed=l.data.speed;if(l.data?.vlans)e.data.vlans=l.data.vlans;if(l.data?.cableId)e.data.cableId=l.data.cableId;e.fromIf=l.fromIf||'';e.toIf=l.toIf||'';if(l.arrow==='end')e.endMarker='arrow';if(l.arrow==='both'){e.endMarker='arrow';e.startMarker='arrow'}if(l.label){const q=[0,0],lb=C.label(l.label,q[0],q[1],10.5);lb.anchor={t:.5,dx:0,dy:-8};lb.background=true;e.labels.push(lb)}e.layer=S.activeLayer;page.items.push(e);Conn.markDirty(e.id)}
    // zones from the group column
    const groups=[...new Set(created.map(n=>n._group).filter(Boolean))],theme=Shapes.themes[S.doc.theme]||Shapes.themes.port;
    groups.forEach((g,i)=>{const z=C.zone(g,0,0,200,150,theme.zones[i%theme.zones.length][0],theme.zones[i%theme.zones.length][1]);z.layer=S.activeLayer;page.items.unshift(z);const members=created.filter(n=>n._group===g);let x=20;for(const n of members){C.move(n,x-n.x,40-n.y);x+=n.w+30}z.w=Math.max(200,x);z._tmp=members});
    created.forEach(n=>delete n._group);
    // provisional placement so zones contain their members before the real layout runs
    let ox=0;for(const z of page.items.filter(n=>n._tmp)){z.x=ox;z.y=0;for(const n of z._tmp)C.move(n,ox+30,60);ox+=z.w+120;delete z._tmp}
    let lx=ox;for(const n of created)if(!page.items.some(z=>z.kind==='zone'&&C.inside(C.box(n),C.box(z)))){C.move(n,lx-n.x,600-n.y);lx+=n.w+40}
    return updated};
  remember();const updated=run();clearTransient();changed();Conn.reset();render();
  if(!update&&created.length){S.selected.clear();renderNow();const h=S.history.length;layoutPage(layout,{});if(S.history.length>h)S.history.pop()}else fit();
  return{created:created.length,updated}}

return{layoutPage,autoSizePage,matchType,matchLink,parseCSV,fromCSV,fromText,fromNeighbors,build,TYPE_RULES};
})();
