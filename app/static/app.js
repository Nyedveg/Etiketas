// Etiketas - Label Manager
// React components (JSX transpiled in the browser by the vendored Babel standalone)
const {useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo, useDeferredValue, memo, Fragment} = React;

// Same-origin requests: the server only accepts calls made from its own page.
const api = {
  get:  (p)    => fetch(p).then(r=>r.json()),
  post: (p, b) => fetch(p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(r=>r.json()),
  loadConfig:   ()    => api.get('/api/config'),
  saveConfig:   (cfg) => api.post('/api/config/save', cfg),
  loadMap:      ()    => api.get('/api/map'),
  scanLabels:   ()    => api.get('/api/scan'),
  findTemplate: (p)   => api.post('/api/find_template', p),
  createLabel:  (p)   => api.post('/api/create', p),
  openFile:        (p)   => api.post('/api/open',   {path:p}),
  revealFile:      (p)   => api.post('/api/reveal', {path:p}),
  trashFile:       (p)   => api.post('/api/trash',  {path:p}),
  getLabelsDir:    ()    => api.get('/api/labels_dir').then(r=>r.path),
  resetConfig:     ()    => api.post('/api/config/reset', {}),
  syncProducts:    ()    => api.post('/api/config/sync_products', {}),
  pickDir:         ()    => api.get('/api/pick_dir'),
  ingest:          (p)   => api.post('/api/ingest', {path:p}),
  getTemplates:    ()    => api.get('/api/templates'),
  getHistory:      ()    => api.get('/api/history'),
  getColors:       ()    => api.get('/api/colors'),
  saveColors:      (c)   => api.post('/api/colors/save', c),
  getResourceDirs: ()    => api.get('/api/resource_dirs'),
  checkAssets:        ()    => api.get('/api/assets_check'),
  listTranslations:   ()    => api.get('/api/translations'),
  getSyncStatus:      ()    => api.get('/api/sync_status'),
  getFileInfo:        (p)   => api.get('/api/file_info?path='+encodeURIComponent(p)),
  getMockupInfo:      (p)   => api.get('/api/mockup_info?path='+encodeURIComponent(p)),
  getProductMockup:   (n)   => api.get('/api/product_mockup?product='+encodeURIComponent(n)),
  getIcons:            ()    => api.get('/api/icons'),
  getIconAssignments:  ()    => api.get('/api/icon_assignments'),
  saveIconAssignments: (a)   => api.post('/api/icon_assignments/save', a),
  checkUpdate:         (f)   => api.get('/api/update/check'+(f?'?force=1':'')),
  installUpdate:       ()    => api.post('/api/update/install', {}),
  updateProgress:      ()    => api.get('/api/update/progress'),
  getShipping:         ()    => api.get('/api/shipping'),
  saveShipping:        (s)   => api.post('/api/shipping/save', s),
};

const scoreLabel = s => s>=75?{label:'Perfect',cls:'score-high'}:s>=50?{label:'Good',cls:'score-med'}:{label:'Fallback',cls:'score-low'};

// Tokenized search: every word in the query must appear somewhere in the
// text (in any order), instead of the whole query matching as one literal
// substring -- "BioNPK 500" now matches "BioNPK Powder S 500" rather than
// requiring that exact phrase.
const matchesSearch = (text, query) => {
  const tokens = (query||'').toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const hay = (text||'').toLowerCase();
  return tokens.every(tok => hay.includes(tok));
};

// ── Shared helpers ─────────────────────────────────────────────────────────────
const removeFromMap=(setMap,path)=>setMap(m=>({...m,files:(m?.files??[]).filter(f=>f.path!==path)}));
const categoryMap=config=>Object.fromEntries((config?.products??[]).map(p=>[p.name,p.category]));

// ── Languages ────────────────────────────────────────────────────────────────────────
// Every ISO 639-1 language, so wherever the list appears it can be searched, and sorted by how often
// a language is on label files or by name. There is one choice of sort, kept in this browser.
const LANG_SORT_KEY='etiketas.langSort';
const LANG_SORTS=[['used','Most used'],['alpha','A–Z']];
const langUsage=files=>{
  const n={};
  for(const f of files??[])for(const c of f.languages??[])n[c]=(n[c]||0)+1;
  return n;
};
const sortLangs=(langs,sort,usage)=>[...langs].sort((a,b)=>(sort==='used'?(usage[b.code]||0)-(usage[a.code]||0):0)||a.name.localeCompare(b.name));
const langText=l=>`${l.code} ${l.iso??''} ${l.name} ${l.alt??''}`;
// Sorted by use, the list has a clear break: languages on labels, then the rest by name.
const langGroups=(langs,sort,usage)=>sort!=='used'?[{items:langs}]:[
  {title:'On your labels',items:langs.filter(l=>usage[l.code])},
  {title:'Not on any label yet',items:langs.filter(l=>!usage[l.code])},
].filter(g=>g.items.length);
const fileCount=n=>`${n} label file${n===1?'':'s'}`;
function useLangSort(){
  const [sort,setSortState]=useState(()=>storeGet(localStorage,LANG_SORT_KEY)==='alpha'?'alpha':'used');
  const setSort=s=>{setSortState(s);storeSet(localStorage,LANG_SORT_KEY,s);};
  return [sort,setSort];
}
const LangSortToggle=({sort,onChange})=>(
  <div className="seg" role="group" aria-label="Sort languages" style={{flexShrink:0}}>
    {LANG_SORTS.map(([v,l])=>(
      <button key={v} type="button" aria-pressed={sort===v} className={'seg-btn'+(sort===v?' on':'')} onClick={()=>onChange(v)}>{l}</button>
    ))}
  </div>
);
// Which translation a language slot starts on: the product's own file, then the general one.
const sameProduct=(a,b)=>!!a&&!!b&&a.toLowerCase().replace(/[^a-z0-9]/g,'')===b.toLowerCase().replace(/[^a-z0-9]/g,'');
const translationFor=(files,code,product)=>{
  const own=files.filter(f=>f.code===code);
  return own.find(f=>sameProduct(f.product,product))??own.find(f=>!f.product)??own[0];
};
// YYYY-MM-DD in local time. The server stamps creation history with naive local time, so it
// has to be matched against local dates: toISOString() is UTC, and in a UTC+ zone local
// midnight is still the previous UTC day, which shifted every chart bar by one day.
const localDateKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

// Category colours: PAM brown, CE green, anything else (MO) navy.
const CAT_STYLE={
  PAM:{color:'var(--pam)',bg:'rgba(var(--pam-rgb),.15)'},
  CE: {color:'var(--ce)', bg:'rgba(var(--accent-rgb),.15)'},
  MO: {color:'var(--mo)', bg:'rgba(var(--mo-rgb),.15)'},
};
const catStyle=c=>CAT_STYLE[c]||CAT_STYLE.MO;

// Which table of config.dimensions / config.packagingSizes a product is sized from
// (mirrors dim_key_for in etiketas.py).
const dimKeyFor=p=>{
  if(!p)return null;
  const {category,acidic,unit}=p, u=unit||(category==='PAM'?'L':'kg');
  if(category==='PAM')return acidic?'PAM_acidic':'PAM_normal';
  if(category==='CE')return u==='kg'?'CE_solid':'CE';
  return u==='L'?'MO_liquid':'MO';
};

// File tag colours: one table for the badges in every file list and for the Browse
// toolbar's filter options and pills, so a filter always looks like the thing it filters.
const TONE={
  label:  {bg:'rgba(var(--accent-rgb),.15)', color:'var(--success)'},
  box:    {bg:'rgba(var(--pam-rgb),.15)',    color:'var(--pam)'},
  indd:   {bg:'rgba(var(--indd-rgb),.15)',   color:'var(--indd)'},
  idml:   {bg:'rgba(var(--idml-rgb),.15)',   color:'var(--idml)'},
  print:  {bg:'var(--surface3)',             color:'var(--text)'},
  wip:    {bg:'rgba(var(--warning-rgb),.15)',color:'var(--warning)'},
  neutral:{bg:'var(--surface3)',             color:'var(--text2)'},
};
const Tag=({tone,children})=><span className="badge" style={{background:TONE[tone].bg,color:TONE[tone].color}}>{children}</span>;
const BadgeKind=({f})=><Tag tone={f.deze?'box':'label'}>{f.deze?'Box':'Label'}</Tag>;
const BadgePrint=()=><Tag tone="print">Print</Tag>;
const BadgeFormat=({f,indd='InDesign'})=>f.extension==='.idml'?<Tag tone="idml">IDML</Tag>:<Tag tone="indd">{indd}</Tag>;
const BadgeWip=()=><Tag tone="wip">WIP</Tag>;

// Outline icons for the Browse toolbar (16px grid, stroke drawn to sit beside the sidebar icons).
const stroke=(paths,size=14)=><svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths}</svg>;


const Icon = {
  Dashboard:()=><svg className="icon" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="6" height="6" rx="1.5"/><rect x="9" y="1" width="6" height="6" rx="1.5"/><rect x="1" y="9" width="6" height="6" rx="1.5"/><rect x="9" y="9" width="6" height="6" rx="1.5"/></svg>,
  New:()=><svg className="icon" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm1 6h2a1 1 0 010 2H9v2a1 1 0 01-2 0V9H5a1 1 0 010-2h2V5a1 1 0 012 0v2z"/></svg>,
  Browse:()=><svg className="icon" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3a1 1 0 011-1h3.586A1 1 0 017 2.293L7.707 3H13a1 1 0 011 1v8a1 1 0 01-1 1H3a1 1 0 01-1-1V3z"/></svg>,
  Shipment:()=><svg className="icon" viewBox="0 0 16 16" fill="currentColor"><path d="M1 4a1 1 0 011-1h7.5a1 1 0 011 1v1.5h1.9a1 1 0 01.8.4l1.6 2.1a1 1 0 01.2.6V11a1 1 0 01-1 1h-.55a2 2 0 01-3.9 0h-2.1a2 2 0 01-3.9 0H2a1 1 0 01-1-1V4zm3.5 7a1 1 0 100 2 1 1 0 000-2zm6.5 0a1 1 0 100 2 1 1 0 000-2zm-.5-4v1.8h3.2L12.3 7h-1.8z"/></svg>,
  Settings:()=><svg className="icon" viewBox="0 0 16 16" fill="currentColor"><path d="M8 4.754a3.246 3.246 0 100 6.492 3.246 3.246 0 000-6.492zM5.754 8a2.246 2.246 0 114.492 0 2.246 2.246 0 01-4.492 0z"/><path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 01-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 01-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 01.52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 011.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 011.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 01.52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 01-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 01-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 002.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 001.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 00-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 00-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 00-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 003.06 8.858l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 004.175 4.4l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 002.692-1.115l.094-.319z"/></svg>,
  Refresh:()=>stroke(<><path d="M14 8a6 6 0 1 1-6-6c1.68 0 3.29.67 4.49 1.83L14 5.33"/><path d="M14 2v3.33h-3.33"/></>,13),
  Open:()=><svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13"><path d="M9 2H3a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1V7l-5-5zM3 13V3h5v4h4v6H3z"/></svg>,
  Folder:()=><svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13"><path d="M2 3a1 1 0 011-1h3.586L8 3.414 8.707 3H13a1 1 0 011 1v8a1 1 0 01-1 1H3a1 1 0 01-1-1V3zm5.293 1H5V3H3v9h10V5H7.293z"/></svg>,
  Check:()=><svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M13.3 3.3a1 1 0 00-1.4 0L6 9.2 4.1 7.3a1 1 0 00-1.4 1.4l2.6 2.6a1 1 0 001.4 0l6.6-6.6a1 1 0 000-1.4z"/></svg>,
  Info:()=><svg className="icon" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 2a5 5 0 110 10A5 5 0 018 3zM7.25 6.5h1.5v1h-1.5v-1zm0 2h1.5v3.5h-1.5V8.5z"/></svg>,
  Trash:()=><svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13"><path d="M6 2a1 1 0 00-1 1H3.5a.5.5 0 000 1H4v8a1 1 0 001 1h6a1 1 0 001-1V4h.5a.5.5 0 000-1H11a1 1 0 00-1-1H6zm0 1h4v1H6V3zM5 5h6v7H5V5zm1.5 1a.5.5 0 00-.5.5v4a.5.5 0 001 0v-4a.5.5 0 00-.5-.5zm3 0a.5.5 0 00-.5.5v4a.5.5 0 001 0v-4a.5.5 0 00-.5-.5z"/></svg>,
  External:()=><svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13"><path d="M9 2a1 1 0 000 2h2.586L7.293 8.293a1 1 0 101.414 1.414L13 5.414V8a1 1 0 002 0V3a1 1 0 00-1-1H9zM4 4a2 2 0 00-2 2v6a2 2 0 002 2h6a2 2 0 002-2v-3a1 1 0 10-2 0v3H4V6h3a1 1 0 100-2H4z"/></svg>,
  Search:({size})=>stroke(<><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></>,size),
  Close:({size})=>stroke(<path d="M4 4l8 8M12 4l-8 8"/>,size),
  Chevron:({size})=>stroke(<path d="M4 6.5l4 4 4-4"/>,size),
  SortUp:()=>stroke(<path d="M4 10l4-4 4 4"/>,12),
  SortDown:()=>stroke(<path d="M4 6l4 4 4-4"/>,12),
  Tag:()=>stroke(<><path d="M2 2h5.6l6.4 6.4-5.6 5.6L2 7.6z"/><circle cx="5.2" cy="5.2" r=".9" fill="currentColor"/></>),
  File:()=>stroke(<><path d="M4 1.8h5l3.2 3.2v8.7a.5.5 0 01-.5.5H4a.5.5 0 01-.5-.5V2.3a.5.5 0 01.5-.5z"/><path d="M9 1.8V5h3.2"/></>),
  Ruler:()=>stroke(<><rect x="1.5" y="5" width="13" height="6" rx="1"/><path d="M4.5 5v2.5M7.2 5v1.6M9.9 5v2.5M12.5 5v1.6"/></>),
  Globe:()=>stroke(<><circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c2.2 2 2.2 10 0 12M8 2c-2.2 2-2.2 10 0 12"/></>),
  Flag:()=>stroke(<path d="M3.5 14V2.5M3.5 3h8l-1.6 3 1.6 3h-8"/>),
  Download:()=>stroke(<path d="M8 2v8M4.5 6.5L8 10l3.5-3.5M2.5 13.5h11"/>),
};

// Builds an "open the containing folder in SharePoint" link from a file's
// path relative to LABELS_DIR, e.g. base + "/MO/BioNPK%20Powder%20S%20500/EN/5kg".
// The base is the synced library's root (Settings -> General -> SharePoint links).
function sharepointFolderLink(base, relPath){
  if(!base||!relPath)return null;
  const parts=relPath.split(/[\\/]/).slice(0,-1);
  if(!parts.length)return null;
  return base.replace(/\/+$/,'')+'/'+parts.map(encodeURIComponent).join('/')+'?web=1';
}

function FileActions({path, onDeleted, sharepointBase}){
  const handleDelete=async()=>{
    if(!window.confirm('Do you REALLY want to delete this file?\n\nIt will be moved to the Recycle Bin.'))return;
    const r=await api.trashFile(path);
    if(r.ok){if(onDeleted)onDeleted(path);}
    else alert('Could not delete file:\n'+(r.error||'Unknown error'));
  };
  const spLink=sharepointFolderLink(sharepointBase,path);
  return(
    <div className="file-actions">
      <button className="btn btn-ghost btn-indesign btn-sm" title="Open file" onClick={()=>api.openFile(path)}><Icon.Open/></button>
      <button className="btn btn-folder btn-sm" title="Show in Explorer" onClick={()=>api.revealFile(path)}><Icon.Folder/></button>
      {spLink&&<button className="btn btn-ghost btn-sm" title="Open in SharePoint" onClick={()=>window.open(spLink,'_blank')}><Icon.External/></button>}
      <button className="btn btn-sm" title="Move to Recycle Bin" style={{background:'rgba(var(--danger-rgb),.08)',color:'var(--danger)',border:'1px solid rgba(var(--danger-rgb),.2)'}} onClick={handleDelete}><Icon.Trash/></button>
    </div>
  );
}

// ── Updates ──────────────────────────────────────────────────────────────────────────
// The server checks GitHub and runs the installer; this asks whether it may. "Remind me" is kept
// in this browser, and a tab left open asks again once that time is up.
const HOUR_MS=3600000;
const REMIND_OPTIONS=[['1 hour',1],['6 hours',6],['1 day',24],['3 days',72],['1 week',168]];
const UPDATE_SNOOZE_KEY='etiketas.updateSnooze';
const UPDATE_DONE_KEY='etiketas.updateDone';
const UPDATE_TIMEOUT_MS=10*60000;     // a slow download and dependency install
const UPDATE_DOWN_MS=2*60000;         // the server being gone is only the swap and restart
const storeGet=(store,key)=>{try{return store.getItem(key);}catch{return null;}};
const storeSet=(store,key,value)=>{try{store.setItem(key,value);}catch{/* the choice lasts until reload instead */}};

function useUpdates(){
  // Set just before the reload that follows a finished update, to say it worked.
  const [offer,setOffer]=useState(()=>{
    const done=storeGet(sessionStorage,UPDATE_DONE_KEY);
    if(done)sessionStorage.removeItem(UPDATE_DONE_KEY);
    return done?{done:true}:null;
  });
  const snoozedUntil=useRef(Number(storeGet(localStorage,UPDATE_SNOOZE_KEY))||0);
  const nextCheck=useRef(0);
  useEffect(()=>{
    // A timer that checks the clock, not one long timeout: those don't count time a laptop spends asleep.
    const tick=async()=>{
      const now=Date.now();
      if(now<snoozedUntil.current||now<nextCheck.current)return;
      nextCheck.current=now+6*HOUR_MS;
      const r=await api.checkUpdate().catch(()=>null);
      if(r?.available)setOffer(o=>o??r);
    };
    tick();
    const id=setInterval(tick,60000);
    return()=>clearInterval(id);
  },[]);
  const remindIn=hours=>{
    snoozedUntil.current=Date.now()+hours*HOUR_MS;
    nextCheck.current=0;
    storeSet(localStorage,UPDATE_SNOOZE_KEY,String(snoozedUntil.current));
    setOffer(null);
  };
  // Asked for by hand, so it goes past a "remind me later".
  const checkNow=useCallback(async()=>{
    const r=await api.checkUpdate(true);
    if(r.available)setOffer(r);
    return r;
  },[]);
  return {offer,remindIn,checkNow,dismiss:()=>setOffer(null)};
}

const Modal=({title,onEscape,children})=>{
  const box=useRef(null);
  // Focus goes to the dialog, not to Install: it can appear while someone is typing, and Enter must not accept it.
  useEffect(()=>{box.current?.focus();},[]);
  // On the body: a page's entrance animation leaves a transform that would otherwise confine it to the page.
  return ReactDOM.createPortal(
    <div className="modal-backdrop">
      <div ref={box} className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
        onKeyDown={e=>{if(e.key==='Escape'&&onEscape)onEscape();}}>
        <div className="modal-title">{title}</div>
        {children}
      </div>
    </div>,document.body);
};

const RemindButtons=({onRemind})=>(
  <div className="modal-section">
    <div className="eyebrow">Remind me in</div>
    <div className="modal-choices">
      {REMIND_OPTIONS.map(([label,hours])=>(
        <button key={hours} type="button" className="btn btn-ghost btn-sm" onClick={()=>onRemind(hours)}>{label}</button>
      ))}
    </div>
  </div>
);

function UpdateDialog({offer,onRemind,unsaved}){
  const [phase,setPhase]=useState('offer');     // offer -> starting -> installing, or failed
  const [step,setStep]=useState('');
  const [failure,setFailure]=useState(null);
  const fail=(error,log)=>{setFailure({error,log});setPhase('failed');};
  useEffect(()=>{
    if(phase!=='installing')return;
    const started=Date.now();
    let alive=true,timer,lastAnswer=started;
    const poll=async()=>{
      let s=null;
      try{s=await api.updateProgress();}catch{/* no answer: the server is down, which is the restart */}
      if(!alive)return;
      if(s?.state==='failed')return fail(s.error||'The update did not finish.',s.log);
      if(s&&s.state!=='running'){
        storeSet(sessionStorage,UPDATE_DONE_KEY,'1');
        window.location.reload();
        return;
      }
      setStep(s?s.step||'Starting':'Restarting Etiketas');
      const now=Date.now();
      if(s)lastAnswer=now;
      if(now-started>UPDATE_TIMEOUT_MS||now-lastAnswer>UPDATE_DOWN_MS)return fail('Etiketas did not come back after the update. Open it from the Desktop shortcut to see which version is running.');
      timer=setTimeout(poll,1500);
    };
    poll();
    return()=>{alive=false;clearTimeout(timer);};
  },[phase]);
  const install=async()=>{
    if(unsaved.current&&!window.confirm('You have unsaved changes in Settings. Etiketas restarts during the update, so they would be lost. Install anyway?'))return;
    setPhase('starting');setStep('Starting');setFailure(null);
    const r=await api.installUpdate().catch(()=>({ok:false,error:'Could not start the update.'}));
    if(r.ok)setPhase('installing');
    else fail(r.error||'Could not start the update.');
  };
  if(phase==='starting'||phase==='installing')return(
    <Modal title="Installing update">
      <div className="flex items-center gap-3 modal-section">
        <div className="spinner" style={{flexShrink:0}}/>
        <span className="modal-text" style={{margin:0}}>{step}…</span>
      </div>
      <p className="hint modal-section">Etiketas restarts on its own. Please keep this page open.</p>
    </Modal>
  );
  if(phase==='failed')return(
    <Modal title="The update did not install" onEscape={()=>onRemind(1)}>
      <div className="alert alert-error">{failure.error}</div>
      {failure.log&&<p className="hint modal-section">Details are in {failure.log}</p>}
      <div className="modal-section"><button type="button" className="btn btn-primary w-full" onClick={install}>Try again</button></div>
      <RemindButtons onRemind={onRemind}/>
    </Modal>
  );
  const changes=offer.changes??[],shown=changes.slice(0,6),more=changes.length-shown.length;
  return(
    <Modal title="Update available" onEscape={()=>onRemind(1)}>
      <p className="modal-text">A new version of Etiketas is ready to install.</p>
      {shown.length>0&&(
        <div className="modal-section">
          <div className="eyebrow">What's new</div>
          <ul className="update-changes">
            {shown.map((c,i)=>(
              <li key={i}><span>{c.message}</span><time className="mono muted">{new Date(c.date).toLocaleDateString()}</time></li>
            ))}
          </ul>
          {(more>0||offer.truncated)&&<div className="hint">and {more}{offer.truncated?'+':''} more</div>}
        </div>
      )}
      <p className="hint modal-section">Etiketas restarts while it installs. Your labels, settings and shipment are kept.</p>
      <div className="modal-section"><button type="button" className="btn btn-primary w-full" onClick={install}>Install update</button></div>
      <RemindButtons onRemind={onRemind}/>
    </Modal>
  );
}

const UpdatedNotice=({onClose})=>(
  <Modal title="Etiketas is updated" onEscape={onClose}>
    <p className="modal-text">You are on the latest version.</p>
    <div className="modal-section"><button type="button" className="btn btn-primary w-full" onClick={onClose}>OK</button></div>
  </Modal>
);

function App(){
  const [view,setView]=useState('dashboard');
  const [config,setConfig]=useState(null);
  const [map,setMap]=useState(null);
  const [shipping,setShipping]=useState(null);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{
    Promise.all([api.loadConfig(),api.loadMap(),api.getShipping()]).then(([cfg,m,s])=>{setConfig(cfg);setMap(m);setShipping(s);setLoading(false);});
  },[]);
  const saveConfig=useCallback(async cfg=>{await api.saveConfig(cfg);setConfig(cfg);},[]);
  const saveShipping=useCallback(async s=>{const r=await api.saveShipping(s);if(r.ok)setShipping(s);return r;},[]);
  // Settings sets this while it holds unsaved edits, so leaving the page can't lose them silently.
  const unsaved=useRef(false);
  const updates=useUpdates();
  const navigate=v=>{
    if(v===view)return;
    if(unsaved.current&&!window.confirm('You have unsaved changes in Settings. Leave without saving them?'))return;
    unsaved.current=false;
    setView(v);
  };
  const refreshMap=useCallback(async()=>{const m=await api.scanLabels();setMap(m);},[]);
  if(loading)return(
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',flexDirection:'column',gap:20}}>
      <img src="/static/img/Nando-white.png" alt="Etiketas" style={{height:52,opacity:.7}}/>
      <div className="spinner" style={{width:28,height:28,marginTop:4}}/>
      <span style={{color:'var(--text2)',fontSize:13,fontFamily:'var(--font-mono)'}}>Loading Etiketas...</span>
    </div>
  );
  return(
    <>
    <div className="app" {...(updates.offer?{inert:''}:{})}>
      <Sidebar view={view} setView={navigate} map={map} refreshMap={refreshMap}/>
      <div className="main">
        <Topbar view={view} map={map}/>
        <div className={`content${['settings','information'].includes(view)?' no-scroll':''}`}>
          <div key={view} className="view-anim" style={{height:'100%'}}>
            {view==='dashboard'&&<Dashboard map={map} config={config} refreshMap={refreshMap}/>}
            {view==='new'&&<NewLabelWizard config={config} map={map} setMap={setMap}/>}
            {view==='browse'&&<LabelsBrowser map={map} setMap={setMap} config={config}/>}
            {view==='information'&&<Information config={config} map={map} setMap={setMap} shipping={shipping}/>}
            {view==='shipment'&&<Shipment shipping={shipping}/>}
            {view==='settings'&&<Settings config={config} saveConfig={saveConfig} setConfig={setConfig} refreshMap={refreshMap} shipping={shipping} saveShipping={saveShipping} setShipping={setShipping} unsaved={unsaved} checkUpdates={updates.checkNow} files={map?.files}/>}
          </div>
        </div>
      </div>
    </div>
    {updates.offer&&(updates.offer.done
      ?<UpdatedNotice onClose={updates.dismiss}/>
      :<UpdateDialog offer={updates.offer} onRemind={updates.remindIn} unsaved={unsaved}/>)}
    </>
  );
}

function Sidebar({view,setView,map,refreshMap}){
  const total=map?.files?.length??0, wip=map?.files?.filter(f=>f.wip).length??0;
  return(
    <div className="sidebar">
      <div className="sidebar-logo">
        <img src="/static/img/Nando-ico.png" alt="" className="sidebar-logo-mark"/>
        <img src="/static/img/Nando-white.png" alt="Nando" className="sidebar-logo-img"/>
        <div className="sidebar-label">
          <div className="sidebar-logo-text">Etiketas</div>
          <div className="sidebar-logo-sub">Nando Bio</div>
        </div>
      </div>
      <nav className="sidebar-nav">
        {[{id:'dashboard',label:'Dashboard',I:Icon.Dashboard},
          {id:'new',label:'New Label',I:Icon.New},
          {id:'browse',label:'Browse Files',I:Icon.Browse},
          {id:'information',label:'Information',I:Icon.Info},
          {id:'shipment',label:'Shipment',I:Icon.Shipment},
          {id:'settings',label:'Settings',I:Icon.Settings}
        ].map(({id,label,I})=>(
          <button key={id} className={`nav-item ${view===id?'active':''}`} onClick={()=>setView(id)}>
            <I/><span className="sidebar-label">{label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div className="sidebar-stats">
          {total} files &middot; {wip} WIP
        </div>
        <button className="btn btn-ghost btn-sm w-full" onClick={refreshMap}>
          <Icon.Refresh/><span className="sidebar-label">Rescan</span>
        </button>
      </div>
    </div>
  );
}

const SYNC_STATE_INFO = {
  missing:              {color:'var(--danger)',  label:'Labels folder missing',hint:'The labels folder could not be found on disk.'},
  not_linked:           {color:'var(--text3)',   label:'Not shared',           hint:'This folder is a normal local folder -- it is not linked to a shared OneDrive folder. Changes here stay on this device only.'},
  broken:               {color:'var(--danger)',  label:'Shared link broken',   hint:'This folder is linked to another location, but that location no longer exists. Re-link it (see SYNC_SETUP.md).'},
  onedrive_not_running: {color:'var(--warning)', label:'OneDrive not running', hint:'Linked to a OneDrive folder, but OneDrive isn’t currently running -- changes will queue locally until it starts.'},
  active:                {color:'var(--success)', label:'OneDrive active',      hint:'Linked to a OneDrive folder and OneDrive is running -- changes will sync automatically.'},
};

function SyncStatus(){
  const [status,setStatus]=useState(null);
  useEffect(()=>{
    let alive=true;
    const load=()=>api.getSyncStatus().then(r=>{if(alive)setStatus(r);}).catch(()=>{});
    load();
    const id=setInterval(load,30000);
    return ()=>{alive=false;clearInterval(id);};
  },[]);
  if(!status)return null;
  const info=SYNC_STATE_INFO[status.state]??{color:'var(--text3)',label:status.state,hint:''};
  const tooltip=[info.hint,`Folder: ${status.path}`,status.target?`Linked to: ${status.target}`:null].filter(Boolean).join('\n');
  return(
    <div title={tooltip} style={{display:'flex',alignItems:'center',gap:6,marginLeft:'auto',fontSize:11,fontFamily:'var(--font-mono)',color:'var(--text2)',flexShrink:0,cursor:'default'}}>
      <span style={{width:7,height:7,borderRadius:'50%',background:info.color,boxShadow:`0 0 5px ${info.color}`,flexShrink:0}}/>
      {info.label}
    </div>
  );
}

function Topbar({view,map}){
  const titles={dashboard:'Dashboard',new:'New Label',browse:'Browse',information:'Information',shipment:'Shipment',settings:'Settings'};
  return(
    <div className="topbar">
      <span className="topbar-title">{titles[view]}</span>
      {map?.generated&&view!=='shipment'&&(
        <span className="topbar-meta">Updated {new Date(map.generated).toLocaleString()}</span>
      )}
      <SyncStatus/>
    </div>
  );
}

// Ring chart, controlled hover (a segment index, 'center', or null) so a
// wedge, its legend chip, and the center total all drive the same
// highlight + detail readout instead of a plain title-attribute tooltip.
function DonutChart({data,size=92,thickness=14,gapDeg=3,centerLabel='FILES',hover,setHover}){
  const total=data.reduce((s,d)=>s+d.value,0);
  const cx=size/2,cy=size/2,r=(size-thickness)/2;
  const C=2*Math.PI*r;
  const gapPx=total>0?(gapDeg/360)*C:0;
  let acc=0;
  const segs=data.map((d,i)=>{
    const frac=total>0?d.value/total:0,fullLen=frac*C;
    const visible=Math.max(0,fullLen-gapPx);
    const seg={...d,idx:i,dashoffset:-acc,dasharray:`${visible} ${C-visible}`};
    acc+=fullLen;
    return seg;
  });
  const dim=hover!=null&&hover!=='center';
  return(
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{flexShrink:0,overflow:'visible'}}>
      <g transform={`rotate(-90 ${cx} ${cy})`}>
        {segs.map(s=>{
          const [visLen,gapLen]=s.dasharray.split(' ');
          return(
          <g key={s.idx}>
            <circle cx={cx} cy={cy} r={r} fill="none" stroke={s.color}
              strokeWidth={hover===s.idx?thickness+5:thickness}
              strokeDashoffset={s.dashoffset} className="donut-seg"
              style={{'--seg-len':`${visLen}px`,'--seg-gap':`${gapLen}px`,animationDelay:`${s.idx*90}ms`,
                opacity:dim&&hover!==s.idx?0.35:1,transition:'stroke-width .12s,opacity .12s'}}/>
            {s.value>0&&(
              <circle cx={cx} cy={cy} r={r} fill="none" stroke="transparent" strokeWidth={thickness+16}
                strokeDasharray={s.dasharray} strokeDashoffset={s.dashoffset} style={{cursor:'pointer'}}
                onMouseEnter={()=>setHover(s.idx)} onMouseLeave={()=>setHover(v=>v===s.idx?null:v)}/>
            )}
          </g>
          );
        })}
      </g>
      <g onMouseEnter={()=>setHover('center')} onMouseLeave={()=>setHover(v=>v==='center'?null:v)} style={{cursor:'pointer'}}>
        <circle cx={cx} cy={cy} r={r-thickness/2-3} fill="transparent"/>
        <text x={cx} y={cy-size*0.03} textAnchor="middle" style={{fontSize:size*0.2,fontWeight:700,fill:'var(--text)',fontFamily:'var(--font-display)',pointerEvents:'none'}}>{total}</text>
        <text x={cx} y={cy+size*0.14} textAnchor="middle" style={{fontSize:size*0.075,fill:'var(--text3)',fontFamily:'var(--font-mono)',letterSpacing:'.05em',pointerEvents:'none'}}>{centerLabel}</text>
      </g>
    </svg>
  );
}

// Last-30-days creation trend. A single accent-hued line (this is a
// magnitude/trend series, not categorical) with a real crosshair+tooltip,
// plus dashed guides every 7 days so the 30-day span reads as ~4 weeks.
function LineChart30d({history}){
  const [hover,setHover]=useState(null);
  const today=new Date(); today.setHours(0,0,0,0);
  const days=[];
  for(let i=29;i>=0;i--){const d=new Date(today); d.setDate(d.getDate()-i); days.push(d);}
  const counts={};
  for(const h of history){
    if(!h.timestamp)continue;
    const k=h.timestamp.slice(0,10);
    counts[k]=(counts[k]||0)+1;
  }
  const data=days.map(d=>{const key=localDateKey(d);return{date:d,key,count:counts[key]||0};});
  const max=Math.max(1,...data.map(d=>d.count));
  const totalMonth=data.reduce((s,d)=>s+d.count,0);
  const W=760,H=132,padTop=14,padBottom=20,padX=6;
  const plotW=W-padX*2,plotH=H-padTop-padBottom;
  const xFor=i=>padX+(i/(data.length-1))*plotW;
  const yFor=v=>H-padBottom-plotH*(v/max);
  const lineD=data.map((d,i)=>`${i===0?'M':'L'}${xFor(i).toFixed(1)},${yFor(d.count).toFixed(1)}`).join(' ');
  const areaD=`${lineD} L${xFor(data.length-1).toFixed(1)},${H-padBottom} L${xFor(0).toFixed(1)},${H-padBottom} Z`;
  const slotW=plotW/data.length;
  return(
    <div style={{position:'relative'}}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{display:'block',overflow:'visible'}}>
        {[7,14,21].map(off=>(
          <line key={off} className="chart-fade" x1={xFor(29-off)} y1={padTop} x2={xFor(29-off)} y2={H-padBottom} stroke="var(--border2)" strokeWidth={1} strokeDasharray="2 3"/>
        ))}
        <line x1={0} y1={H-padBottom} x2={W} y2={H-padBottom} stroke="var(--border2)" strokeWidth={1}/>
        <g className="line-chart-grow">
          <path d={areaD} fill="rgba(var(--accent-rgb),.09)" stroke="none"/>
          <path d={lineD} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"/>
        </g>
        {hover!=null&&(
          <>
            <line x1={xFor(hover)} y1={padTop} x2={xFor(hover)} y2={H-padBottom} stroke="var(--text3)" strokeWidth={1} strokeDasharray="2 2"/>
            <circle cx={xFor(hover)} cy={yFor(data[hover].count)} r={4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2}/>
          </>
        )}
        {data.map((d,i)=>(
          <rect key={d.key} x={xFor(i)-slotW/2} y={0} width={slotW} height={H}
            fill="transparent" onMouseEnter={()=>setHover(i)} onMouseLeave={()=>setHover(v=>v===i?null:v)}/>
        ))}
        {[0,7,14,21,29].map(i=>(
          <text key={i} x={xFor(i)} y={H-5} textAnchor="middle" style={{fontSize:7.5,fill:'var(--text3)',fontFamily:'var(--font-mono)'}}>
            {data[i].date.toLocaleDateString('en-US',{month:'numeric',day:'numeric'})}
          </text>
        ))}
      </svg>
      {hover!=null&&(
        <div style={{position:'absolute',left:`${xFor(hover)/W*100}%`,top:padTop-2,transform:`translate(${hover>data.length-6?'-100%':hover<6?'0%':'-50%'},-100%)`,background:'var(--text)',color:'var(--surface)',padding:'4px 9px',borderRadius:7,fontSize:11,whiteSpace:'nowrap',pointerEvents:'none',fontFamily:'var(--font-mono)',boxShadow:'0 4px 14px rgba(0,0,0,.3)',zIndex:1}}>
          {data[hover].date.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})} · {data[hover].count} label{data[hover].count===1?'':'s'}
        </div>
      )}
      <div style={{position:'absolute',top:0,right:0,fontSize:10,fontFamily:'var(--font-mono)',color:'var(--text3)'}}>{totalMonth} in last 30 days</div>
    </div>
  );
}

// Hoisted to module scope (not defined inside Dashboard) so these keep a
// stable component identity across Dashboard re-renders -- otherwise React
// tears down and remounts them (and their CSS entrance animations restart)
// every time an unrelated bit of Dashboard state changes.
const InsightCard=({eyebrow,children})=>(
  <div className="stat-card" style={{padding:'var(--space-2) var(--space-4)',display:'flex',flexDirection:'column',justifyContent:'center',minWidth:0}}>
    <div className="stat-label">{eyebrow}</div>
    {children}
  </div>
);
const TopProductCard=({eyebrow,top,empty})=>(
  <InsightCard eyebrow={eyebrow}>
    {top?(
      <div style={{display:'flex',alignItems:'baseline',gap:6,minWidth:0}}>
        <span style={{fontSize:14,fontWeight:700,color:'var(--text)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={top.name}>{top.name}</span>
        <span style={{fontSize:10,color:'var(--text3)',fontFamily:'var(--font-mono)',flexShrink:0}}>{top.count}×</span>
      </div>
    ):<div style={{fontSize:12,color:'var(--text3)',fontStyle:'italic'}}>{empty}</div>}
  </InsightCard>
);
// Donut card: default state is just the ring + a plain legend (dot + label,
// no numbers) -- deliberately sparse. Hovering a wedge, its legend chip, or
// the center all drive the same detail readout in the corner.
const PieCard=({title,data,size,thickness,centerLabel,centerNote})=>{
  const [hover,setHover]=useState(null);
  const t=data.reduce((s,d)=>s+d.value,0);
  const detail=hover==null?null:hover==='center'?{label:title,text:centerNote}:(()=>{
    const d=data[hover],pct=t>0?Math.round(d.value/t*100):0;
    return{label:d.label,text:`${d.value} · ${pct}%${d.desc?' — '+d.desc:''}`};
  })();
  return(
    <div className="card" style={{padding:'12px 20px',display:'flex',alignItems:'center',gap:22,minWidth:0,flex:1,position:'relative',overflow:'hidden',background:'var(--surface)'}}>
      <DonutChart data={data} size={size} thickness={thickness} centerLabel={centerLabel} hover={hover} setHover={setHover}/>
      <div style={{display:'flex',flexDirection:'column',gap:7,minWidth:0}}>
        <div style={{fontSize:11,fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',color:'var(--text3)'}}>{title}</div>
        <div style={{display:'flex',flexWrap:'wrap',gap:'5px 16px',maxWidth:170}}>
          {data.map((d,i)=>d.value>0&&(
            <div key={d.label} onMouseEnter={()=>setHover(i)} onMouseLeave={()=>setHover(v=>v===i?null:v)}
              style={{display:'flex',alignItems:'center',gap:6,fontSize:12,cursor:'pointer',opacity:hover!=null&&hover!==i?0.4:1,transition:'opacity .12s'}}>
              <span style={{width:8,height:8,borderRadius:'50%',background:d.color,flexShrink:0}}/>
              <span style={{color:'var(--text2)',fontWeight:500}}>{d.label}</span>
            </div>
          ))}
        </div>
      </div>
      {detail&&(
        <div style={{position:'absolute',top:10,right:14,background:'var(--text)',color:'var(--surface)',padding:'5px 11px',borderRadius:8,fontSize:11,whiteSpace:'nowrap',boxShadow:'0 4px 14px rgba(0,0,0,.3)',pointerEvents:'none',zIndex:2,fontFamily:'var(--font-mono)'}}>
          <b style={{fontFamily:'var(--font-display)'}}>{detail.label}</b>&nbsp;&nbsp;{detail.text}
        </div>
      )}
    </div>
  );
};
const SectionTitle=({children})=><p className="section-title" style={{flexShrink:0}}>{children}</p>;
const Divider=()=><div style={{height:1,background:'var(--border)',margin:'var(--space-4) 0',flexShrink:0}}/>;

function Dashboard({map,config,refreshMap}){
  const [ingesting,setIngesting]=useState(false);
  const [ingestResult,setIngestResult]=useState(null);
  // null (not []) means "not loaded yet" -- lets the charts wait for real
  // data instead of mounting against an empty placeholder and then jumping
  // to the real values mid-animation once the fetch resolves.
  const [templates,setTemplates]=useState(null);
  const [history,setHistory]=useState(null);
  const dataReady=templates!==null&&history!==null;
  useEffect(()=>{
    api.getTemplates().then(r=>setTemplates(r.templates??[])).catch(()=>setTemplates([]));
    api.getHistory().then(r=>setHistory(r.history??[])).catch(()=>setHistory([]));
  },[]);
  const files=map?.files??[];
  const total=files.length;
  const wip=files.filter(f=>f.wip).length;
  const handleReadFiles=async()=>{
    const pick=await api.pickDir();
    if(!pick.ok||!pick.path)return;
    setIngesting(true); setIngestResult(null);
    const res=await api.ingest(pick.path);
    setIngestResult(res);
    if(res.ok&&res.copied>0)await refreshMap();
    setIngesting(false);
  };
  // Everything below reads templates/history, which are still loading in the
  // background at this point -- render a lightweight placeholder instead of
  // computing (and mounting animated charts) against not-yet-real data.
  if(!dataReady)return(
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',flexDirection:'column',gap:10}}>
      <div className="spinner"/>
      <span style={{color:'var(--text3)',fontSize:12,fontFamily:'var(--font-mono)'}}>Loading dashboard...</span>
    </div>
  );
  const grouped={};
  for(const t of templates){const c=t.category||'Other';if(!grouped[c])grouped[c]=[];grouped[c].push(t);}
  const fmtTime=ts=>{if(!ts)return'';try{const d=new Date(ts);return d.toLocaleDateString('en-US',{month:'short',day:'numeric'})+' '+d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});}catch{return ts.slice(0,16).replace('T',' ');}};

  // Most-created product, all time -- tallied from every file currently on
  // disk (the creation log only goes back ~200 events, nowhere near "all time").
  const catOf=categoryMap(config);
  const topProduct=list=>{
    const counts={};
    for(const item of list){if(item)counts[item]=(counts[item]||0)+1;}
    let best=null;
    for(const [name,count] of Object.entries(counts)){if(!best||count>best.count)best={name,count};}
    return best;
  };
  const topAllTime=topProduct(files.map(f=>f.product));
  // Most-created product this month -- from the creation log (precise
  // timestamps), unlike file counts which can't tell you *when* a file was made.
  const monthKey=localDateKey(new Date()).slice(0,7);
  const historyThisMonth=history.filter(h=>h.timestamp?.startsWith(monthKey));
  const topThisMonth=topProduct(historyThisMonth.map(h=>h.product));
  const madeThisMonth=historyThisMonth.length;
  // CE / MO / PAM split, for the smaller donut.
  const catCounts={CE:0,MO:0,PAM:0};
  for(const f of files){const c=catOf[f.product];if(catCounts[c]!==undefined)catCounts[c]++;}
  const categoryData=[
    {label:'CE',value:catCounts.CE,color:'#AC3A87'},   // same purple as InDesign in the status chart
    {label:'MO',value:catCounts.MO,color:'#2F8E52'},   // saturated company green (brand accent)
    {label:'PAM',value:catCounts.PAM,color:'#397BC2'}, // saturated company blue
  ];
  // File status, all time -- WIP / Unsorted / InDesign / Other are NOT
  // independent flags (a file can be WIP *and* InDesign *and* Unsorted at
  // once), so a pie needs each file bucketed into exactly one slice. Priority
  // order: WIP first (needs attention regardless of anything else), then
  // Unsorted-but-not-WIP, then finished .indd files, then everything else.
  const statusUnsorted=files.filter(f=>!f.wip&&!f.sorted).length;
  const statusIndd=files.filter(f=>!f.wip&&f.sorted&&f.extension==='.indd').length;
  const statusOther=total-wip-statusUnsorted-statusIndd;
  const statusData=[
    {label:'WIP',value:wip,color:'#12847E',desc:'in progress, not yet final'},
    {label:'Unsorted',value:statusUnsorted,color:'#CB4A64',desc:'not filed into a product folder'},
    {label:'InDesign',value:statusIndd,color:'#AC3A87',desc:'finished and filed'},
    {label:'Other',value:statusOther,color:'#9AA0AC',desc:'finished, non-.indd (PDF, IDML...)'},
  ];
  return(
    <div style={{display:'flex',flexDirection:'column',height:'100%',minHeight:780}}>
      <div style={{flexShrink:0,display:'flex',alignItems:'center',gap:'var(--space-3)',flexWrap:'wrap'}}>
        <button className="btn btn-primary" onClick={handleReadFiles} disabled={ingesting}>
          {ingesting?<><div className="spinner" style={{width:14,height:14}}/>Reading files...</>:'Read files from folder'}
        </button>
        {ingestResult&&(
          <span style={{fontSize:13,color:ingestResult.ok?'var(--success)':'var(--danger)'}}>
            {ingestResult.ok
              ?`${ingestResult.copied} file(s) copied, ${ingestResult.skipped} already existed${ingestResult.errors?` (${ingestResult.errors} errors)`:''}`
              :ingestResult.error}
          </span>
        )}
      </div>
      <Divider/>

      <div style={{flexShrink:0}}>
        <SectionTitle>Activity</SectionTitle>
        <div style={{display:'flex',gap:'var(--space-4)'}}>
          <div style={{display:'flex',flexDirection:'column',gap:'var(--space-2)',flex:'0 0 230px'}}>
            <InsightCard eyebrow="Made this month">
              <div className="stat-value" style={{fontSize:22,color:'var(--accent)'}}>{madeThisMonth}</div>
            </InsightCard>
            <TopProductCard eyebrow="Top product · all time" top={topAllTime} empty="No data yet"/>
            <TopProductCard eyebrow="Top product · this month" top={topThisMonth} empty="None yet"/>
          </div>
          <div className="card" style={{padding:'14px 20px 10px',flex:1,minWidth:0}}>
            <LineChart30d history={history}/>
          </div>
        </div>
      </div>
      <Divider/>

      <div style={{flexShrink:0}}>
        <SectionTitle>Composition</SectionTitle>
        <div style={{display:'flex',gap:'var(--space-4)'}}>
          <div style={{flex:'1 1 0'}}>
            <PieCard title="File status" data={statusData} size={128} thickness={19} centerLabel="FILES"
              centerNote="every file, bucketed into exactly one status"/>
          </div>
          <div style={{flex:'1 1 0'}}>
            <PieCard title="Category split" data={categoryData} size={128} thickness={19} centerLabel="MATCHED"
              centerNote="files whose product matched a configured product"/>
          </div>
        </div>
      </div>
      <Divider/>

      <div style={{flex:1,minHeight:0,display:'flex',flexDirection:'column'}}>
        <SectionTitle>Log</SectionTitle>
        <div style={{display:'flex',gap:'var(--space-4)',flex:1,minHeight:0}}>
          <div style={{flex:'0 0 55%',display:'flex',flexDirection:'column',minWidth:0}}>
            <div className="card-title" style={{marginBottom:'var(--space-2)',flexShrink:0}}>Creation History</div>
            <div className="card" style={{flex:1,minHeight:0,overflowY:'auto',padding:0}}>
              {history.length===0?(
                <div style={{padding:'32px 16px',textAlign:'center',color:'var(--text3)',fontSize:13}}>No labels created yet</div>
              ):(
                <table className="table">
                  <thead><tr><th>Time</th><th>Product</th><th>Size</th><th>Languages</th><th>Files</th></tr></thead>
                  <tbody>
                    {history.map((h,i)=>(
                      <tr key={i}>
                        <td style={{fontFamily:'var(--font-mono)',fontSize:11,color:'var(--text3)',whiteSpace:'nowrap'}}>{fmtTime(h.timestamp)}</td>
                        <td style={{fontWeight:500}}>{h.product}</td>
                        <td style={{fontFamily:'var(--font-mono)',fontSize:12}}>{h.packagingSize}</td>
                        <td style={{fontFamily:'var(--font-mono)',fontSize:11}}>{(h.languages??[]).join(' · ')}</td>
                        <td>
                          <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                            {(h.files??[]).map((f,j)=>(
                              <button key={j} className="btn btn-sm" title={f.filename}
                                style={{padding:'2px 7px',fontSize:11,background:'var(--surface3)',border:'1px solid var(--border2)',color:'var(--text2)'}}
                                onClick={()=>api.openFile(f.path)}>
                                <Icon.Open/>{f.type==='box_label'?'Box':'Label'}
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          <div style={{flex:'0 0 calc(45% - var(--space-4))',display:'flex',flexDirection:'column',minWidth:0}}>
            <div className="card-title" style={{marginBottom:'var(--space-2)',flexShrink:0,display:'flex',alignItems:'center',gap:7}}>
              Available Templates
              <span style={{fontSize:10,fontFamily:'var(--font-mono)',fontWeight:500,color:'var(--accent)',background:'rgba(var(--accent-rgb),.12)',padding:'1px 7px',borderRadius:8}}>{templates.length}</span>
            </div>
            <div className="card" style={{flex:1,minHeight:0,overflowY:'auto',padding:0}}>
            {templates.length===0?(
              <div style={{padding:'32px 16px',textAlign:'center',color:'var(--text3)',fontSize:13}}>No templates found</div>
            ):(
              Object.entries(grouped).sort().map(([cat,tmplList])=>(
                <div key={cat}>
                  <div style={{padding:'7px 14px 4px',fontSize:11,fontWeight:700,letterSpacing:'0.06em',textTransform:'uppercase',color:CAT_STYLE[cat]?.color??'var(--text3)',borderBottom:'1px solid var(--border2)',background:'var(--surface2)',position:'sticky',top:0}}>
                    {cat} <span style={{fontWeight:400,opacity:.6}}>({tmplList.length})</span>
                  </div>
                  {tmplList.map((t,i)=>(
                    <div key={i} style={{display:'flex',alignItems:'center',gap:8,padding:'5px 14px',borderBottom:'1px solid var(--border)',fontSize:12}}>
                      <span style={{flex:1,fontFamily:'var(--font-mono)',fontSize:11,color:'var(--text2)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={t.filename}>{t.filename.replace(/\.idml$/i,'')}</span>
                      <span style={{flexShrink:0,fontSize:10,fontFamily:'var(--font-mono)',color:'var(--text3)'}}>{t.dimensions}</span>
                      {t.deze?<span className="badge badge-pam" style={{fontSize:9}}>Box</span>:<span className="badge badge-ok" style={{fontSize:9}}>Label</span>}
                      <button className="btn btn-sm" style={{padding:'2px 6px',flexShrink:0}} title="Reveal in Explorer" onClick={()=>api.revealFile(t.path)}><Icon.Folder/></button>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}

// Brand mark echoing the actual Nando logo chevron: exactly 3 sticks at a
// true 45 degrees, joined by 2 rounded intersections -- 5 brand colors laid
// out sequentially along the mark, same as the real logo's color-blocking.
function BrandZigzag({colors,height=40,animated=false}){
  const c=(colors&&colors.length?colors:Array(6).fill('#808080')).map(x=>x||'#808080');
  const sw=height*0.36;             // thick stroke, matches the logo's bold strokes
  const d=height-sw;                // vertical travel per stick -- equal to horizontal travel, so each stick is a true 45deg diagonal
  const w=3*d+sw;
  const half=sw/2;
  const p0=[half,d+half], p1=[d+half,half], p2=[2*d+half,d+half], p3=[3*d+half,half];
  // Path order matches the real logo's sequential color-blocking: stick, joint, stick, joint, stick.
  const stickProps=delay=>animated?{pathLength:1,strokeDasharray:1,className:'zz-stick',style:{animationDelay:`${delay}ms`}}:{};
  const jointProps=delay=>animated?{className:'zz-joint',style:{animationDelay:`${delay}ms`}}:{};
  return(
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} style={{display:'block',overflow:'visible'}} preserveAspectRatio="xMinYMid meet">
      <line x1={p0[0]} y1={p0[1]} x2={p1[0]} y2={p1[1]} stroke={c[0]} strokeWidth={sw} strokeLinecap="round" {...stickProps(0)}><title>{c[0]}</title></line>
      <line x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} stroke={c[2]} strokeWidth={sw} strokeLinecap="round" {...stickProps(260)}><title>{c[2]}</title></line>
      <line x1={p2[0]} y1={p2[1]} x2={p3[0]} y2={p3[1]} stroke={c[4]} strokeWidth={sw} strokeLinecap="round" {...stickProps(520)}><title>{c[4]}</title></line>
      <circle cx={p1[0]} cy={p1[1]} r={half} fill={c[1]} {...jointProps(220)}><title>{c[1]}</title></circle>
      <circle cx={p2[0]} cy={p2[1]} r={half} fill={c[3]} {...jointProps(480)}><title>{c[3]}</title></circle>
    </svg>
  );
}

// Review-step list of candidate templates for one of the two files being created.
const ReasonBadge=({r})=>{
  const s=r.type==='match'?{background:'rgba(var(--accent-rgb),.15)',color:'var(--success)'}
    :r.type==='warn'?{background:'rgba(var(--warning-rgb),.15)',color:'var(--warning)'}
    :{background:'var(--surface3)',color:'var(--text3)'};
  return <span style={{...s,fontSize:10,padding:'1px 6px',borderRadius:3,fontFamily:'var(--font-mono)',whiteSpace:'nowrap'}}>{r.text}</span>;
};
const TemplatePicker=({items,selected,onSelect,title,newName,skipped})=>(
  <div style={{marginBottom:14,opacity:skipped?.5:1,transition:'opacity .2s'}}>
    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
      <div style={{fontSize:11,fontWeight:500,color:'var(--text2)',textTransform:'uppercase',letterSpacing:'.06em'}}>{title}</div>
      {skipped&&<span style={{fontSize:10,fontFamily:'var(--font-mono)',padding:'1px 7px',borderRadius:10,background:'rgba(var(--warning-rgb),.15)',color:'var(--warning)',border:'1px solid rgba(var(--warning-rgb),.3)'}}>skipped</span>}
    </div>
    {items&&items.length>0?(
      items.map((item,idx)=>(
        <div key={idx} onClick={()=>onSelect(selected===idx?null:idx)} style={{background:selected===idx?'var(--accent-dim)':'var(--surface2)',border:'1px solid '+(selected===idx?'var(--accent)':'var(--border2)'),borderRadius:'var(--radius-sm)',padding:'10px 12px',marginBottom:6,cursor:'pointer',transition:'all .15s'}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
            <span style={{fontFamily:'var(--font-mono)',fontSize:11,color:selected===idx?'var(--accent)':'var(--text2)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1,marginRight:8}}>{item.file.filename}</span>
            <span className={'match-score '+scoreLabel(item.score).cls}>{scoreLabel(item.score).label} ({item.score}pts)</span>
          </div>
          <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
            {(item.reasons||[]).map((r,i)=><ReasonBadge key={i} r={r}/>)}
          </div>
        </div>
      ))
    ):(
      <div style={{fontSize:12,color:'var(--text3)',fontStyle:'italic',padding:'8px 0'}}>{skipped?'Will not be created':'No template found -- empty file will be created'}</div>
    )}
    {!skipped&&<div style={{fontSize:11,color:'var(--text3)',marginTop:6}}>Will be saved as: <span style={{fontFamily:'var(--font-mono)',color:'var(--accent)'}}>{newName}</span></div>}
  </div>
);

function NewLabelWizard({config,map,setMap}){
  const removeFile=p=>removeFromMap(setMap,p);
  const [step,setStep]=useState(1);
  const [product,setProduct]=useState(null);
  const [languages,setLanguages]=useState([]);
  const [size,setSize]=useState(null);
  const [tmplInfo,setTmplInfo]=useState(null);
  const [loading,setLoading]=useState(false);
  const [result,setResult]=useState(null);
  const [search,setSearch]=useState('');
  const [langSearch,setLangSearch]=useState('');
  const [langSort,setLangSort]=useLangSort();
  const [selectedLabel,setSelectedLabel]=useState(0);
  const [selectedBox,setSelectedBox]=useState(0);
  const [reviewTab,setReviewTab]=useState('template');
  const [langFiles,setLangFiles]=useState([]);
  const [transFiles,setTransFiles]=useState([]);
  const [prodColors,setProdColors]=useState({});
  const [prodAssets,setProdAssets]=useState({});
  const [sku,setSku]=useState('');
  useEffect(()=>{api.getColors().then(r=>{if(r?.colors)setProdColors(r.colors);});},[]);
  useEffect(()=>{api.checkAssets().then(r=>{if(r&&!r.error)setProdAssets(r);});},[]);
  const enabledProducts=(config?.products??[]).filter(p=>p.enabled).sort((a,b)=>a.name.localeCompare(b.name));
  const allLangs=config?.languages??[];
  const usage=useMemo(()=>langUsage(map?.files),[map]);
  const shownLangs=useMemo(()=>sortLangs(allLangs.filter(l=>l.enabled&&matchesSearch(langText(l),langSearch)),langSort,usage),[allLangs,langSearch,langSort,usage]);
  const langOf=code=>allLangs.find(l=>l.code===code);
  const translationsByName=useMemo(()=>[...transFiles].sort((a,b)=>a.name.localeCompare(b.name)||(a.product??'').localeCompare(b.product??'')),[transFiles]);
  const translationOption=f=><option key={f.path} value={f.path}>{f.name} ({f.code}){f.product?` — ${f.product}`:''}{f.status==='draft'?' — draft':''}</option>;
  const productCfg=product?config.products.find(p=>p.name===product):null;
  const dimKey=dimKeyFor(productCfg);
  const sizes=dimKey?(config?.packagingSizes?.[dimKey]??[]):[];
  const filtered=enabledProducts.filter(p=>matchesSearch(p.name,search));
  useEffect(()=>{
    setLangFiles(languages.map(code=>translationFor(transFiles,code,product)?.path??null));
  },[languages,transFiles]);
  // These two run when a step is entered and read the selections made by then.
  useEffect(()=>{
    if(step===3&&transFiles.length===0)
      api.listTranslations().then(r=>{if(r?.files)setTransFiles(r.files);});
  },[step]);
  useEffect(()=>{
    if(step!==5||!product||!languages.length||!size)return;
    // A size with no entry on the cheat sheet has no box label. It can still be picked for a one-off.
    setLoading(true);setSelectedLabel(0);setSelectedBox(config?.boxMultipliers?.[size]?0:null);
    api.findTemplate({product,languages,packagingSize:size,langFiles}).then(info=>{setTmplInfo(info);setLoading(false);});
  },[step]);
  const reset=()=>{setStep(1);setProduct(null);setLanguages([]);setSize(null);setTmplInfo(null);setResult(null);setSearch('');setLangSearch('');setSelectedLabel(0);setSelectedBox(0);setReviewTab('template');setLangFiles([]);setTransFiles([]);setSku('');};
  const toggleLang=code=>setLanguages(prev=>prev.includes(code)?prev.filter(c=>c!==code):prev.length<3?[...prev,code]:prev);
  const handleCreate=async()=>{
    setLoading(true);
    const skipLabel=selectedLabel===null;
    const skipBox=selectedBox===null;
    const labelPath=skipLabel?null:(tmplInfo?.labels?.[selectedLabel]?.file?.path??null);
    const boxPath=skipBox?null:(tmplInfo?.boxes?.[selectedBox]?.file?.path??null);
    const res=await api.createLabel({product,languages,packagingSize:size,labelTemplatePath:labelPath,boxTemplatePath:boxPath,langFiles,footerValues:sku?{sku}:null,skipLabel,skipBox});
    if(res.success&&res.results?.length){const m=await api.loadMap();setMap(m);}
    setResult(res);setLoading(false);setStep(6);
  };
  const now=new Date(),dateStr=now.getFullYear()+'_'+String(now.getMonth()+1).padStart(2,'0');
  const boxMult=size?(config?.boxMultipliers?.[size]??size):'';
  const dims=tmplInfo?.dimensions??'?x?';
  const langStr=languages.join('_');
  const labelExt=tmplInfo?.labels?.[selectedLabel]?.file?.extension??'.idml';
  const boxExt=tmplInfo?.boxes?.[selectedBox]?.file?.extension??'.idml';
  const prevLabel=product&&size&&languages.length?product+'_'+size+'_'+langStr+'_'+dims+'_'+dateStr+'_WIP'+labelExt:'--';
  const prevBox=product&&size&&languages.length?product+'_'+boxMult+'_'+langStr+'_180x180_'+dateStr+'_deze_WIP'+boxExt:'--';
  const relatedFiles=(map?.files??[]).filter(f=>
    f.product===product&&f.extension==='.indd'&&!f.wip&&
    f.languages&&languages.some(l=>f.languages.includes(l))
  );
  return(
    <div style={{display:'flex',flexDirection:'column',height:'100%',minHeight:0,maxWidth:720}}>
      {step<6&&(
        <div className="wizard-steps" style={{flexShrink:0}}>
          {['Product','Languages','Translations','Size','Review'].map((label,i)=>{
            const n=i+1,cls=n<step?'done':n===step?'active':'future';
            return(
              <Fragment key={n}>
                <div className="step-wrap">
                  <div className={'step-circle '+cls}>{n<step?<Icon.Check/>:n}</div>
                  <div className="step-label" style={{color:n===step?'var(--text)':'var(--text3)'}}>{label}</div>
                </div>
                {i<4&&<div className={'step-line '+(n<step?'done':'')}/>}
              </Fragment>
            );
          })}
        </div>
      )}
      {step===1&&(
        <div style={{display:'flex',flexDirection:'column',flex:1,minHeight:0}}>
          <div className="field" style={{flexShrink:0}}>
            <div className="search-wrap">
              <span className="search-icon"><Icon.Search size={14}/></span>
              <input className="input" placeholder="Search products..." value={search} onChange={e=>setSearch(e.target.value)} autoFocus/>
            </div>
          </div>
          <div className="product-grid" style={{flex:1,alignContent:'start'}}>
            {filtered.map(p=>(
              <button key={p.name} className={'select-card product-card '+(product===p.name?'selected':'')}
                onClick={()=>setProduct(p.name)}
                onDoubleClick={()=>{setProduct(p.name);setStep(2);}}>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <div title={prodAssets[p.name]?.logo?'Logo on file':'No logo found'} style={{height:30,minWidth:30,maxWidth:78,padding:'3px 7px',borderRadius:8,background:'rgba(255,255,255,.94)',display:'flex',alignItems:'center',justifyContent:'center',overflow:'hidden',flexShrink:0,boxShadow:'0 1px 4px var(--shadow-sm)'}}>
                    {prodAssets[p.name]?.logo?(
                      <img src={`/api/logo_thumb?product=${encodeURIComponent(p.name)}`} alt="" style={{maxWidth:'100%',maxHeight:'100%',objectFit:'contain'}}/>
                    ):(
                      <span style={{fontSize:12,fontWeight:700,color:'#999',fontFamily:'var(--font-display)'}}>{p.name.slice(0,1)}</span>
                    )}
                  </div>
                  <div className="product-name" style={{flex:1,marginBottom:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontWeight:700,color:(prodColors[p.name]||[])[5]||'var(--text)'}}>{p.name}</div>
                </div>
                <div style={{display:'flex',gap:6,marginTop:8}}>
                  <span style={{padding:'1px 7px',borderRadius:3,fontSize:10,fontFamily:'var(--font-mono)',background:catStyle(p.category).bg,color:catStyle(p.category).color}}>{p.category}</span>
                  {p.acidic&&<span className="acidic-badge">acidic</span>}
                </div>
                <div style={{marginTop:10}}>
                  <BrandZigzag colors={prodColors[p.name]}/>
                </div>
              </button>
            ))}
          </div>
          <div className="flex mt-4" style={{flexShrink:0}}><button className="btn btn-primary ml-auto" disabled={!product} onClick={()=>setStep(2)}>Next &rarr;</button></div>

        </div>
      )}
      {step===2&&(
        <div style={{display:'flex',flexDirection:'column',flex:1,minHeight:0}}>
          <div style={{flexShrink:0,marginBottom:'var(--space-3)'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
              <span style={{fontSize:13,color:'var(--text2)'}}>Select up to 3 languages</span>
              <span style={{fontFamily:'var(--font-mono)',fontSize:13,color:languages.length>0?'var(--accent)':'var(--text3)'}}>{languages.length}/3</span>
            </div>
            <div style={{height:30,display:'flex',gap:6,alignItems:'center'}}>
              {languages.length===0
                ?<span style={{fontSize:12,color:'var(--text3)',fontStyle:'italic'}}>No languages selected yet</span>
                :languages.map(code=>(
                  <button key={code} type="button" className="lang-chip" title="Remove" onClick={()=>toggleLang(code)}>
                    <b>{code}</b> {langOf(code)?.name} <span style={{opacity:.5}}>×</span>
                  </button>
                ))
              }
            </div>
            <div className="flex gap-2 items-center" style={{marginTop:'var(--space-2)'}}>
              <div className="search-wrap" style={{flex:1}}>
                <span className="search-icon"><Icon.Search size={14}/></span>
                <input className="input" placeholder="Search languages..." aria-label="Search languages" value={langSearch} onChange={e=>setLangSearch(e.target.value)} autoFocus/>
              </div>
              <LangSortToggle sort={langSort} onChange={setLangSort}/>
            </div>
          </div>
          <div className="lang-grid" style={{flex:1,alignContent:'start'}}>
            {langGroups(shownLangs,langSort,usage).map(g=>(
              <Fragment key={g.title??'all'}>
                {g.title&&<div className="eyebrow lang-group">{g.title}</div>}
                {g.items.map(l=>{
                  const sel=languages.includes(l.code),dis=!sel&&languages.length>=3;
                  return(
                    <button key={l.code} type="button" disabled={dis} className={'select-card lang-card '+(sel?'selected':'')+(dis?' disabled':'')}
                      onClick={e=>{if(e.detail<=1)toggleLang(l.code);}}
                      onDoubleClick={()=>{
                        const next=sel?languages:[...languages,l.code];
                        setLanguages(next);setStep(3);
                      }}>
                      <span className="lang-code">{l.code}</span>
                      <span className="lang-name" title={l.alt?`${l.name} (also: ${l.alt})`:l.name}>{l.name}</span>
                      {sel?<Icon.Check/>:usage[l.code]>0&&<span className="lang-count" title={fileCount(usage[l.code])}>{usage[l.code]}</span>}
                    </button>
                  );
                })}
              </Fragment>
            ))}
            {shownLangs.length===0&&<div className="lang-none">No language matches “{langSearch.trim()}”.</div>}
          </div>
          <div className="flex mt-4 gap-2" style={{flexShrink:0}}>
            <button className="btn btn-ghost" onClick={()=>setStep(1)}>&larr; Back</button>
            <button className="btn btn-primary ml-auto" disabled={languages.length===0} onClick={()=>setStep(3)}>Next &rarr;</button>

          </div>
        </div>
      )}
      {step===3&&(
        <div style={{display:'flex',flexDirection:'column',flex:1,minHeight:0}}>
          <div style={{flexShrink:0,marginBottom:'var(--space-4)',fontSize:'var(--fs-md)',color:'var(--text2)'}}>
            Optionally assign a translation file to each language slot. Leave blank to keep the template text.
          </div>
          <div className="scroll-y">
            {languages.map((code,i)=>{
              const l=langOf(code);
              return(
                <div key={code} className="card-flat" style={{marginBottom:'var(--space-2)',borderColor:'var(--border2)'}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
                    <span style={{fontWeight:500,color:'var(--text)'}}>{l?.name??code}</span>
                    <span style={{fontFamily:'var(--font-mono)',fontSize:11,color:'var(--text3)',background:'var(--surface3)',padding:'2px 6px',borderRadius:3}}>{code}</span>
                    <span style={{fontSize:11,color:'var(--text3)',marginLeft:'auto'}}>Slot LANG{i+1}</span>
                  </div>
                  <select className="input"
                    style={{color:langFiles[i]?'var(--text)':'var(--text3)',fontSize:'var(--fs-sm)'}}
                    value={langFiles[i]??''}
                    onChange={e=>{const v=e.target.value||null;setLangFiles(prev=>{const n=[...prev];n[i]=v;return n;})}}>
                    <option value=''>— Skip (keep template text) —</option>
                    {translationsByName.some(f=>f.code===code)&&<optgroup label={l?.name??code}>{translationsByName.filter(f=>f.code===code).map(translationOption)}</optgroup>}
                    {translationsByName.some(f=>f.code!==code)&&<optgroup label="Other languages">{translationsByName.filter(f=>f.code!==code).map(translationOption)}</optgroup>}
                  </select>
                  {(()=>{const sel=transFiles.find(f=>f.path===langFiles[i]);return sel?.product&&!sameProduct(sel.product,product)?(<div style={{marginTop:6,fontSize:11,color:'var(--warning)',display:'flex',alignItems:'center',gap:5}}><span>⚠</span><span>This file is for <strong>{sel.product}</strong>, not <strong>{product}</strong>. The text may not match.</span></div>):null;})()}
                  {(()=>{const sel=transFiles.find(f=>f.path===langFiles[i]);return sel?.status==='draft'?(<div style={{marginTop:6,fontSize:11,color:'var(--warning)',display:'flex',alignItems:'center',gap:5}}><span>⚠</span><span>This translation is marked <strong>draft</strong> — some fields may still be blank. Check it in Etiketas+ before using it on a real label.</span></div>):null;})()}
                </div>
              );
            })}
            {transFiles.length===0&&(
              <div style={{fontSize:12,color:'var(--text3)',fontStyle:'italic',padding:'8px 0'}}>No translation files found in translations/ folder.</div>
            )}
            {/* Label footer details */}
            <div style={{marginTop:16,borderTop:'1px solid var(--border2)',paddingTop:14}}>
              <div style={{fontSize:11,fontWeight:500,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:10}}>
                Label details <span style={{fontSize:10,fontWeight:400,textTransform:'none',letterSpacing:0,color:'var(--text3)'}}>— optional, written into the label footer</span>
              </div>
              <div>
                <div style={{fontSize:11,color:'var(--text2)',marginBottom:4}}>SKU code</div>
                <input className="input" type="text" value={sku} onChange={e=>setSku(e.target.value)} placeholder="e.g. FNS-1L-001" style={{width:'100%',boxSizing:'border-box'}}/>
              </div>
            </div>
          </div>
          <div style={{flexShrink:0}}>
            <div style={{minHeight:22,display:'flex',alignItems:'center',marginBottom:6}}>
              {!sku&&<span style={{fontSize:11,color:'var(--warning)'}}>&#9888; No SKU provided</span>}
            </div>
            <div className="flex gap-2">
              <button className="btn btn-ghost" onClick={()=>setStep(2)}>&larr; Back</button>
              <button className="btn btn-primary ml-auto" onClick={()=>setStep(4)}>Next &rarr;</button>
            </div>
          </div>
        </div>
      )}
      {step===4&&(
        <div style={{display:'flex',flexDirection:'column',flex:1,minHeight:0}}>
          <div style={{flexShrink:0,marginBottom:'var(--space-4)',fontSize:'var(--fs-md)',color:'var(--text2)'}}>
            {productCfg?.category==='PAM'?'PAM (Adjuvant)':productCfg?.category==='CE'?'CE (Crop Enhancement)':'MO (Biostimulant)'}
            {productCfg?.acidic&&<span className="acidic-badge" style={{marginLeft:8}}>acidic sizing</span>}
          </div>
          <div className="size-grid" style={{flexShrink:0}}>
            {sizes.map(s=>{
              const d=config?.dimensions?.[dimKey]?.[s];
              return(
                <div key={s} className={'select-card size-card '+(size===s?'selected':'')}
                  onClick={()=>setSize(s)}
                  onDoubleClick={()=>{setSize(s);setStep(5);}}>
                  <div className="size-label">{s}</div>
                  <div className="size-dims">{d??'--'}</div>
                </div>
              );
            })}
          </div>
          <div className="flex mt-4 gap-2" style={{flexShrink:0}}>
            <button className="btn btn-ghost" onClick={()=>setStep(3)}>&larr; Back</button>
            <button className="btn btn-primary ml-auto" disabled={!size} onClick={()=>setStep(5)}>Next &rarr;</button>
          </div>
        </div>
      )}
      {step===5&&(
        <div style={{display:'flex',flexDirection:'column',flex:1,minHeight:0}}>
          <div style={{flexShrink:0}}>
            <div className="review-row"><span className="review-label">Product</span><span className="review-value" style={{fontWeight:500}}>{product}</span></div>
            <div className="review-row"><span className="review-label">Languages</span><span className="review-value">{languages.map(c=>`${c} ${langOf(c)?.name??''}`.trim()).join(' · ')}</span></div>
            <div className="review-row"><span className="review-label">Size</span><span className="review-value">{size} <span style={{color:'var(--text3)',fontFamily:'var(--font-mono)',fontSize:11}}>{tmplInfo?.dimensions}</span></span></div>
            {tmplInfo?.shelfLife?.texts?.length>0&&(
              <div className="review-row"><span className="review-label">Shelf life</span>
                <span className="review-value">
                  {[...new Set(tmplInfo.shelfLife.texts.map(t=>t.text||'–'))].join(' · ')}{' '}
                  <span style={{color:'var(--text3)',fontSize:11}}>{tmplInfo.shelfLife.sheet?`from the data sheet for ${tmplInfo.shelfLife.sheet}`:'from the translation, as there is no data sheet'}</span>
                  {tmplInfo.shelfLife.texts.some(t=>t.kept)&&<div className="ship-warn" style={{fontSize:11,marginTop:2}}>&#9888; The data sheet says {tmplInfo.shelfLife.months} months, but the {tmplInfo.shelfLife.texts.filter(t=>t.kept).map(t=>t.code).join(', ')} text can't be changed automatically. Check it on the label.</div>}
                </span>
              </div>
            )}
            {tmplInfo?.shelfLife?.sheet&&tmplInfo.shelfLife.storageMin!=null&&(
              <div className="review-row"><span className="review-label">Storage</span><span className="review-value">{fmtStorage(tmplInfo.shelfLife)} <span style={{color:'var(--text3)',fontSize:11}}>from the data sheet</span></span></div>
            )}
            <div className="divider" style={{margin:'12px 0'}}/>
            <div className="tabs" style={{marginBottom:'var(--space-3)'}}>
              {['template','related'].map(t=>(
                <button key={t} onClick={()=>setReviewTab(t)} className={`tab ${reviewTab===t?'active':''}`}>
                  {t==='template'?'Template':'Related'+(relatedFiles.length?' ('+relatedFiles.length+')':'')}
                </button>
              ))}
            </div>
          </div>
          <div className="scroll-y">
            {loading?(
              <div className="flex items-center gap-3" style={{padding:'20px 0'}}>
                <div className="spinner"/><span style={{color:'var(--text2)'}}>Finding best templates...</span>
              </div>
            ):reviewTab==='template'?(
              <>
                <TemplatePicker items={tmplInfo?.labels} selected={selectedLabel} onSelect={setSelectedLabel} title="Packaging Label Template" newName={prevLabel} skipped={selectedLabel===null}/>
                <TemplatePicker items={tmplInfo?.boxes} selected={selectedBox} onSelect={setSelectedBox} title="Box Label Template" newName={prevBox} skipped={selectedBox===null}/>
                {(selectedLabel===null)!==(selectedBox===null)&&(
                  <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',borderRadius:'var(--radius-sm)',background:'rgba(var(--warning-rgb),.1)',border:'1px solid rgba(var(--warning-rgb),.25)',fontSize:12,color:'var(--warning)',marginTop:4}}>
                    <span style={{fontSize:14}}>⚠</span>
                    {selectedLabel===null?'Only the box label will be created — packaging label is skipped.':config?.boxMultipliers?.[size]?'Only the packaging label will be created — box label is skipped.':`${size} packs have no box label, so only the packaging label will be created.`}
                  </div>
                )}
              </>
            ):(
              relatedFiles.length===0?(
                <div style={{color:'var(--text3)',fontSize:13,fontStyle:'italic',padding:'16px 0'}}>No related labels found for {product} with selected languages.</div>
              ):(
                <div className="card" style={{padding:0,overflow:'hidden'}}>
                  <table className="table">
                    <thead><tr><th>Filename</th><th>Languages</th><th>Size</th><th>Date</th><th></th></tr></thead>
                    <tbody>
                      {relatedFiles.map(f=>(
                        <tr key={f.filename+f.path}>
                          <td className="path-cell" title={f.path}>{f.filename}</td>
                          <td style={{fontFamily:'var(--font-mono)',fontSize:12}}>{f.languages?.join(' . ')??'--'}</td>
                          <td style={{fontFamily:'var(--font-mono)',fontSize:12}}>{f.packaging??'--'}</td>
                          <td style={{fontFamily:'var(--font-mono)',fontSize:11,color:'var(--text3)'}}>{f.date??'--'}</td>
                          <td><FileActions path={f.path} onDeleted={removeFile} sharepointBase={config?.sharepointBaseUrl}/></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>
          <div className="flex mt-4 gap-2" style={{flexShrink:0}}>
            <button className="btn btn-ghost" onClick={()=>setStep(4)}>&larr; Back</button>
            <button className="btn btn-primary ml-auto btn-lg" disabled={loading||( selectedLabel===null&&selectedBox===null)} onClick={handleCreate}>
              {loading?<><div className="spinner"/>Creating...</>:selectedLabel===null&&selectedBox===null?'Nothing selected':selectedLabel===null?'Create Box Only':selectedBox===null?'Create Label Only':'Create Labels'}
            </button>
          </div>
        </div>
      )}
      {step===6&&result&&(
        <div style={{overflowY:'auto',flex:1}}>
          {result.success?(
            <div className="result-success">
              <div className="result-icon">&#10003;</div>
              <div className="result-title">Labels created!</div>
              <div className="result-files">
                {result.results?.map((r,i)=>{
                  const ops=r.ops||{};
                  const isBox=r.type==='box_label';
                  const transOps=(ops.translations??[])
                    .map((val,i)=>{
                      if(val===null||val===undefined)return null;
                      return {key:`lang${i+1}`,label:languages[i]??'',val};
                    }).filter(Boolean);
                  const opRows=[
                    {key:'colors', label:'Color swatches', val:ops.colors},
                    ...(!isBox?[{key:'qr', label:'QR code', val:ops.qr}]:[]),
                    ...(!isBox?[{key:'icons', label:'Trait icons', val:ops.icons, hint:'Fails if the product has more traits assigned than the template has TRAIT_SLOT frames'}]:[]),
                    {key:'logo',   label:'Logo',           val:ops.logo},
                    ...transOps,
                  ];
                  return(
                    <div key={i} className="result-file" style={{flexDirection:'column',alignItems:'stretch',gap:8}}>
                      <div style={{display:'flex',alignItems:'center',gap:10}}>
                        <div style={{fontSize:20,flexShrink:0}}>{isBox?'📦':'🏷️'}</div>
                        <div style={{flex:1,minWidth:0}}>
                          <div className="result-file-name">{r.filename}</div>
                          <div className="result-file-info">{isBox?'Box label':'Packaging label'}{r.template?' · from: '+r.template:' · no template'}</div>
                        </div>
                        <div style={{display:'flex',gap:6}}>
                          <button className="btn btn-ghost btn-sm" style={{color:'var(--indd)',borderColor:'rgba(var(--indd-rgb),.3)'}} onClick={()=>api.openFile(r.path)}>Open</button>
                          <button className="btn btn-folder btn-sm" onClick={()=>api.revealFile(r.path)}>Reveal</button>
                        </div>
                      </div>
                      <div style={{display:'flex',gap:8,flexWrap:'wrap',paddingLeft:30}}>
                        {opRows.map(({key,label,val,hint})=>{
                          const ok=val===true;
                          const na=val===null||val===undefined;
                          return(
                            <span key={key} title={hint} style={{
                              display:'inline-flex',alignItems:'center',gap:4,
                              fontSize:11,fontFamily:'var(--font-mono)',
                              padding:'2px 8px',borderRadius:10,
                              background:na?'var(--surface3)':ok?'rgba(var(--accent-rgb),.13)':'rgba(var(--danger-rgb),.13)',
                              color:na?'var(--text3)':ok?'var(--success)':'var(--danger)',
                              border:'1px solid '+(na?'var(--border2)':ok?'rgba(var(--accent-rgb),.3)':'rgba(var(--danger-rgb),.3)'),
                            }}>
                              {na?'–':ok?'✓':'✗'} {label}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-3 justify-between" style={{marginTop:16}}>
                <button className="btn btn-ghost" onClick={reset}>Create another</button>
                <button className="btn btn-primary" onClick={()=>window.location.reload()}>Done</button>
              </div>
            </div>
          ):(
            <div className="result-success">
              <div className="result-icon">&#10007;</div>
              <div className="result-title">Something went wrong</div>
              <div className="alert alert-error mt-3">{result.error}</div>
              <button className="btn btn-ghost mt-4" onClick={()=>setStep(5)}>&larr; Try again</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
// Label sizes per category, with the product's own category highlighted.
const DIM_ROWS=[['PAM_normal','PAM Normal','var(--pam)'],['PAM_acidic','PAM Acidic','var(--warning)'],['MO','MO','var(--mo)'],['MO_liquid','MO Liquid','var(--mo)'],['CE','CE','var(--ce)'],['CE_solid','CE Solid','var(--ce)']];
function SizeTable({config,dimKey}){
  return(
    <div style={{display:'flex',flexDirection:'column',gap:10}}>
      {DIM_ROWS.map(([key,label,clr])=>{
        const isActive=dimKey===key;
        const entries=Object.entries(config?.dimensions?.[key]??{});
        if(!entries.length)return null;
        return(
          <div key={key}>
            <div style={{fontSize:10,fontFamily:'var(--font-mono)',color:isActive?clr:'var(--text3)',fontWeight:isActive?700:400,textTransform:'uppercase',letterSpacing:'.05em',marginBottom:6}}>{label}</div>
            <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
              {entries.map(([sz,dims])=>(
                <div key={sz} style={{background:isActive?'var(--surface2)':'var(--surface3)',border:'1px solid '+(isActive?clr:'var(--border2)'),borderRadius:6,padding:'6px 11px',textAlign:'center',minWidth:64,transition:'all .2s'}}>
                  <div style={{fontSize:12,fontWeight:600,fontFamily:'var(--font-display)',color:isActive?'var(--text)':'var(--text3)'}}>{sz}</div>
                  <div style={{fontSize:10,fontFamily:'var(--font-mono)',color:'var(--text3)',marginTop:2}}>{dims}mm</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      <div>
        <div style={{fontSize:10,fontFamily:'var(--font-mono)',color:'var(--text3)',fontWeight:500,textTransform:'uppercase',letterSpacing:'.05em',marginBottom:6}}>Box</div>
        <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
          {Object.entries(config?.boxMultipliers??{}).map(([sz,box])=>(
            <div key={sz} style={{background:'var(--surface3)',border:'1px solid var(--border2)',borderRadius:6,padding:'6px 11px',textAlign:'center',minWidth:64}}>
              <div style={{fontSize:11,fontFamily:'var(--font-mono)',color:'var(--text3)'}}>{sz}</div>
              <div style={{fontSize:11,fontWeight:600,fontFamily:'var(--font-display)',color:'var(--text)',marginTop:2}}>{box}</div>
            </div>
          ))}
          {[...new Set(Object.values(config?.packagingSizes??{}).flat())].filter(sz=>!config?.boxMultipliers?.[sz]).map(sz=>(
            <div key={sz} style={{background:'var(--surface3)',border:'1px solid var(--border2)',borderRadius:6,padding:'6px 11px',textAlign:'center',minWidth:64}}>
              <div style={{fontSize:11,fontFamily:'var(--font-mono)',color:'var(--text3)'}}>{sz}</div>
              <div style={{fontSize:11,fontFamily:'var(--font-display)',color:'var(--text3)',marginTop:2}}>No box</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
function Information({config,map,setMap,shipping}){
  const removeFile=p=>removeFromMap(setMap,p);
  const [selected,setSelected]=useState(null);
  const [detail,setDetail]=useState('files');
  const profiles=useMemo(()=>selected?(shipping?.products??[]).filter(p=>p.links?.includes(selected)):[],[shipping,selected]);
  const sheets=useMemo(()=>{
    if(!selected)return [];
    const own=(shipping?.tds??[]).filter(t=>t.labels?.includes(selected));
    return own.length?own:[...new Set(profiles.flatMap(p=>tdsOf(p,shipping)))];     // TerraFol: only Periterra's document, through the profile they share
  },[shipping,selected,profiles]);
  const [search,setSearch]=useState('');
  const [colors,setColors]=useState({});
  const [assets,setAssets]=useState({});
  const [fileType,setFileType]=useState('all');
  const [showWip,setShowWip]=useState('all');
  const [catFilter,setCatFilter]=useState('all');
  const [sizeRefOpen,setSizeRefOpen]=useState(false);
  const [iconLib,setIconLib]=useState(null);
  const [iconAssign,setIconAssign]=useState({});
  useEffect(()=>{
    api.getColors().then(r=>setColors(r.colors||{}));
    api.checkAssets().then(r=>{if(r&&!r.error)setAssets(r);});
    api.getIcons().then(r=>setIconLib(r));
    api.getIconAssignments().then(r=>setIconAssign(r.assignments||{}));
  },[]);
  const enabledProds=(config?.products??[]).filter(p=>p.enabled).sort((a,b)=>a.name.localeCompare(b.name));
  const filteredProds=enabledProds
    .filter(p=>catFilter==='all'||p.category===catFilter)
    .filter(p=>matchesSearch(p.name,search));
  const prodCfg=selected?(config?.products??[]).find(p=>p.name===selected):null;
  const dimKey=dimKeyFor(prodCfg);
  const swatches=selected?(colors[selected]||Array(6).fill('#808080')):[];
  const allFiles=map?.files??[];
  const prodFiles=allFiles.filter(f=>f.product===selected);
  const filteredFiles=prodFiles.filter(f=>{
    if(fileType==='indd')return f.extension==='.indd'&&!f.print_file;
    if(fileType==='idml')return f.extension==='.idml';
    if(fileType==='print')return f.print_file;
    return true;
  }).filter(f=>showWip==='wip'?f.wip:showWip==='done'?!f.wip:true);
  const prodAssets=selected?(assets[selected]||{}):{};
  const prodIcons=(selected&&iconLib)?(iconAssign[selected]||[]).map(id=>iconLib.icons.find(ic=>ic.id===id)).filter(Boolean):[];
  return(
    <div style={{display:'flex',height:'100%',gap:'var(--space-5)',overflow:'hidden'}}>
      {/* ── LEFT: product list sidebar ── */}
      <div style={{width:200,flexShrink:0,display:'flex',flexDirection:'column',gap:'var(--space-2)',minHeight:0}}>
        <div className="search-wrap">
          <span className="search-icon"><Icon.Search size={14}/></span>
          <input className="input" placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)}/>
        </div>
        <div style={{display:'flex',gap:'var(--space-1)',flexWrap:'wrap',marginBottom:'var(--space-1)'}}>
          {[['all','All'],['MO','MO'],['PAM','PAM'],['CE','CE']].map(([v,l])=>(
            <button key={v} onClick={()=>{setCatFilter(v);setSelected(null);}}
              style={{fontSize:10,fontFamily:'var(--font-mono)',padding:'2px 8px',borderRadius:10,border:'1px solid '+(catFilter===v?catStyle(v==='all'?'MO':v).color:'var(--border2)'),background:catFilter===v?catStyle(v==='all'?'MO':v).bg:'transparent',color:catFilter===v?catStyle(v==='all'?'MO':v).color:'var(--text3)',cursor:'pointer',transition:'all .15s'}}>
              {l}
            </button>
          ))}
        </div>
        <div className="scroll-y pick-list">
          {filteredProds.map(p=>(
            <button key={p.name} className={'pick-row'+(selected===p.name?' on':'')} onClick={()=>{setSelected(selected===p.name?null:p.name);setSizeRefOpen(false);}}>
              <span className="pick-row-name">{p.name}</span>
              <span style={{fontSize:9,fontFamily:'var(--font-mono)',padding:'1px 4px',borderRadius:2,background:catStyle(p.category).bg,color:catStyle(p.category).color,flexShrink:0}}>{p.category}</span>
            </button>
          ))}
          {filteredProds.length===0&&<div style={{fontSize:12,color:'var(--text3)',fontStyle:'italic',padding:'8px 4px'}}>No products match.</div>}
        </div>
      </div>

      {/* ── RIGHT: detail panel ── */}
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',minWidth:0}}>
        {!selected?(
          <div style={{flex:1,display:'flex',flexDirection:'column',gap:12,overflow:'hidden'}}>
            <div style={{color:'var(--text3)',fontSize:13,fontStyle:'italic',padding:'4px 0'}}>Select a product to view details.</div>
            {/* Collapsible size reference */}
            <button onClick={()=>setSizeRefOpen(o=>!o)}
              style={{display:'flex',alignItems:'center',gap:8,padding:'10px 14px',borderRadius:'var(--radius-sm)',border:'1px solid var(--border2)',background:'var(--surface2)',cursor:'pointer',transition:'all .15s',flexShrink:0,textAlign:'left'}}>
              <span style={{fontSize:12,fontWeight:500,color:'var(--text)',flex:1}}>Label & Box Size Reference</span>
              <span style={{fontSize:11,color:'var(--text3)',fontFamily:'var(--font-mono)',transition:'transform .2s',display:'inline-block',transform:sizeRefOpen?'rotate(180deg)':'none'}}>▾</span>
            </button>
            {sizeRefOpen&&(
              <div style={{flex:1,overflowY:'auto',paddingRight:4}}>
                <SizeTable config={config} dimKey={dimKey}/>
              </div>
            )}
          </div>
        ):(
          <div key={selected} style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',position:'relative'}}>
            {/* Large Z watermark, low opacity, behind the panel content */}
            <div style={{position:'absolute',top:-24,right:-30,width:420,opacity:.07,pointerEvents:'none',zIndex:-1}}>
              <BrandZigzag key={selected} colors={swatches} height={190} animated={true}/>
            </div>
            {/* Gradient header */}
            <div className="info-gradient-bar" style={{height:50,borderRadius:'var(--radius-sm)',marginBottom:'var(--space-2)',background:`linear-gradient(135deg, ${swatches.map(c=>c||'#808080').join(', ')})`,border:'1px solid var(--border2)',boxShadow:'0 4px 20px rgba(0,0,0,.4)',display:'flex',alignItems:'center',paddingLeft:10,gap:10,position:'relative',overflow:'hidden',flexShrink:0}}>
              <div title={prodAssets.logo?'Logo on file':'No logo found'} style={{height:32,minWidth:32,maxWidth:120,padding:'4px 8px',borderRadius:8,background:'rgba(255,255,255,.94)',display:'flex',alignItems:'center',justifyContent:'center',overflow:'hidden',flexShrink:0,boxShadow:'0 2px 8px rgba(0,0,0,.35)'}}>
                {prodAssets.logo?(
                  <img src={`/api/logo_thumb?product=${encodeURIComponent(selected)}`} alt="" style={{maxWidth:'100%',maxHeight:'100%',objectFit:'contain'}}/>
                ):(
                  <span style={{fontSize:12,fontWeight:700,color:'#999',fontFamily:'var(--font-display)'}}>{selected.slice(0,1)}</span>
                )}
              </div>
              <span style={{fontWeight:700,fontSize:14,color:'#fff',textShadow:'0 1px 6px rgba(0,0,0,.6)',fontFamily:'var(--font-display)',letterSpacing:'-.01em'}}>{selected}</span>
              {prodCfg&&<span style={{fontSize:10,fontFamily:'var(--font-mono)',color:'rgba(255,255,255,.85)',background:'rgba(0,0,0,.28)',padding:'2px 8px',borderRadius:8,backdropFilter:'blur(4px)',flexShrink:0}}>{prodCfg.category}{prodCfg.acidic?' · acidic':''}{prodCfg.unit?' · '+prodCfg.unit:''}</span>}
              <span style={{marginLeft:'auto',fontSize:11,fontFamily:'var(--font-mono)',color:'rgba(255,255,255,.5)',paddingRight:14,flexShrink:0}}>{prodFiles.length} file{prodFiles.length!==1?'s':''}</span>
            </div>
            {/* Swatch strip */}
            <div style={{display:'flex',gap:'var(--space-1)',marginBottom:'var(--space-3)',flexShrink:0}}>
              {swatches.map((c,i)=>(
                <div key={i} title={`Brand${i+1}: ${c||'#808080'}`} className="info-swatch" style={{flex:1,height:12,borderRadius:3,background:c||'#808080',border:'1px solid rgba(255,255,255,.08)',animationDelay:`${i*45}ms`,boxShadow:`0 2px 6px ${(c||'#808080')}55`}}/>
              ))}
            </div>
            {/* Asset dots + size reference — inline, no separate tabs */}
            <div style={{display:'flex',alignItems:'center',gap:'var(--space-2)',marginBottom:'var(--space-3)',flexShrink:0,flexWrap:'wrap'}}>
              {[['QR',prodAssets.qr,'qrcodes'],['Logo',prodAssets.logo,'logos']].map(([label,ok,dirKey])=>(
                <button key={label} title={`${label}: ${ok?'found':'missing'} — click to open folder`}
                  onClick={()=>api.getResourceDirs().then(d=>api.openFile(d[dirKey]))}
                  style={{display:'flex',alignItems:'center',gap:5,padding:'3px 8px',borderRadius:10,border:'1px solid var(--border2)',background:'var(--surface2)',cursor:'pointer',fontSize:10,fontFamily:'var(--font-mono)',color:'var(--text3)',flexShrink:0}}>
                  <span style={{width:7,height:7,borderRadius:'50%',background:ok?'var(--success)':'var(--danger)',boxShadow:`0 0 5px ${ok?'var(--success)':'var(--danger)'}`,flexShrink:0}}/>
                  {label}
                </button>
              ))}
              <div style={{width:1,alignSelf:'stretch',background:'var(--border2)',flexShrink:0}}/>
              <div style={{display:'flex',gap:5,flexWrap:'wrap',flex:1,alignItems:'center',minWidth:0}}>
                {Object.entries(config?.dimensions?.[dimKey]??{}).map(([sz,dims])=>(
                  <span key={sz} style={{fontSize:10,fontFamily:'var(--font-mono)',padding:'3px 7px',borderRadius:8,background:'var(--surface2)',border:'1px solid var(--border2)',color:'var(--text2)',whiteSpace:'nowrap',flexShrink:0}}>
                    {sz} <span style={{color:'var(--text3)'}}>· {dims}mm</span>
                  </span>
                ))}
              </div>
              <button onClick={()=>setSizeRefOpen(o=>!o)}
                style={{fontSize:10,fontFamily:'var(--font-mono)',color:'var(--accent)',background:'none',border:'none',cursor:'pointer',padding:'3px 4px',display:'flex',alignItems:'center',gap:3,flexShrink:0}}>
                All sizes
                <span style={{display:'inline-block',transition:'transform .2s',transform:sizeRefOpen?'rotate(180deg)':'none'}}>▾</span>
              </button>
            </div>
            {sizeRefOpen&&(
              <div style={{marginBottom:'var(--space-3)',padding:'var(--space-3)',borderRadius:'var(--radius-sm)',background:'var(--surface2)',border:'1px solid var(--border2)',maxHeight:280,overflowY:'auto',flexShrink:0}}>
                <SizeTable config={config} dimKey={dimKey}/>
              </div>
            )}
            {/* Traits — always visible, not tucked behind a tab */}
            <div style={{display:'flex',flexWrap:'wrap',gap:'var(--space-2)',marginBottom:'var(--space-4)',flexShrink:0}}>
              {prodIcons.length===0?(
                <span style={{fontSize:12,color:'var(--text3)',fontStyle:'italic'}}>No traits assigned to {selected}. Assign some in Settings &rarr; Icons.</span>
              ):prodIcons.map(ic=>(
                <div key={ic.id} title={ic.name_en} style={{display:'flex',alignItems:'center',gap:10,padding:'5px 14px 5px 5px',borderRadius:24,background:'var(--surface2)',border:'1px solid var(--border2)'}}>
                  <img src={`/icons/${ic.svg}`} alt="" style={{width:38,height:38,flexShrink:0}}/>
                  <span style={{fontSize:12,lineHeight:1.25,color:'var(--text2)',maxWidth:170}}>{ic.name_en}</span>
                </div>
              ))}
            </div>
            <div className="seg" role="group" aria-label="Show" style={{alignSelf:'flex-start',flexShrink:0,marginBottom:'var(--space-3)'}}>
              {[['files','Files',prodFiles.length],['shipping','Shipping',profiles.length+sheets.length]].map(([v,l,n])=>(
                <button key={v} type="button" aria-pressed={detail===v} className={'seg-btn'+(detail===v?' on':'')} onClick={()=>setDetail(v)}>
                  {l} <span className="mono muted" style={{fontSize:'var(--fs-xs)'}}>{n}</span>
                </button>
              ))}
            </div>
            {detail==='shipping'?(
              <div style={{flex:1,overflowY:'auto',minHeight:0}}>
                {profiles.length===0
                  ?<div className="muted" style={{fontSize:'var(--fs-md)',fontStyle:'italic',marginBottom:'var(--space-4)'}}>No shipping data for {selected} yet. Add it in Settings &rarr; Shipping.</div>
                  :profiles.map(p=><ShippingProfile key={p.id} product={p} shipping={shipping}/>)}
                {sheets.map(t=><TdsCard key={t.id} sheet={t}/>)}
              </div>
            ):(
            /* Files, and the product's mockup beside them */
            <div style={{display:'flex',gap:'var(--space-4)',flex:1,overflow:'hidden',minHeight:0}}>
            <div style={{display:'flex',flexDirection:'column',flex:1,overflow:'hidden',minWidth:0}}>
              <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:'var(--space-3)',flexShrink:0}}>
                {[['all','All'],['indd','INDD'],['idml','IDML'],['print','Print']].map(([v,l])=>(
                  <button key={v} className={'filter-chip '+(fileType===v?'active':'')} onClick={()=>setFileType(v)}>{l}</button>
                ))}
                <div style={{width:1,background:'var(--border2)',margin:'0 2px'}}/>
                <button className={'filter-chip '+(showWip==='wip'?'active-wip':'')} onClick={()=>setShowWip(showWip==='wip'?'all':'wip')}>WIP</button>
                <span style={{marginLeft:'auto',fontSize:11,fontFamily:'var(--font-mono)',color:'var(--text3)',alignSelf:'center'}}>{filteredFiles.length}/{prodFiles.length}</span>
              </div>
              {filteredFiles.length===0?(
                <div style={{color:'var(--text3)',fontSize:13,fontStyle:'italic',padding:'12px 0'}}>No files match.</div>
              ):(
                <div style={{flex:1,overflowY:'auto'}}>
                  <div className="card" style={{padding:0,overflow:'hidden'}}>
                    <table className="table">
                      <thead><tr><th>Filename</th><th>Langs</th><th>Size</th><th>Date</th><th>Type</th><th></th></tr></thead>
                      <tbody>
                        {filteredFiles.map(f=>(
                          <tr key={f.filename+f.path}>
                            <td className="path-cell" title={f.path}>{f.filename}</td>
                            <td style={{fontFamily:'var(--font-mono)',fontSize:11}}>{f.languages?.join('·')??'--'}</td>
                            <td style={{fontFamily:'var(--font-mono)',fontSize:12}}>{f.packaging??'--'}</td>
                            <td style={{fontFamily:'var(--font-mono)',fontSize:11,color:'var(--text3)',whiteSpace:'nowrap'}}>{f.date??'--'}</td>
                            <td><div style={{display:'flex',gap:4,alignItems:'center'}}>
                              <BadgeKind f={f}/>
                              {f.print_file?<BadgePrint/>:<BadgeFormat f={f} indd="INDD"/>}
                              {f.wip&&<BadgeWip/>}
                            </div></td>
                            <td><FileActions path={f.path} onDeleted={removeFile} sharepointBase={config?.sharepointBaseUrl}/></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
            <ProductMockup product={selected} mapRev={map?.generated}/>
            </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
// ── Browse: filters, sorting and the toolbar ─────────────────────────────────────
// Colour rules: the category colours (CAT_STYLE) and the file-tag colours (TONE) are the only
// colours in the toolbar -- the same ones the table rows use, so a filter looks like what it
// filters. Everything else is neutral, and the accent means "on".

// Pack-size groups (matched against the lower-cased packaging, e.g. "5kgx2").
const PACK_GROUPS={'1kg-1l':/^(1kg|1l)/,'5kg-5l':/^(5kg|5l)/,'250g':/^250g/,'500g':/^500g/};
const sizeMatches=(f,group)=>{
  const p=(f.packaging??'').toLowerCase();
  if(group==='other')return !p||!Object.values(PACK_GROUPS).some(re=>re.test(p));
  return !!p&&PACK_GROUPS[group].test(p);
};
const CATS=['PAM','MO','CE'];
const KIND_OPTIONS=[['label','Label'],['box','Box']];
const FORMAT_OPTIONS=[['indd','InDesign'],['idml','IDML'],['print','Print']];
const SIZE_OPTIONS=[['1kg-1l','1kg / 1L'],['5kg-5l','5kg / 5L'],['250g','250g'],['500g','500g'],['other','Other']];
const STATUS_OPTIONS=[['wip','Work in progress'],['unsorted','Unsorted']];
const STATUS_HINT={unsorted:'name not recognised'};
const STATUS_TONE={wip:'wip',unsorted:'neutral'};
const FACET_NAME={cat:'Category',kinds:'Type',formats:'Format',sizes:'Size',status:'Status',langs:'Language'};
const FACET_KEYS=['cat','kinds','formats','sizes','status','langs'];
const NO_FILTERS={cat:null,kinds:[],formats:[],sizes:[],status:[],langs:[],langMode:'all'};
const NO_FILES=[];
// Rows rendered at a time. Chrome re-records the whole table on every selection change, and
// that cost grows with row count: ~65 ms per click at 1000+ rows, ~15 ms at 200.
const BROWSE_PAGE=200;

// Does file f have option v of a facet?
const FACET_HAS={
  cat:    (f,v,ctx)=>(ctx.catOf[f.product]??'?')===v,
  kinds:  (f,v)=>v==='box'?f.deze:!f.deze,
  formats:(f,v)=>v==='print'?f.print_file:v==='idml'?f.extension==='.idml':f.extension==='.indd',
  sizes:  (f,v)=>sizeMatches(f,v),
  status: (f,v)=>v==='wip'?f.wip:!f.sorted,
  langs:  (f,v)=>(f.languages??[]).includes(v),
};
const selectedOf=(filters,key)=>key==='cat'?(filters.cat?[filters.cat]:[]):filters[key];
// Across facets a file must pass every one (AND); within one facet any selected option will do (OR).
// Language can instead require all selected languages (a label that carries both LT and LV).
const facetPasses=(f,key,filters,ctx)=>{
  const sel=selectedOf(filters,key);
  if(!sel.length)return true;
  const has=v=>!!FACET_HAS[key](f,v,ctx);
  return key==='langs'&&filters.langMode==='all'?sel.every(has):sel.some(has);
};
const filterFiles=(entries,filters,query,ctx,except)=>
  entries.filter(e=>matchesSearch(e.hay,query)&&FACET_KEYS.every(k=>k===except||facetPasses(e.f,k,filters,ctx)));
const searchText=(f,langName)=>`${f.filename} ${f.product||''} ${(f.languages??[]).map(c=>langName[c]||'').join(' ')}`;

// How many files each option would give. A facet is counted without its own selection (what the
// option gives on its own) -- except language "all" matching, counted with it (what adding the
// option would leave), so an option that would empty the list reads 0.
const facetCounts=(entries,filters,query,ctx,langCodes)=>{
  const values={cat:CATS,kinds:KIND_OPTIONS.map(o=>o[0]),formats:FORMAT_OPTIONS.map(o=>o[0]),sizes:SIZE_OPTIONS.map(o=>o[0]),status:STATUS_OPTIONS.map(o=>o[0]),langs:langCodes};
  const out={};
  for(const key of FACET_KEYS){
    const pool=filterFiles(entries,filters,query,ctx,key==='langs'&&filters.langMode==='all'?null:key);
    out[key]={};
    for(const v of values[key])out[key][v]=pool.reduce((n,e)=>n+(FACET_HAS[key](e.f,v,ctx)?1:0),0);
  }
  return out;
};

// The applied filters as removable pills, in toolbar order.
const appliedItems=filters=>{
  const label=(opts,v)=>opts.find(o=>o[0]===v)?.[1]??v;
  const items=[];
  if(filters.cat)items.push({key:'cat',value:filters.cat,k:'Category',label:filters.cat,tone:catStyle(filters.cat)});
  filters.kinds.forEach(v=>items.push({key:'kinds',value:v,k:'Type',label:label(KIND_OPTIONS,v),tone:TONE[v]}));
  filters.formats.forEach(v=>items.push({key:'formats',value:v,k:'Format',label:label(FORMAT_OPTIONS,v),tone:TONE[v]}));
  filters.sizes.forEach(v=>items.push({key:'sizes',value:v,k:'Size',label:label(SIZE_OPTIONS,v),tone:TONE.neutral}));
  filters.status.forEach(v=>items.push({key:'status',value:v,k:'Status',label:label(STATUS_OPTIONS,v),tone:TONE[STATUS_TONE[v]]}));
  filters.langs.forEach(v=>items.push({key:'langs',value:v,k:'Language',label:v,tone:TONE.neutral}));
  return items;
};
const withoutItem=(filters,{key,value})=>key==='cat'?{...filters,cat:null}:{...filters,[key]:filters[key].filter(v=>v!==value)};

// Sorting. Empty values always go last, and ties fall back to the path (which groups a
// product's files together).
const NAT=new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
const packAmount=p=>{
  const m=/^(\d+(?:[.,]\d+)?)(kg|g|l|ml)/i.exec(p||'');
  if(!m)return null;
  const n=parseFloat(m[1].replace(',','.')),u=m[2].toLowerCase();
  return u==='g'||u==='ml'?n/1000:n;
};
const SORT_KEY={
  filename:f=>f.filename,
  product:f=>f.product||null,
  cat:(f,catOf)=>catOf[f.product]||null,
  languages:f=>f.languages?.length?f.languages.join(' '):null,
  size:f=>packAmount(f.packaging),
  date:f=>f.date||null,
  type:f=>f.print_file?'3':f.deze?'2':'1',
};
const DEFAULT_SORT={key:'date',dir:'desc'};
const sortFiles=(files,{key,dir},catOf)=>{
  const get=SORT_KEY[key],sign=dir==='desc'?-1:1;
  return [...files].sort((a,b)=>{
    const ka=get(a,catOf),kb=get(b,catOf);
    if(ka==null&&kb==null)return NAT.compare(a.path,b.path);
    if(ka==null)return 1;
    if(kb==null)return -1;
    const r=typeof ka==='number'&&typeof kb==='number'?ka-kb:NAT.compare(String(ka),String(kb));
    return sign*r||NAT.compare(a.path,b.path);
  });
};
const COLUMNS=[['filename','Filename'],['product','Product'],['cat','Cat'],['languages','Languages'],['size','Size'],['date','Date'],['type','Type']];
const SortTh=({k,label,sort,onSort})=>{
  const on=sort.key===k;
  return(
    <th className={'sortable'+(on?' sorted':'')} tabIndex={0} aria-sort={on?(sort.dir==='asc'?'ascending':'descending'):'none'}
      onClick={()=>onSort(k)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSort(k);}}}>
      {label}<span className="sort-ind">{on&&sort.dir==='asc'?<Icon.SortUp/>:<Icon.SortDown/>}</span>
    </th>
  );
};

// ── Toolbar pieces ──
function SearchBox({value,onChange,inputRef}){
  return(
    <div className="fb-search">
      <span className="fb-search-ico"><Icon.Search size={15}/></span>
      <input ref={inputRef} className="input" type="text" value={value} placeholder="Search files, products, languages…" aria-label="Search files"
        onChange={e=>onChange(e.target.value)}
        onKeyDown={e=>{if(e.key==='Escape'){if(value)onChange('');else e.target.blur();}}}/>
      {value
        ?<button type="button" className="fb-search-clear" aria-label="Clear search" onClick={()=>{onChange('');inputRef.current?.focus();}}><Icon.Close size={12}/></button>
        :<kbd className="fb-kbd">/</kbd>}
    </div>
  );
}

// Category: one capsule with a segment per category. A category's colour shows as a dot until it
// is chosen, then fills its segment -- the same colours as the Cat badges in the table.
function CategorySegment({value,onChange,counts}){
  const seg=(v,label)=>{
    const on=(value??'all')===v,st=v==='all'?null:catStyle(v),n=st?counts?.[v]:null;
    return(
      <button key={v} type="button" aria-pressed={on} title={n==null?'All categories':`${n} file${n===1?'':'s'} in ${v}`}
        className={'seg-btn'+(on?' on':'')+(!on&&n===0?' dim':'')}
        style={on&&st?{background:st.color,color:'var(--on-accent)'}:undefined}
        onClick={()=>onChange(v==='all'||on?null:v)}>
        {st&&<span className="dot" style={{background:on?'var(--on-accent)':st.color}}/>}{label}
      </button>
    );
  };
  return <div className="seg" role="group" aria-label="Category">{seg('all','All')}{CATS.map(c=>seg(c,c))}</div>;
}

// A filter that opens a checklist: a capsule button with a caret, and a count badge once it is
// narrowing the list. Options carry how many files they would give; ones that would give none
// are disabled.
function FacetMenu({id,name,Ico,options,selected,onToggle,onClear,open,onOpen,searchable,footer}){
  const [q,setQ]=useState('');
  const [alignRight,setAlignRight]=useState(false);
  const rootRef=useRef(null),btnRef=useRef(null),popRef=useRef(null);
  useEffect(()=>{
    if(!open){setQ('');return;}
    const onDown=e=>{if(rootRef.current&&!rootRef.current.contains(e.target))onOpen(null);};
    const onKey=e=>{if(e.key==='Escape'){onOpen(null);btnRef.current?.focus();}};
    document.addEventListener('mousedown',onDown);document.addEventListener('keydown',onKey);
    return()=>{document.removeEventListener('mousedown',onDown);document.removeEventListener('keydown',onKey);};
  },[open,onOpen]);
  useLayoutEffect(()=>{            // keep a wide menu inside the window
    if(open&&popRef.current&&btnRef.current)setAlignRight(btnRef.current.getBoundingClientRect().left+popRef.current.offsetWidth>window.innerWidth-12);
  },[open]);
  const shown=searchable&&q.trim()?options.filter(o=>matchesSearch(o.search??o.label,q)):options;
  return(
    <div className="fb-facet" ref={rootRef}>
      <button type="button" ref={btnRef} className={'fb-btn'+(selected.length?' on':'')+(open?' open':'')} aria-haspopup="menu" aria-expanded={open}
        onClick={()=>onOpen(open?null:id)}>
        <Ico/><span>{name}</span>{selected.length>0&&<span className="fb-badge">{selected.length}</span>}
        <span className="fb-caret"><Icon.Chevron size={12}/></span>
      </button>
      {open&&(
        <div className={'fb-pop'+(alignRight?' right':'')} ref={popRef} role="menu" aria-label={name}>
          {searchable&&(
            <div className="fb-pop-search">
              <input className="input" autoFocus type="text" value={q} placeholder={`Find ${name.toLowerCase()}…`} aria-label={`Find ${name.toLowerCase()}`} onChange={e=>setQ(e.target.value)}/>
            </div>
          )}
          <div className="fb-list">
            {shown.map(o=>{
              const on=selected.includes(o.value);
              return(
                <button key={o.value} type="button" role="menuitemcheckbox" aria-checked={on} disabled={o.count===0&&!on}
                  className={'fb-opt'+(on?' on':'')} onClick={()=>onToggle(o.value)}>
                  <span className="fb-check">{on&&<Icon.Check/>}</span>
                  <span className="fb-opt-label">{o.node??o.label}</span>
                  <span className="fb-count">{o.count}</span>
                </button>
              );
            })}
            {shown.length===0&&<div className="fb-none">Nothing matches “{q.trim()}”</div>}
          </div>
          {(selected.length>0||footer)&&(
            <div className="fb-pop-foot">
              {footer??<span/>}
              {selected.length>0&&<button type="button" className="fb-link" onClick={onClear}>Clear</button>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// An applied filter: tinted like the thing it filters, removable.
const FilterPill=({item,onRemove})=>(
  <span className="fb-pill" style={{background:item.tone.bg,color:item.tone.color}}>
    <span className="fb-pill-k">{item.k}</span>{item.label}
    <button type="button" aria-label={`Remove ${item.k} ${item.label}`} onClick={onRemove}><Icon.Close size={10}/></button>
  </span>
);

// One row of the Browse table. Memoized: with ~1000 files, selecting a row or
// typing in the search box must only re-render the rows whose props changed.
const BrowseRow=memo(function BrowseRow({f,cat,selected,onSelect}){
  return(
    <tr className={selected?'row-selected':''} onClick={()=>onSelect(f)} style={{cursor:'pointer'}}>
      <td className="path-cell" title={f.path}>{f.filename}</td>
      <td style={{fontSize:13}}>{f.product??<span style={{color:'var(--text3)'}}>--</span>}</td>
      <td>{cat&&<span className="badge" style={{background:catStyle(cat).bg,color:catStyle(cat).color}}>{cat}</span>}</td>
      <td style={{fontFamily:'var(--font-mono)',fontSize:12}}>{f.languages?.join(' . ')??'--'}</td>
      <td style={{fontFamily:'var(--font-mono)',fontSize:12}}>{f.packaging??'--'}</td>
      <td style={{fontFamily:'var(--font-mono)',fontSize:11,color:'var(--text3)',whiteSpace:'nowrap'}}>{f.date??'--'}</td>
      <td><div style={{display:'flex',gap:4,alignItems:'center',flexWrap:'wrap'}}>
        {f.print_file?<BadgePrint/>:<BadgeKind f={f}/>}
        {!f.print_file&&<BadgeFormat f={f}/>}
        {f.wip&&<BadgeWip/>}
      </div></td>
    </tr>
  );
});

// The view's filters, search and sort live here so they survive a visit to another view
// (until the page is reloaded).
const browseMemory={};

function LabelsBrowser({map,setMap,config}){
  const [selected,setSelected]=useState(null);
  const removeFile=useCallback(p=>{
    removeFromMap(setMap,p);
    setSelected(s=>s?.path===p?null:s);
  },[setMap]);
  const [search,setSearch]=useState(browseMemory.search??'');
  const [filters,setFilters]=useState(browseMemory.filters??NO_FILTERS);
  const [sort,setSort]=useState(browseMemory.sort??DEFAULT_SORT);
  const [openFacet,setOpenFacet]=useState(null);
  useEffect(()=>{Object.assign(browseMemory,{search,filters,sort});},[search,filters,sort]);
  const searchRef=useRef(null);
  useEffect(()=>{                  // "/" jumps to the search box, as in most file/issue lists
    const onKey=e=>{
      const t=document.activeElement;
      if(e.key!=='/'||e.ctrlKey||e.metaKey||e.altKey||(t&&(/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)||t.isContentEditable)))return;
      e.preventDefault();searchRef.current?.focus();
    };
    document.addEventListener('keydown',onKey);
    return()=>document.removeEventListener('keydown',onKey);
  },[]);

  const files=map?.files??NO_FILES;
  const catOf=useMemo(()=>categoryMap(config),[config]);
  const ctx=useMemo(()=>({catOf}),[catOf]);
  const langName=useMemo(()=>Object.fromEntries((config?.languages??[]).map(l=>[l.code,l.name])),[config]);
  const entries=useMemo(()=>files.map(f=>({f,hay:searchText(f,langName)})),[files,langName]);
  const [langSort,setLangSort]=useLangSort();
  const langByCode=useMemo(()=>Object.fromEntries((config?.languages??[]).map(l=>[l.code,l])),[config]);
  // Every language that has files, in the chosen order. Always by use across all files,
  // not the counts shown beside them, which change with the other filters and would reshuffle the list.
  const langOptions=useMemo(()=>{
    const usage=langUsage(files);
    return sortLangs(Object.keys(usage).map(c=>langByCode[c]??{code:c,name:c}),langSort,usage).map(l=>l.code);
  },[files,langByCode,langSort]);
  const deferredSearch=useDeferredValue(search);   // keep typing responsive; the list catches up
  const sorted=useMemo(
    ()=>sortFiles(filterFiles(entries,filters,deferredSearch,ctx).map(e=>e.f),sort,catOf),
    [entries,filters,deferredSearch,ctx,sort,catOf]);
  const counts=useMemo(()=>facetCounts(entries,filters,deferredSearch,ctx,langOptions),[entries,filters,deferredSearch,ctx,langOptions]);
  const applied=useMemo(()=>appliedItems(filters),[filters]);

  const toggleIn=useCallback((key,value)=>setFilters(f=>({...f,[key]:f[key].includes(value)?f[key].filter(v=>v!==value):[...f[key],value]})),[]);
  const clearKey=useCallback(key=>setFilters(f=>({...f,[key]:[]})),[]);
  const clearAll=()=>setFilters(NO_FILTERS);
  const onSort=k=>setSort(s=>s.key===k?{key:k,dir:s.dir==='asc'?'desc':'asc'}:{key:k,dir:k==='date'?'desc':'asc'});

  // New search / filter / sort starts again from the first page; a file being added or
  // deleted does not, so the list doesn't jump back while you work down it.
  const filterKey=JSON.stringify([deferredSearch,filters,sort]);
  const [shown,setShown]=useState(BROWSE_PAGE);
  useEffect(()=>setShown(BROWSE_PAGE),[filterKey]);
  const visible=sorted.length>shown?sorted.slice(0,shown):sorted;
  const hidden=sorted.length-visible.length;

  const tag=(tone,text,hint)=><><Tag tone={tone}>{text}</Tag>{hint&&<span className="fb-hint">{hint}</span>}</>;
  const opt=(key,list,node)=>list.map(([value,label])=>({value,label,count:counts[key][value]??0,node:node(value,label)}));
  const kindOpts=opt('kinds',KIND_OPTIONS,(v,l)=>tag(v,l));
  const formatOpts=opt('formats',FORMAT_OPTIONS,(v,l)=>tag(v,l));
  const sizeOpts=opt('sizes',SIZE_OPTIONS,(v,l)=><span className="fb-mono">{l}</span>);
  const statusOpts=opt('status',STATUS_OPTIONS,(v,l)=>tag(STATUS_TONE[v],l,STATUS_HINT[v]));
  const langOpts=langOptions.map(code=>({value:code,label:langName[code]||code,search:langText(langByCode[code]??{code,name:''}),count:counts.langs[code]??0,
    node:<><span className="fb-code">{code}</span><span>{langName[code]||''}</span></>}));
  const menu=(id,Ico,opts,extra)=>(
    <FacetMenu id={id} name={FACET_NAME[id]} Ico={Ico} options={opts} selected={filters[id]} onToggle={v=>toggleIn(id,v)} onClear={()=>clearKey(id)}
      open={openFacet===id} onOpen={setOpenFacet} {...extra}/>
  );
  const langMode=(
    <div className="fb-pop-modes">
      <span className="fb-mode" role="group" aria-label="Match">
        Match
        {['all','any'].map(m=>(
          <button key={m} type="button" aria-pressed={filters.langMode===m} className={filters.langMode===m?'on':''} onClick={()=>setFilters(f=>({...f,langMode:m}))}>{m}</button>
        ))}
      </span>
      <span className="fb-mode" role="group" aria-label="Sort">
        Sort
        {LANG_SORTS.map(([v,l])=>(
          <button key={v} type="button" aria-pressed={langSort===v} className={langSort===v?'on':''} onClick={()=>setLangSort(v)}>{l}</button>
        ))}
      </span>
    </div>
  );

  const searching=deferredSearch.trim()!=='';
  // Empty result: what each applied filter (or the search) is costing, so a dead end is one click from a way out.
  const suggestions=useMemo(()=>{
    if(sorted.length>0)return [];
    const out=applied.map(it=>({label:`${it.k}: ${it.label}`,n:filterFiles(entries,withoutItem(filters,it),deferredSearch,ctx).length,remove:()=>setFilters(withoutItem(filters,it))}));
    if(searching)out.push({label:`search “${deferredSearch.trim()}”`,n:filterFiles(entries,filters,'',ctx).length,remove:()=>setSearch('')});
    return out.filter(s=>s.n>0).sort((a,b)=>b.n-a.n).slice(0,6);
  },[sorted.length,applied,entries,filters,deferredSearch,ctx,searching]);

  return(
    <div>
      <div className="fb">
        <div className="fb-row">
          <SearchBox value={search} onChange={setSearch} inputRef={searchRef}/>
          <CategorySegment value={filters.cat} counts={counts.cat} onChange={cat=>setFilters(f=>({...f,cat}))}/>
          {menu('kinds',Icon.Tag,kindOpts)}
          {menu('formats',Icon.File,formatOpts)}
          {menu('sizes',Icon.Ruler,sizeOpts)}
          {langOptions.length>0&&menu('langs',Icon.Globe,langOpts,{searchable:true,footer:langMode})}
          {menu('status',Icon.Flag,statusOpts)}
        </div>
        <div className="fb-row fb-summary">
          <span className="fb-total">{applied.length>0||searching?`Showing ${sorted.length} of ${files.length} files`:`${files.length} files`}</span>
          {applied.map(it=><FilterPill key={it.key+it.value} item={it} onRemove={()=>setFilters(withoutItem(filters,it))}/>)}
          {applied.length>0&&<button type="button" className="fb-link" onClick={clearAll}>Clear all</button>}
          <button type="button" className="btn btn-folder btn-sm fb-folder" onClick={async()=>{const p=await api.getLabelsDir();api.openFile(p);}}>
            <Icon.Folder/>Open labels folder
          </button>
        </div>
      </div>
      <div style={{display:'flex',gap:16,alignItems:'flex-start'}}>
        <div style={{flex:1,minWidth:0}}>
          {sorted.length===0?(
            <div className="empty-state">
              <div className="icon"><Icon.Search size={34}/></div>
              <p>No files match {searching?`“${deferredSearch.trim()}”`:''}{searching&&applied.length>0?' with ':''}{applied.length>0?'these filters':''}</p>
              {suggestions.length>0&&(
                <div className="fb-suggest">
                  <span>Try removing</span>
                  {suggestions.map(s=><button key={s.label} type="button" className="fb-sugg" onClick={s.remove}>{s.label}<b>{s.n} files</b></button>)}
                </div>
              )}
              {(applied.length>0||searching)&&<button type="button" className="btn btn-primary" onClick={()=>{clearAll();setSearch('');}}>Clear search and filters</button>}
            </div>
          ):(
            <div className="card" style={{padding:0,overflowX:'auto'}}>
              <table className="table browse">
                <thead><tr>{COLUMNS.map(([k,l])=><SortTh key={k} k={k} label={l} sort={sort} onSort={onSort}/>)}</tr></thead>
                <tbody>
                  {visible.map(f=>(
                    <BrowseRow key={f.path} f={f} cat={catOf[f.product]} selected={selected?.path===f.path} onSelect={setSelected}/>
                  ))}
                </tbody>
              </table>
              {hidden>0&&(
                <div style={{display:'flex',alignItems:'center',gap:12,padding:'12px 16px',borderTop:'1px solid var(--border)'}}>
                  <button className="btn" onClick={()=>setShown(n=>n+BROWSE_PAGE)}>Show {Math.min(BROWSE_PAGE,hidden)} more</button>
                  <span style={{fontSize:12,color:'var(--text3)',fontFamily:'var(--font-mono)'}}>{visible.length} of {sorted.length} shown -- search or filter to narrow the list</span>
                </div>
              )}
            </div>
          )}
        </div>
        <FilePreviewPanel file={selected} sharepointBase={config?.sharepointBaseUrl} onDeleted={removeFile}/>
      </div>
    </div>
  );
}
// -- Package mockup (the label on a photo of its pack) --------------------------------
const mockupUrl=(path,view,rev,download)=>`/api/mockup?path=${encodeURIComponent(path)}&view=${view}&v=${rev}`+(download?'&download=1':'');

function MockupView({file,info,view}){
  const src=mockupUrl(file.path,view,info.rev);
  const [loaded,setLoaded]=useState(null);           // the src that has finished loading
  const [failed,setFailed]=useState(null);
  const [exporting,setExporting]=useState(false);
  const [exportError,setExportError]=useState('');
  const exportPng=async()=>{
    setExporting(true); setExportError('');
    try{
      const r=await fetch(mockupUrl(file.path,view,info.rev,true));
      if(!r.ok)throw new Error();
      const cd=r.headers.get('Content-Disposition')||'';
      const m=/filename\*=UTF-8''([^;]+)/.exec(cd)||/filename="([^"]+)"/.exec(cd);
      const a=document.createElement('a');
      a.href=URL.createObjectURL(await r.blob());
      a.download=m?decodeURIComponent(m[1]):'mockup.png';
      a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href),10000);
    }catch{setExportError('Could not make the mockup file.');}
    setExporting(false);
  };
  return(
    <>
      <div className="mockup-frame">
        <img key={src} src={src} alt={`Mockup, ${view}`} onLoad={()=>setLoaded(src)} onError={()=>setFailed(src)}
             style={{opacity:loaded===src?1:0}}/>
        {loaded!==src&&failed!==src&&<div className="mockup-msg"><div className="spinner"/></div>}
        {failed===src&&<div className="mockup-msg">Could not make the mockup.</div>}
      </div>
      <div style={{display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
        <button type="button" className="btn btn-primary btn-sm" onClick={exportPng} disabled={exporting||failed===src}>
          {exporting?<div className="spinner" style={{width:12,height:12}}/>:<Icon.Download/>}
          {exporting?'Exporting…':'Export PNG'}
        </button>
        <span style={{fontSize:11,color:'var(--text3)'}}>2000 × 2000 px{info.views.length>1?`, ${view}`:''}</span>
      </div>
      {exportError&&<div style={{fontSize:12,color:'var(--danger)'}}>{exportError}</div>}
      {info.made_from&&<div style={{fontSize:11,color:'var(--text3)',lineHeight:1.4,wordBreak:'break-word'}}>Made from {info.made_from}</div>}
    </>
  );
}

// The product page's mockup: the product's newest label that has a mockup picture.
function ProductMockup({product,mapRev}){
  const [raw,setRaw]=useState(null);
  const info=raw&&raw._for===product?raw:null;
  const [view,setView]=useState('front');
  useEffect(()=>{
    setRaw(null);
    let cancelled=false;
    api.getProductMockup(product)
      .then(r=>{if(!cancelled)setRaw({...r,_for:product});})
      .catch(()=>{if(!cancelled)setRaw({available:false,reason:'Could not check for a mockup.',_for:product});});
    return()=>{cancelled=true;};
  },[product,mapRev]);
  const shown=info?.views?.includes(view)?view:'front';
  return(
    <div className="card product-mockup">
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,minHeight:36,flexShrink:0}}>
        <span style={{fontSize:12,fontWeight:600}}>Mockup</span>
        {info?.available&&info.views.length>1&&(
          <div className="seg" role="group" aria-label="Side">
            {info.views.map(v=>(
              <button key={v} type="button" aria-pressed={shown===v} className={'seg-btn'+(shown===v?' on':'')} onClick={()=>setView(v)}>
                {v==='front'?'Front':'Back'}
              </button>
            ))}
          </div>
        )}
      </div>
      {info===null?(
        <div className="mockup-frame"><div className="mockup-msg"><div className="spinner"/></div></div>
      ):!info.available?(
        <div style={{fontSize:12,color:'var(--text3)',lineHeight:1.45,padding:'4px 0'}}>{info.reason}</div>
      ):(
        <>
          <MockupView file={{path:info.path}} info={info} view={shown}/>
          <div style={{fontSize:11,color:'var(--text3)',lineHeight:1.4,wordBreak:'break-word'}} title={info.path}>
            Newest label{info.packaging?` (${info.packaging}`:''}{info.date?`, ${info.date}`:''}{info.packaging?')':''}: {info.filename}
          </div>
        </>
      )}
    </div>
  );
}

// Pages / Mockup and Front / Back, kept while you click through files (until the page is reloaded).
const previewMemory={mode:'pages',view:'front'};

function FilePreviewPanel({file,sharepointBase,onDeleted}){
  const [infoRaw,setInfo]=useState(null);
  const panelRef=useRef(null);
  const [maxH,setMaxH]=useState(null);
  // info is only valid for the file it was fetched for; without this check the
  // first render after switching files pairs the new file with the old file's info.
  const info=infoRaw&&infoRaw._for===file?.path?infoRaw:null;
  const [mockRaw,setMock]=useState(null);
  const mock=mockRaw&&mockRaw._for===file?.path?mockRaw:null;
  const [mode,setModeState]=useState(previewMemory.mode);
  const [view,setViewState]=useState(previewMemory.view);
  const setMode=m=>{previewMemory.mode=m; setModeState(m);};
  const setView=v=>{previewMemory.view=v; setViewState(v);};
  useEffect(()=>{
    setMock(null);
    if(!file||file.deze)return;                     // box labels have no mockup, and no switch for one
    let cancelled=false;
    api.getMockupInfo(file.path)
      .then(r=>{if(!cancelled)setMock({...r,_for:file.path});})
      .catch(()=>{if(!cancelled)setMock({available:false,reason:'Could not check for a mockup.',_for:file.path});});
    return()=>{cancelled=true;};
  },[file?.path]);
  useEffect(()=>{
    setInfo(null);
    if(!file)return;
    let cancelled=false;
    api.getFileInfo(file.path)
      .then(r=>{if(!cancelled)setInfo({...r,_for:file.path});})
      .catch(()=>{if(!cancelled)setInfo({page_count:0,_for:file.path});});
    return()=>{cancelled=true;};
  },[file?.path]);
  // Cap the panel at the space actually left below its current top edge, so
  // its bottom never runs off the window (it's sticky, so its top moves).
  useEffect(()=>{
    const update=()=>{
      const el=panelRef.current;
      if(el)setMaxH(Math.max(240,window.innerHeight-el.getBoundingClientRect().top-16));
    };
    update();
    window.addEventListener('resize',update);
    window.addEventListener('scroll',update,true);
    return()=>{window.removeEventListener('resize',update);window.removeEventListener('scroll',update,true);};
  },[file?.path]);
  const panelStyle={width:360,flexShrink:0,position:'sticky',top:16,padding:16,display:'flex',flexDirection:'column',gap:12,maxHeight:maxH??'calc(100vh - 140px)'};
  if(!file){
    return(
      <div className="card" style={{...panelStyle,alignItems:'center',justifyContent:'center',minHeight:200,color:'var(--text3)',fontSize:13}}>
        Select a file to preview
      </div>
    );
  }
  const isPdf=file.extension==='.pdf';
  const showMockup=mode==='mockup'&&!!mock?.available;
  const shownView=mock?.views?.includes(view)?view:'front';
  const pageCount=info?.page_count??0;
  const sizeKb=info?.size_bytes!=null?Math.round(info.size_bytes/1024):null;
  const sizeMm=info?.size_mm;
  const col=info?.color;
  // one labelled row per profile, like the other fields
  const colorRows=!col?[]:col.profiles
    ?[...col.profiles.map(p=>[`${p.space} profile`,p.name||'embedded profile']),...(col.output_intent?[['Output intent',col.output_intent]]:[])]
    :[col.cmyk&&['CMYK profile',col.cmyk],col.rgb&&['RGB profile',col.rgb]].filter(Boolean);
  return(
    <div className="card" ref={panelRef} style={panelStyle}>
      <div style={{fontSize:13,fontWeight:600,wordBreak:'break-word',lineHeight:1.3}}>{file.filename}</div>
      <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
        {file.print_file?<BadgePrint/>:<BadgeKind f={file}/>}
        {!file.print_file&&<BadgeFormat f={file}/>}
        {file.wip&&<BadgeWip/>}
      </div>
      <div style={{fontSize:12,color:'var(--text2)',display:'flex',flexDirection:'column',gap:3}}>
        {file.product&&<div><b>Product:</b> {file.product}</div>}
        {file.packaging&&<div><b>Pack size:</b> {file.packaging}</div>}
        {file.languages?.length>0&&<div><b>Languages:</b> {file.languages.join(', ')}</div>}
        {file.date&&<div><b>Date:</b> {file.date}</div>}
        {sizeKb!=null&&<div><b>File size:</b> {sizeKb} KB</div>}
        {isPdf&&<div><b>Pages:</b> {pageCount||'...'}</div>}
        {sizeMm&&<div><b>Dimensions:</b> {+sizeMm[0].toFixed(1)} × {+sizeMm[1].toFixed(1)} mm</div>}
        {colorRows.map(([k,v],i)=><div key={i}><b>{k}:</b> {v}</div>)}
        {info&&col?.profiles&&colorRows.length===0&&<div><b>Color:</b> <span style={{color:'var(--text3)'}}>no ICC profile embedded</span></div>}
      </div>
      <div className="file-preview-actions"><FileActions path={file.path} onDeleted={onDeleted} sharepointBase={sharepointBase}/></div>
      <div style={{flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:10,borderTop:'1px solid var(--border)',paddingTop:10,minHeight:0}}>
        {mock&&(
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,flexShrink:0}}>
            <div className="seg" role="group" aria-label="Preview">
              <button type="button" aria-pressed={!showMockup} className={'seg-btn'+(!showMockup?' on':'')} onClick={()=>setMode('pages')}>Pages</button>
              <button type="button" aria-pressed={showMockup} aria-disabled={!mock.available}
                      className={'seg-btn'+(showMockup?' on':'')+(mock.available?'':' dim')}
                      title={mock.available?`Shown on the ${mock.photo.replace(/_/g,' ')} picture`:mock.reason}
                      onClick={()=>mock.available&&setMode('mockup')}>Mockup</button>
            </div>
            {showMockup&&mock.views.length>1&&(
              <div className="seg" role="group" aria-label="Side">
                {mock.views.map(v=>(
                  <button key={v} type="button" aria-pressed={shownView===v} className={'seg-btn'+(shownView===v?' on':'')} onClick={()=>setView(v)}>
                    {v==='front'?'Front':'Back'}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {mock&&!mock.available&&mode==='mockup'&&(
          <div style={{fontSize:11,color:'var(--text3)',lineHeight:1.4,flexShrink:0}}>No mockup: {mock.reason}</div>
        )}
        {showMockup?(
          <MockupView file={file} info={mock} view={shownView}/>
        ):info===null?(
          <div style={{display:'flex',justifyContent:'center',padding:20}}><div className="spinner" style={{width:18,height:18}}/></div>
        ):pageCount===0?(
          <div style={{fontSize:12,color:'var(--text3)',textAlign:'center',padding:'24px 8px'}}>
            {isPdf?'Could not read any pages from this PDF':'No embedded InDesign preview found in this file'}
          </div>
        ):(
          <>
            {!isPdf&&<div style={{fontSize:11,color:'var(--text3)',lineHeight:1.4}}>InDesign preview, from the file's last InDesign save.</div>}
            {Array.from({length:pageCount},(_,i)=>(
              <div key={i} style={{flexShrink:0,border:'1px solid var(--border2)',borderRadius:'var(--radius-sm)',overflow:'hidden',background:'var(--surface2)'}}>
                <img src={`/api/file_thumb?path=${encodeURIComponent(file.path)}&page=${i}&v=${info.rev||0}`} alt={`Page ${i+1}`} style={{display:'block',width:'100%',height:'auto'}}/>
                {pageCount>1&&<div style={{fontSize:10,color:'var(--text3)',textAlign:'center',padding:'4px 0'}}>Page {i+1} / {pageCount}</div>}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
// ── Number input ─────────────────────────────────────────────────────────────────────
// Accepts a decimal comma as well as a point (people here type "0,25") and spaces between
// thousands. Blank is null; anything unreadable, or negative, is NaN.
const parseNum=s=>{
  const t=String(s??'').trim().replace(/\s/g,'').replace(',','.');
  if(!t)return null;
  const n=Number(t);
  return Number.isFinite(n)&&n>=0?n:NaN;
};
// Keeps what was typed ("0," on the way to "0,25") and reports only values it can read; text it
// can't read is marked and leaves the value as it was.
function NumInput({value,onChange,className='',...rest}){
  const [text,setText]=useState(value==null?'':String(value));
  const parsed=parseNum(text);
  useEffect(()=>{if(parsed!==(value??null)&&!Number.isNaN(parsed))setText(value==null?'':String(value));},[value]);
  return <input {...rest} className={`input mono ${className}${Number.isNaN(parsed)?' invalid':''}`} inputMode="decimal" value={text}
    onChange={e=>{const t=e.target.value;setText(t);const n=parseNum(t);if(!Number.isNaN(n))onChange(n);}}/>;
}

// ── Shipment: the data ───────────────────────────────────────────────────────────────
// A profile is a product with its packs, whatever the pack. Packs point at the catalogues of pallets,
// containers and boxes, which hold the weights. `links` names the label products a profile belongs to;
// a profile with none is a shipping-only product, which the rest of the app never sees. `tds` names the
// data sheets it follows. All of this lives in the shared folder, never in this public repo.
const byId=list=>Object.fromEntries((list??[]).map(x=>[x.id,x]));
const profileName=p=>p.variant?`${p.name} · ${p.variant}`:p.name;
const byProfileName=(a,b)=>profileName(a).localeCompare(profileName(b));
const SHIP_GROUPS=['MO','PAM','CE','NON'];
// One entry per pack, with what the calculator needs read through to the catalogues.
const shipEntries=shipping=>{
  const pallets=byId(shipping?.pallets),containers=byId(shipping?.containers),boxes=byId(shipping?.boxes);
  return (shipping?.products??[]).flatMap(p=>(p.packs??[]).map(k=>{
    const pallet=pallets[k.palletId],container=containers[k.containerId],box=boxes[k.boxId];
    return {id:k.id,product:p,pack:k,pallet,container,box,unit:p.unit,density:p.unit==='kg'?1:p.density,strapWeight:p.strapWeight,
      packSize:k.packSize,palletSize:k.palletSize,palletWeight:pallet?.weight??0,containerWeight:container?.weight??0,
      unitsPerBox:box?k.unitsPerBox:0,boxWeight:box?.weight??0};
  }));
};
// What one order line comes to.
const perUnit=(a,b)=>b>0?a/b:0;
const shipCalc=(it,qty)=>{
  const q=qty||0;
  const pallets=perUnit(q,it.palletSize),units=perUnit(q,it.packSize),boxes=perUnit(units,it.unitsPerBox);
  const palletKg=pallets*(it.palletWeight||0),productKg=q*(it.density||0),containerKg=units*(it.containerWeight||0),boxKg=boxes*(it.boxWeight||0),strapKg=pallets*(it.strapWeight||0);
  return {pallets,palletKg,productKg,units,containerKg,boxes,boxKg,strapKg,totalKg:palletKg+productKg+containerKg+boxKg+strapKg};
};
const fmtNum=(n,digits=2)=>n==null||Number.isNaN(n)?'–':n.toLocaleString(undefined,{maximumFractionDigits:digits});
const fmtPack=it=>`${fmtNum(it.packSize,3)} ${it.unit}`;
const fmtMonths=m=>m>0?`${fmtNum(m)} months`:'–';
const fmtStorage=p=>p.storageMin==null&&p.storageMax==null?'–':`${p.storageMin??'?'} to ${p.storageMax??'?'} °C`;
const adrOf=p=>p.adrClass||null;
const isWhole=n=>Math.abs(n-Math.round(n))<1e-6;
// Part of a box or pallet still takes a whole one.
const wholeUp=n=>Math.max(0,Math.ceil(n-1e-6));
// A count as it works out and as it is needed: "2,08 → 3". A whole number is only said once.
const ShipCount=({n,whole=wholeUp(n),title})=>{
  if(isWhole(n)&&Math.round(n)===whole)return <span className="ship-count"><b>{fmtNum(whole)}</b></span>;
  const exact=fmtNum(n,Math.abs(n-Math.round(n))<.005?4:2);
  return(
    <span className="ship-count" title={title??`Works out at ${exact}, so ${fmtNum(whole)} are needed`}>
      <span className="ship-exact">{exact}</span><span className="ship-arrow" aria-hidden="true"> → </span><b>{fmtNum(whole)}</b>
    </span>
  );
};
// The pallet, container or box a line's weight is worked out from.
const ShipUsed=({item,weight})=>item?<>{item.name} · {fmtNum(weight,4)} kg</>:'–';
const packsPerPallet=k=>k.palletSize>0&&k.packSize>0?k.palletSize/k.packSize:null;
// The value that turns up most often, blanks included: "most packs this size have no box" is an answer.
const mostCommon=list=>{
  const seen=new Map();
  let best=null,top=0;
  for(const v of list){
    const n=(seen.get(v)||0)+1;
    seen.set(v,n);
    if(n>top){top=n;best=v;}
  }
  return best;
};
const tdsOf=(p,shipping)=>{
  const all=byId(shipping?.tds);
  return (p.tds??[]).map(id=>all[id]).filter(Boolean);
};
const tdsSource=t=>[t.code,t.version&&`v${t.version}`,t.revised&&`revised ${t.revised}`].filter(Boolean).join(' · ')||'no version given';
const groupBadge=g=>{
  const c={PAM:'badge-pam',MO:'badge-mo',CE:'badge-ce'}[g]??'badge-neutral';
  return g?<span className={`badge ${c}`}>{g}</span>:null;
};
const AirBadge=({p})=>p.airTransport?<span className="badge badge-ok">Allowed</span>:<span className="badge badge-danger">Not allowed</span>;

// A pack's units per box, from the same cheat sheet the box labels are named by.
const packSizeKey=(size,unit)=>size>=1?`${size}${unit}`:`${Math.round(size*1000)}${unit==='L'?'ml':'g'}`;
const unitsPerBoxOnSheet=(config,size,unit)=>{
  const m=/x(\d+)$/.exec(config?.boxMultipliers?.[packSizeKey(size,unit)]??'');
  return m?Number(m[1]):null;
};
// A size labels come in, with no entry on the cheat sheet: 20 L, which has no box label.
const noBoxOnSheet=(config,size,unit)=>{
  const key=packSizeKey(size,unit);
  return Object.values(config?.packagingSizes??{}).some(list=>list.includes(key))&&!config?.boxMultipliers?.[key];
};

// What is on a pallet, in a container, in a box: a pack per row.
function ShipPackTable({product,shipping}){
  const entries=useMemo(()=>shipEntries({...shipping,products:[product]}).sort((a,b)=>a.packSize-b.packSize),[product,shipping]);
  return(
    <table className="table dense">
      <thead><tr><th>Pack</th><th className="num">Pallet holds</th><th>Pallet</th><th>Container</th><th>Box</th><th className="num">Per box</th><th className="num">Full pallet</th></tr></thead>
      <tbody>
        {entries.map(it=>(
          <tr key={it.id}>
            <td className="mono nowrap">{fmtPack(it)}</td>
            <td className="num nowrap">{fmtNum(it.palletSize)} {it.unit} <span className="mono muted">{fmtNum(packsPerPallet(it),2)} packs</span></td>
            <td className="nowrap">{it.pallet?.name??'–'} <span className="mono muted">{fmtNum(it.palletWeight)} kg</span></td>
            <td>{it.container?.name??'–'} <span className="mono muted">{fmtNum(it.containerWeight,4)} kg</span></td>
            <td>{it.box?<>{it.box.name} <span className="mono muted">{fmtNum(it.boxWeight,4)} kg</span></>:<span className="muted">No box</span>}</td>
            <td className="num">{it.box?fmtNum(it.unitsPerBox):'–'}</td>
            <td className="num" style={{fontWeight:600}}>{fmtNum(shipCalc(it,it.palletSize).totalKg)} kg</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Everything the shipping data says about one product. Also what the Information page shows.
function ShippingProfile({product:p,shipping}){
  const adr=adrOf(p);
  return(
    <div className="card ship-profile">
      <div className="flex items-center gap-2">
        <div className="card-title">{profileName(p)}</div>
        {groupBadge(p.group)}
      </div>
      <dl className="facts">
        <div><dt>Shelf life</dt><dd>{fmtMonths(p.shelfLifeMonths)}</dd></div>
        <div><dt>Customs code</dt><dd className="mono">{p.customsCode||'–'}</dd></div>
        <div><dt>Country of origin</dt><dd className="mono">{p.origin||'–'}</dd></div>
        <div><dt>Storage</dt><dd>{fmtStorage(p)}</dd></div>
        <div><dt>ADR class</dt><dd>{adr?<span className="badge badge-wip">{adr}</span>:'None'}</dd></div>
        {adr&&<div><dt>Packing group</dt><dd className="mono">{p.packingGroup||'–'}</dd></div>}
        <div><dt>Air transport</dt><dd><AirBadge p={p}/></dd></div>
        {p.unit==='L'&&<div><dt>Density</dt><dd className="mono">{p.density!=null?fmtNum(p.density,3):'–'}</dd></div>}
        {p.subgroup&&<div className="wide"><dt>Subgroup</dt><dd>{p.subgroup}</dd></div>}
        {p.note&&<div className="wide"><dt>Note</dt><dd>{p.note}</dd></div>}
      </dl>
      <div className="ship-profile-packs"><ShipPackTable product={p} shipping={shipping}/></div>
    </div>
  );
}

// What one TDS document says.
function TdsCard({sheet:t}){
  const facts=[['Type',t.type,true],['Application',t.application],['Form',t.form],['Colour',t.colour],['Odour',t.odour],['pH',t.ph],['Density',t.density&&`${t.density} g/cm³`],
    ['Concentration',t.concentration],['Shelf life',fmtMonths(t.shelfLifeMonths)],['Storage',fmtStorage(t)],['Packaging',t.packaging],['Hazard classification',t.hazard,true],['File',t.file,true]];
  return(
    <div className="card ship-profile">
      <div className="flex items-center gap-2" style={{flexWrap:'wrap'}}>
        <div className="card-title">{t.name}</div>
        <span className="eyebrow">Data sheet</span>
        <span className="mono muted" style={{fontSize:'var(--fs-xs)'}}>{tdsSource(t)}</span>
        {t.older&&<span className="badge badge-wip" title="No newer document was found for this product">Older document</span>}
        {t.organic&&<span className="badge badge-ok">Organic farming</span>}
      </div>
      <dl className="facts">
        {facts.filter(([,v])=>v&&v!=='–').map(([label,v,wide])=><div key={label} className={wide?'wide':undefined}><dt>{label}</dt><dd>{v}</dd></div>)}
      </dl>
    </div>
  );
}

// ── Shipment: the page ───────────────────────────────────────────────────────────────
// Order lines are kept in this browser, like an open worksheet: they survive a reload, and one
// person's order doesn't appear on anyone else's screen the way a shared file would.
const SHIPMENT_KEY='etiketas.shipment';
const readShipment=()=>{
  try{const v=JSON.parse(localStorage.getItem(SHIPMENT_KEY)||'[]');return Array.isArray(v)?v:[];}
  catch{return [];}
};
const shipmentMemory={tab:'calc'};   // which tab, kept until the page is reloaded

function Shipment({shipping}){
  const [tab,setTabState]=useState(shipmentMemory.tab);
  const setTab=t=>{shipmentMemory.tab=t;setTabState(t);};
  if(shipping?.error)return <div className="alert alert-error">{shipping.error}. Close whatever has it open, then reload this page.</div>;
  if(!shipping?.products?.length)return(
    <div className="empty-state" style={{padding:'var(--space-8) var(--space-5)'}}>
      <p>No shipping data yet</p>
      <div className="hint">It is read from shipping_profiles.json in the labels folder. If OneDrive is still syncing, wait a moment and reload; otherwise add products in Settings &rarr; Shipping.</div>
    </div>
  );
  return(
    <div>
      <div className="tabs">
        {[['calc','Calculator'],['products','Product data'],['sheets','Data sheets'],['reference','Pallets & packaging']].map(([t,l])=>(
          <button key={t} className={`tab ${tab===t?'active':''}`} onClick={()=>setTab(t)}>{l}</button>
        ))}
      </div>
      <div key={tab} className="view-anim">
        {tab==='calc'&&<ShipCalculator shipping={shipping}/>}
        {tab==='products'&&<ShipProducts shipping={shipping}/>}
        {tab==='sheets'&&<ShipDataSheets shipping={shipping}/>}
        {tab==='reference'&&<ShipReference shipping={shipping}/>}
      </div>
    </div>
  );
}

const StatCard=({label,value,unit,lead,sub})=>(
  <div className={'stat-card'+(lead?' lead':'')}>
    <div className="stat-label">{label}</div>
    <div className="stat-value">{value}{unit&&<span className="stat-unit">{unit}</span>}</div>
    {sub&&<div className="ship-stat-sub">{sub}</div>}
  </div>
);

// Pick a product, then one of its packs: everything for a product is in one place.
function ShipCalculator({shipping}){
  const [lines,setLines]=useState(readShipment);
  useEffect(()=>{try{localStorage.setItem(SHIPMENT_KEY,JSON.stringify(lines));}catch{/* storage unavailable: lines last until reload */}},[lines]);
  const entries=useMemo(()=>shipEntries(shipping),[shipping]);
  const entryOf=useMemo(()=>byId(entries),[entries]);
  const products=useMemo(()=>(shipping.products??[]).filter(p=>p.packs?.length).sort(byProfileName),[shipping]);
  const groupsOfProducts=useMemo(()=>{
    const known=SHIP_GROUPS.filter(g=>products.some(p=>p.group===g));
    const other=[...new Set(products.map(p=>p.group))].filter(g=>!SHIP_GROUPS.includes(g));
    return [...known,...other];
  },[products]);
  const [productId,setProductId]=useState('');
  const [packId,setPackId]=useState('');
  const [qty,setQty]=useState(null);
  const [price,setPrice]=useState(null);
  const product=products.find(p=>p.id===productId);
  const packs=useMemo(()=>entries.filter(e=>e.product.id===productId).sort((a,b)=>a.packSize-b.packSize),[entries,productId]);
  const picked=entryOf[packId];
  const pickProduct=id=>{
    setProductId(id);
    const own=entries.filter(e=>e.product.id===id);
    setPackId(own.length===1?own[0].id:'');
  };
  const canAdd=!!picked&&qty>0;
  const partPack=picked&&qty>0&&!isWhole(qty/picked.packSize);
  const addLine=()=>{
    if(!canAdd)return;
    setLines(ls=>ls.some(l=>l.itemId===packId)
      ?ls.map(l=>l.itemId===packId?{...l,qty:(l.qty||0)+qty,price:price??l.price}:l)    // same product and pack: one line, added up
      :[...ls,{itemId:packId,qty,price}]);
    setQty(null);setPrice(null);
  };
  const updateLine=(id,change)=>setLines(ls=>ls.map(l=>l.itemId===id?{...l,...change}:l));
  const removeLine=id=>setLines(ls=>ls.filter(l=>l.itemId!==id));
  const clearLines=()=>{if(window.confirm('Remove every line from this shipment?'))setLines([]);};

  const rows=lines.map(l=>{
    const it=entryOf[l.itemId];
    return {l,it,c:it?shipCalc(it,l.qty):null,cost:it&&l.price!=null?(l.qty||0)*l.price:null};
  });
  const known=rows.filter(r=>r.it);
  const gone=rows.filter(r=>!r.it);
  // The lines of one product stay together, whatever order they were added in.
  const lineGroups=[];
  for(const r of [...known].sort((a,b)=>byProfileName(a.it.product,b.it.product)||a.it.packSize-b.it.packSize)){
    const last=lineGroups[lineGroups.length-1];
    if(last?.product===r.it.product)last.rows.push(r);
    else lineGroups.push({product:r.it.product,rows:[r]});
  }
  const sum=key=>known.reduce((n,r)=>n+r.c[key],0);
  // Each line rounded up, then added: boxes hold one product, so parts of them can't be put together.
  const wholeSum=key=>known.reduce((n,r)=>n+wholeUp(r.c[key]),0);
  const exactNote=key=>isWhole(sum(key))&&Math.round(sum(key))===wholeSum(key)?null:`${fmtNum(sum(key))} exact`;
  // Pallets can be shared, though, which is the one count that can come out lower.
  const sharedPallets=wholeUp(sum('pallets'));
  const palletNote=[exactNote('pallets'),sharedPallets<wholeSum('pallets')?`${fmtNum(sharedPallets)} if part pallets share`:null].filter(Boolean).join(' · ');
  const totalCost=known.reduce((n,r)=>n+(r.cost??0),0);
  const anyPrice=known.some(r=>r.cost!=null);
  const shipped=lineGroups.map(g=>g.product);
  const adrClasses=[...new Set(shipped.map(adrOf).filter(Boolean))].sort();
  const noAir=shipped.filter(p=>!p.airTransport);
  return(
    <>
      <div className="card ship-add">
        <div className="field ship-add-product">
          <label htmlFor="ship-product">Product</label>
          <select id="ship-product" className="input" value={productId} onChange={e=>pickProduct(e.target.value)}>
            <option value="">Choose a product…</option>
            {groupsOfProducts.map(g=>(
              <optgroup key={g} label={g||'No group'}>
                {products.filter(p=>p.group===g).map(p=><option key={p.id} value={p.id}>{profileName(p)}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="field">
          <span className="field-label">Pack</span>
          {product?(
            <div className="seg ship-packs" role="group" aria-label="Pack">
              {packs.map(e=><button key={e.id} type="button" aria-pressed={packId===e.id} className={'seg-btn'+(packId===e.id?' on':'')} onClick={()=>setPackId(e.id)}>{fmtPack(e)}</button>)}
            </div>
          ):<div className="hint ship-packs-empty">Choose a product first</div>}
        </div>
        <div className="field ship-add-num">
          <label htmlFor="ship-qty">Order{product?` (${product.unit})`:''}</label>
          <NumInput id="ship-qty" value={qty} onChange={setQty} placeholder="0" onKeyDown={e=>{if(e.key==='Enter')addLine();}}/>
        </div>
        <div className="field ship-add-num">
          <label htmlFor="ship-new-price">Price per {product?.unit??'L or kg'}</label>
          <NumInput id="ship-new-price" value={price} onChange={setPrice} placeholder="–" onKeyDown={e=>{if(e.key==='Enter')addLine();}}/>
        </div>
        <button className="btn btn-primary" disabled={!canAdd} onClick={addLine}>Add line</button>
        {picked&&(
          <div className="hint ship-add-hint">
            A pallet holds {fmtNum(picked.palletSize)} {picked.unit} ({fmtNum(packsPerPallet(picked),2)} packs) ·{' '}
            {picked.unit==='L'?`density ${fmtNum(picked.density,3)} · `:''}
            {picked.box?`${fmtNum(picked.unitsPerBox)} per box`:'no boxes'}
            {partPack&&<span className="ship-warn"> · {fmtNum(qty)} {picked.unit} is {fmtNum(qty/picked.packSize,2)} packs of {fmtPack(picked)}, not a whole number</span>}
            <div>Weighed with: {[picked.pallet?.name,picked.container?.name,picked.box?.name??'no box'].filter(Boolean).join(' · ')}</div>
          </div>
        )}
      </div>

      <div className="ship-stats">
        <StatCard label="Total weight" value={fmtNum(sum('totalKg'))} unit="kg" lead/>
        <StatCard label="Pallets" value={fmtNum(wholeSum('pallets'))} sub={palletNote}/>
        <StatCard label="Product weight" value={fmtNum(sum('productKg'))} unit="kg"/>
        <StatCard label="Containers" value={fmtNum(wholeSum('units'))} sub={exactNote('units')}/>
        <StatCard label="Boxes" value={fmtNum(wholeSum('boxes'))} sub={exactNote('boxes')}/>
        <StatCard label="Total price" value={anyPrice?fmtNum(totalCost):'–'}/>
      </div>

      <div className="flex items-center justify-between" style={{marginBottom:'var(--space-3)'}}>
        <p className="section-title" style={{margin:0}}>Order lines</p>
        {lines.length>0&&<button className="btn btn-ghost btn-sm" onClick={clearLines}>Clear all</button>}
      </div>
      <div className="card table-scroll ship-section">
        {lines.length===0?(
          <div className="empty-state" style={{padding:'var(--space-8) var(--space-5)'}}>
            <p>No lines yet</p>
            <div className="hint">Choose a product, a pack and an amount above.</div>
          </div>
        ):(
          <table className="table dense">
            <thead>
              <tr>
                <th rowSpan={2} className="nowrap">Pack</th>
                <th rowSpan={2} className="num">Order</th>
                <th colSpan={2} className="th-group">Pallets</th>
                <th colSpan={2} className="th-group">Product</th>
                <th colSpan={2} className="th-group">Containers</th>
                <th colSpan={2} className="th-group">Boxes</th>
                <th rowSpan={2} className="num group-start">Strap kg</th>
                <th rowSpan={2} className="num">Total kg</th>
                <th rowSpan={2} className="num">Price</th>
                <th rowSpan={2} className="num">Cost</th>
                <th rowSpan={2} aria-label="Remove"/>
              </tr>
              <tr>
                <th className="num group-start">Qty</th><th className="num">kg</th>
                <th className="num group-start">Density</th><th className="num">kg</th>
                <th className="num group-start">Qty</th><th className="num">kg</th>
                <th className="num group-start">Qty</th><th className="num">kg</th>
              </tr>
            </thead>
            {lineGroups.map(({product:p,rows:group})=>(
              <tbody key={p.id}>
                <tr className="ship-group-row">
                  <td colSpan={11}><span className="ship-group-name">{profileName(p)}</span> {groupBadge(p.group)}</td>
                  <td className="num">{group.length>1?fmtNum(group.reduce((n,r)=>n+r.c.totalKg,0)):''}</td>
                  <td colSpan={3}/>
                </tr>
                {group.map(({l,it,c,cost})=>(
                  <Fragment key={l.itemId}>
                    <tr className="ship-line">
                      <td rowSpan={2} className="mono nowrap">{fmtPack(it)}</td>
                      <td rowSpan={2} className="num"><div className="input-unit ship-qty"><NumInput aria-label={`Order for ${profileName(p)} ${fmtPack(it)}`} value={l.qty} onChange={v=>updateLine(l.itemId,{qty:v})}/><span>{it.unit}</span></div></td>
                      <td className="num group-start"><ShipCount n={c.pallets}/></td><td className="num">{fmtNum(c.palletKg)}</td>
                      <td rowSpan={2} className="num group-start">{fmtNum(it.density,3)}</td><td rowSpan={2} className="num">{fmtNum(c.productKg)}</td>
                      <td className={'num group-start'+(isWhole(c.units)?'':' ship-warn')} title={isWhole(c.units)?undefined:`This order isn't a whole number of ${fmtPack(it)} packs`}><ShipCount n={c.units}/></td><td className="num">{fmtNum(c.containerKg)}</td>
                      <td className="num group-start"><ShipCount n={c.boxes}/></td><td className="num">{fmtNum(c.boxKg)}</td>
                      <td rowSpan={2} className="num group-start">{fmtNum(c.strapKg)}</td>
                      <td rowSpan={2} className="num" style={{fontWeight:600,color:'var(--text)'}}>{fmtNum(c.totalKg)}</td>
                      <td rowSpan={2} className="num"><NumInput className="ship-price" aria-label={`Price for ${profileName(p)} ${fmtPack(it)}`} value={l.price} placeholder="–" onChange={v=>updateLine(l.itemId,{price:v})}/></td>
                      <td rowSpan={2} className="num">{cost==null?'–':fmtNum(cost)}</td>
                      <td rowSpan={2}><button className="ship-remove" aria-label={`Remove ${profileName(p)} ${fmtPack(it)}`} onClick={()=>removeLine(l.itemId)}><Icon.Close size={12}/></button></td>
                    </tr>
                    <tr className="ship-line-used">
                      <td colSpan={2} className="group-start"><ShipUsed item={it.pallet} weight={it.palletWeight}/></td>
                      <td colSpan={2} className="group-start"><ShipUsed item={it.container} weight={it.containerWeight}/></td>
                      <td colSpan={2} className="group-start">{it.box?<ShipUsed item={it.box} weight={it.boxWeight}/>:'No box'}</td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            ))}
            {gone.length>0&&(
              <tbody>
                {gone.map(({l})=>(
                  <tr key={l.itemId}>
                    <td colSpan={14} className="muted">This line's product or pack is no longer in the shipping data.</td>
                    <td><button className="ship-remove" aria-label="Remove line" onClick={()=>removeLine(l.itemId)}><Icon.Close size={12}/></button></td>
                  </tr>
                ))}
              </tbody>
            )}
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="num">{fmtNum(known.reduce((n,r)=>n+(r.l.qty||0),0))}</td>
                <td className="num group-start"><ShipCount n={sum('pallets')} whole={wholeSum('pallets')} title={`Each line rounded up, then added. ${fmtNum(sharedPallets)} if part pallets share.`}/></td><td className="num">{fmtNum(sum('palletKg'))}</td>
                <td className="num group-start"/><td className="num">{fmtNum(sum('productKg'))}</td>
                <td className="num group-start"><ShipCount n={sum('units')} whole={wholeSum('units')} title="Each line rounded up, then added"/></td><td className="num">{fmtNum(sum('containerKg'))}</td>
                <td className="num group-start"><ShipCount n={sum('boxes')} whole={wholeSum('boxes')} title="Each line rounded up, then added"/></td><td className="num">{fmtNum(sum('boxKg'))}</td>
                <td className="num group-start">{fmtNum(sum('strapKg'))}</td>
                <td className="num">{fmtNum(sum('totalKg'))}</td>
                <td/>
                <td className="num">{anyPrice?fmtNum(totalCost):'–'}</td>
                <td/>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {shipped.length>0&&(
        <>
          <p className="section-title">Shipping details</p>
          {(adrClasses.length>0||noAir.length>0)&&(
            <div className="ship-alerts">
              {adrClasses.length>0&&<div className="alert alert-warning">ADR goods in this shipment: class {adrClasses.join(', ')}.</div>}
              {noAir.length>0&&<div className="alert alert-warning">Cannot go by air: {noAir.map(profileName).join(', ')}.</div>}
            </div>
          )}
          <div className="card table-scroll ship-section">
            <table className="table dense">
              <thead><tr><th>Product</th><th>Customs code</th><th>Origin</th><th>ADR class</th><th>Packing group</th><th>Air</th><th>Storage</th><th>Shelf life</th></tr></thead>
              <tbody>
                {shipped.map(p=>(
                  <tr key={p.id}>
                    <td className="ship-name">{profileName(p)}</td>
                    <td className="mono nowrap">{p.customsCode||'–'}</td>
                    <td className="mono">{p.origin||'–'}</td>
                    <td>{adrOf(p)?<span className="badge badge-wip">{adrOf(p)}</span>:<span className="muted">None</span>}</td>
                    <td className="mono">{p.packingGroup||'–'}</td>
                    <td><AirBadge p={p}/></td>
                    <td className="nowrap">{fmtStorage(p)}</td>
                    <td className="nowrap">{fmtMonths(p.shelfLifeMonths)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

// Every product with its details; clicking one shows its packs.
function ShipProducts({shipping}){
  const [search,setSearch]=useState('');
  const [group,setGroup]=useState('all');
  const [open,setOpen]=useState(null);
  const [sort,setSortState]=useState(shipmentMemory.productSort??'az');
  const setSort=s=>{shipmentMemory.productSort=s;setSortState(s);};
  const all=shipping.products??[];
  const groups=useMemo(()=>[...new Set(all.map(p=>p.group).filter(Boolean))],[all]);
  // New products go on the end of the list, so its own order is the order they were entered in.
  const shown=useMemo(()=>{
    const list=all
      .filter(p=>group==='all'||p.group===group)
      .filter(p=>matchesSearch(`${p.name} ${p.variant} ${p.customsCode} ${p.subgroup} ${(p.links??[]).join(' ')}`,search));
    return sort==='az'?list.sort(byProfileName):sort==='newest'?list.reverse():list;
  },[all,group,search,sort]);
  return(
    <>
      <div className="fb">
        <div className="fb-row">
          <div className="fb-search">
            <span className="fb-search-ico"><Icon.Search size={15}/></span>
            <input className="input" type="text" value={search} placeholder="Search products, customs codes…" aria-label="Search product data" onChange={e=>setSearch(e.target.value)}/>
          </div>
          <div className="seg" role="group" aria-label="Group">
            {['all',...groups].map(g=>(
              <button key={g} type="button" aria-pressed={group===g} className={'seg-btn'+(group===g?' on':'')} onClick={()=>setGroup(g)}>{g==='all'?'All':g}</button>
            ))}
          </div>
          <div className="seg" role="group" aria-label="Sort">
            {[['az','A–Z'],['newest','Newest'],['oldest','Oldest']].map(([k,l])=>(
              <button key={k} type="button" aria-pressed={sort===k} className={'seg-btn'+(sort===k?' on':'')} onClick={()=>setSort(k)}>{l}</button>
            ))}
          </div>
          <span className="fb-total">{shown.length} of {all.length} products · edit in Settings → Shipping</span>
        </div>
      </div>
      <div className="card table-scroll ship-table-fit">
        <table className="table dense sticky-first">
          <thead>
            <tr>
              <th>Product</th><th>Packs</th><th>Group</th><th>Subgroup</th><th>Customs code</th><th>Origin</th>
              <th>Shelf life</th><th>Storage</th><th>ADR</th><th>Packing group</th><th>Air</th>
              <th className="num">Density</th><th>Note</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(p=>(
              <Fragment key={p.id}>
                <tr className={open===p.id?'row-selected':''} style={{cursor:'pointer'}} onClick={()=>setOpen(o=>o===p.id?null:p.id)}>
                  <td className="ship-name">{p.name}{p.variant&&<div className="hint">{p.variant}</div>}</td>
                  <td className="mono nowrap">{[...(p.packs??[])].sort((a,b)=>a.packSize-b.packSize).map(k=>fmtNum(k.packSize,3)).join(' · ')} {p.unit}</td>
                  <td>{groupBadge(p.group)}</td>
                  <td><div className="ship-clip" title={p.subgroup}>{p.subgroup||'–'}</div></td>
                  <td className="mono nowrap">{p.customsCode||'–'}</td>
                  <td className="mono">{p.origin||'–'}</td>
                  <td className="nowrap">{fmtMonths(p.shelfLifeMonths)}{(p.tds??[]).length===0&&<span className="muted" title="No data sheet is linked, so this hasn't been checked against a document"> *</span>}</td>
                  <td className="nowrap">{fmtStorage(p)}</td>
                  <td className="mono">{p.adrClass||'None'}</td>
                  <td className="mono">{p.packingGroup||'–'}</td>
                  <td><AirBadge p={p}/></td>
                  <td className="num">{p.unit==='L'?fmtNum(p.density,3):'–'}</td>
                  <td><div className="ship-clip" title={p.note}>{p.note||''}</div></td>
                </tr>
                {open===p.id&&<tr className="ship-open-row"><td colSpan={13}><div className="ship-open"><ShipPackTable product={p} shipping={shipping}/>{tdsOf(p,shipping).map(t=><div key={t.id} className="ship-open-sheet"><TdsCard sheet={t}/></div>)}</div></td></tr>}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// Every TDS document on file; clicking one shows what it says.
function ShipDataSheets({shipping}){
  const [search,setSearch]=useState('');
  const [open,setOpen]=useState(null);
  const all=shipping.tds??[];
  const shown=useMemo(()=>all.filter(t=>matchesSearch(`${t.name} ${t.code} ${t.type} ${t.file}`,search)).sort((a,b)=>a.name.localeCompare(b.name)),[all,search]);
  return(
    <>
      <div className="fb">
        <div className="fb-row">
          <div className="fb-search">
            <span className="fb-search-ico"><Icon.Search size={15}/></span>
            <input className="input" type="text" value={search} placeholder="Search data sheets…" aria-label="Search data sheets" onChange={e=>setSearch(e.target.value)}/>
          </div>
          <span className="fb-total">{shown.length} of {all.length}{shipping.tdsReadOn?` · read from the TDS documents on ${shipping.tdsReadOn}`:''} · edit in Settings → Shipping</span>
        </div>
      </div>
      <div className="card table-scroll ship-table-fit">
        <table className="table dense sticky-first">
          <thead><tr><th>Product</th><th>Code</th><th>Version</th><th>Revised</th><th>Shelf life</th><th>Storage</th><th>Form</th><th>pH</th><th>Density</th><th>Packaging</th><th>Hazard classification</th></tr></thead>
          <tbody>
            {shown.map(t=>(
              <Fragment key={t.id}>
                <tr className={open===t.id?'row-selected':''} style={{cursor:'pointer'}} onClick={()=>setOpen(o=>o===t.id?null:t.id)}>
                  <td className="ship-name">{t.name}{t.older&&<div className="hint">Older document</div>}</td>
                  <td className="mono">{t.code||'–'}</td>
                  <td className="mono">{t.version||'–'}</td>
                  <td className="mono nowrap">{t.revised||'–'}</td>
                  <td className="nowrap">{fmtMonths(t.shelfLifeMonths)}</td>
                  <td className="nowrap">{fmtStorage(t)}</td>
                  <td>{t.form||'–'}</td>
                  <td className="mono nowrap">{t.ph||'–'}</td>
                  <td className="mono nowrap">{t.density||'–'}</td>
                  <td className="nowrap">{t.packaging||'–'}</td>
                  <td><div className="ship-clip" title={t.hazard}>{t.hazard||'–'}</div></td>
                </tr>
                {open===t.id&&<tr className="ship-open-row"><td colSpan={11}><div className="ship-open"><TdsCard sheet={t}/></div></td></tr>}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// The catalogues the packs pick from, then the workbook's other reference tables.
const SHIP_CATALOGUES=[
  {key:'pallets',title:'Pallets',usedBy:'palletId',hint:'Only a pallet with a weight can be picked for a pack.',columns:[
    {key:'name',label:'Pallet',type:'text'},{key:'weight',label:'Weight (kg)',type:'number'},{key:'height',label:'Height (cm)',type:'number'},{key:'width',label:'Width (cm)',type:'number'},{key:'length',label:'Length (cm)',type:'number'}]},
  {key:'containers',title:'Containers and bags',usedBy:'containerId',columns:[
    {key:'name',label:'Container or bag',type:'text'},{key:'kind',label:'Kind',type:'kind'},{key:'forSize',label:'For pack size',type:'number'},{key:'weight',label:'Weight (kg)',type:'number'}]},
  {key:'boxes',title:'Boxes',usedBy:'boxId',columns:[
    {key:'name',label:'Box',type:'text'},{key:'weight',label:'Weight (kg)',type:'number'}]},
];
const refCell=(col,v)=>v==null||v===''?<span className="muted">–</span>:col.type==='number'?fmtNum(v,4):col.type==='kind'?(v==='bag'?'Bag':'Container'):v;
const RefTable=({title,hint,columns,rows})=>(
  <div className="card ship-ref-card">
    <div className="ship-ref-head">
      <div className="card-title">{title}</div>
      {hint&&<div className="hint">{hint}</div>}
    </div>
    <table className="table dense">
      <thead><tr>{columns.map(c=><th key={c.key} className={c.type==='number'?'num':''}>{c.label}</th>)}</tr></thead>
      <tbody>
        {rows.map((r,i)=>(
          <tr key={r.id??i}>{columns.map(c=><td key={c.key} className={c.type==='number'?'num':''}>{refCell(c,r[c.key])}</td>)}</tr>
        ))}
      </tbody>
    </table>
  </div>
);
const ShipReference=({shipping})=>(
  <div className="ship-ref-grid">
    {SHIP_CATALOGUES.map(c=><RefTable key={c.key} title={c.title} hint={c.hint} columns={c.columns} rows={shipping[c.key]??[]}/>)}
    {(shipping.tables??[]).map(t=><RefTable key={t.id} title={t.title} hint={t.note} columns={t.columns} rows={t.rows}/>)}
  </div>
);

// ── Settings ─────────────────────────────────────────────────────────────────────────
const SettingCard=({title,desc,children,danger})=>(
  <div className="card-flat" style={danger?{borderColor:'rgba(var(--danger-rgb),.2)'}:undefined}>
    <div className="card-title" style={{color:danger?'var(--danger)':undefined,marginBottom:'var(--space-1)'}}>{title}</div>
    {desc&&<div className="hint" style={{marginBottom:'var(--space-3)'}}>{desc}</div>}
    {children}
  </div>
);

// Debounced autosave for the Colors/Icons editors: save(value) runs `delay` ms
// after the last change, and `saved` flashes for two seconds afterwards.
function useAutosave(save,delay){
  const timer=useRef(null);
  const [saved,setSaved]=useState(false);
  const schedule=useCallback(value=>{
    clearTimeout(timer.current);
    timer.current=setTimeout(()=>{save(value);setSaved(true);setTimeout(()=>setSaved(false),2000);},delay);
  },[save,delay]);
  return [saved,schedule];
}

const CategoryHeading=({cat})=>(
  <div className="mono" style={{fontSize:'var(--fs-xs)',fontWeight:500,color:catStyle(cat).color,textTransform:'uppercase',letterSpacing:'var(--tracking-label)',marginBottom:'var(--space-2)'}}>{cat}</div>
);
const productsByCategory=cfg=>['MO','PAM','CE'].map(cat=>[cat,(cfg?.products??[]).filter(p=>p.category===cat).sort((a,b)=>a.name.localeCompare(b.name))]);
const SavedNote=({show,children='✓ Saved'})=>show?<span className="saved-note">{children}</span>:null;

const SETTINGS_TABS=[['products','Products'],['colors','Colors'],['icons','Icons'],['shipping','Shipping'],['languages','Languages'],['general','General'],['paths','Paths']];

function Settings({config,saveConfig,setConfig,refreshMap,shipping,saveShipping,setShipping,unsaved,checkUpdates,files}){
  const [tab,setTab]=useState('products');
  const [cfg,setCfg]=useState(config);
  const [saved,setSaved]=useState(false);
  const [shipDraft,setShipDraft]=useState(shipping);
  const save=async()=>{await saveConfig(cfg);setSaved(true);setTimeout(()=>setSaved(false),2000);};
  // Both editors hold their changes until Save, and tell App so leaving the page can warn about them.
  const cfgDirty=useMemo(()=>cfg!==config&&JSON.stringify(cfg)!==JSON.stringify(config),[cfg,config]);
  const shipDirty=useMemo(()=>shipDraft!==shipping&&JSON.stringify(shipDraft)!==JSON.stringify(shipping),[shipDraft,shipping]);
  useEffect(()=>{unsaved.current=cfgDirty||shipDirty;},[cfgDirty,shipDirty,unsaved]);
  const shared={cfg,setCfg,save,saved};
  return(
    <div className="page-fill">
      <div className="tabs">
        {SETTINGS_TABS.map(([t,l])=>(
          <button key={t} className={`tab ${tab===t?'active':''}`} onClick={()=>setTab(t)}>{l}</button>
        ))}
      </div>
      <div className="view-anim page-fill" key={tab}>
        {tab==='products'&&<ProductsTab {...shared} setConfig={setConfig}/>}
        {tab==='colors'&&<ColorsTab cfg={cfg}/>}
        {tab==='icons'&&<IconsTab cfg={cfg}/>}
        {tab==='shipping'&&<ShippingTab draft={shipDraft} setDraft={setShipDraft} dirty={shipDirty} saveShipping={saveShipping} config={config}/>}
        {tab==='languages'&&<LanguagesTab {...shared} files={files}/>}
        {tab==='general'&&<GeneralTab {...shared} setConfig={setConfig} refreshMap={refreshMap} checkUpdates={checkUpdates}/>}
        {tab==='paths'&&<PathsTab {...shared}/>}
      </div>
    </div>
  );
}

function ProductsTab({cfg,setCfg,save,saved,setConfig}){
  const [assets,setAssets]=useState({});
  useEffect(()=>{api.checkAssets().then(r=>{if(r&&!r.error)setAssets(r);});},[]);
  const [syncing,setSyncing]=useState(false);
  const [syncMsg,setSyncMsg]=useState('');
  const syncFromDefault=async()=>{
    setSyncing(true);
    const r=await api.syncProducts();
    setSyncing(false);
    if(r.ok){
      setCfg(r.config);setConfig(r.config);   // the server has saved it already
      const added=r.added?.length??0, updated=r.updated?.length??0;
      setSyncMsg(added||updated?`Added ${added}, updated ${updated}`:'Already up to date');
      setTimeout(()=>setSyncMsg(''),3000);
    }
  };
  const updP=(i,k,v)=>{const p=[...cfg.products];p[i]={...p[i],[k]:v};setCfg({...cfg,products:p});};
  const remP=i=>setCfg({...cfg,products:cfg.products.filter((_,j)=>j!==i)});
  const indexed=cfg.products.map((p,i)=>({...p,_i:i}));
  return(
    <div className="page-fill">
      <p className="section-title">Product list</p>
      <div className="scroll-y">
        {['MO','PAM','CE'].map(cat=>(
          <div key={cat} style={{marginBottom:'var(--space-5)'}}>
            <CategoryHeading cat={cat}/>
            {indexed.filter(p=>p.category===cat).sort((a,b)=>a.name.localeCompare(b.name)).map(p=>{
              const i=p._i,a=assets[p.name]||{};
              return(
                <div key={p.name+i} className="list-row">
                  <label className="toggle"><input type="checkbox" checked={p.enabled} onChange={e=>updP(i,'enabled',e.target.checked)}/><span className="toggle-slider"/></label>
                  <span style={{flex:1,fontSize:'var(--fs-md)',fontWeight:500,color:p.enabled?'var(--text)':'var(--text3)'}}>{p.name}</span>
                  <div style={{display:'flex',gap:'var(--space-1)'}}>
                    {[['QR',a.qr],['Logo',a.logo]].map(([lbl,ok])=>(
                      <span key={lbl} title={ok?lbl+' found':lbl+' missing'} className={`badge ${ok?'badge-ok':'badge-neutral'}`} style={{fontSize:'var(--fs-2xs)'}}>{lbl}</span>
                    ))}
                  </div>
                  {p.category==='PAM'&&(
                    <label className="flex items-center gap-2" style={{cursor:'pointer',fontSize:'var(--fs-sm)',color:'var(--text3)'}}>
                      <input type="checkbox" checked={p.acidic} onChange={e=>updP(i,'acidic',e.target.checked)} style={{accentColor:'var(--pam)'}}/>acidic
                    </label>
                  )}
                  <div className="pill-toggle">
                    {['L','kg'].map(u=>(
                      <button key={u} className={`pill-btn ${p.unit===u?'active-mo':'inactive'}`} onClick={()=>updP(i,'unit',u)}>{u}</button>
                    ))}
                  </div>
                  <div className="pill-toggle">
                    {['PAM','MO','CE'].map(c=>(
                      <button key={c} className={`pill-btn ${p.category===c?'active-'+c.toLowerCase():'inactive'}`} onClick={()=>updP(i,'category',c)}>{c}</button>
                    ))}
                  </div>
                  <button className="btn btn-danger btn-sm" onClick={()=>remP(i)} aria-label={`Remove ${p.name}`}>✕</button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="action-bar">
        <button className="btn btn-ghost" onClick={syncFromDefault} disabled={syncing} title="Add new products from default_config.json without changing existing ones or your colors">
          {syncing?<><div className="spinner" style={{width:12,height:12}}/>Syncing...</>:'↻ Sync from default'}
        </button>
        {syncMsg&&<span className="saved-note">{syncMsg}</span>}
        <span className="ml-auto"><SavedNote show={saved}/></span>
        <button className="btn btn-primary" onClick={save}>Save changes</button>
      </div>
    </div>
  );
}

function ColorsTab({cfg}){
  const [colors,setColors]=useState(null);
  const [colorsSaved,scheduleColorsSave]=useAutosave(api.saveColors,900);
  const [swatchEdit,setSwatchEdit]=useState(null);
  const swatchPopRef=useRef(null);
  useEffect(()=>{api.getColors().then(r=>setColors(r.colors||{}));},[]);
  useEffect(()=>{
    if(!swatchEdit)return;
    const h=e=>{if(swatchPopRef.current&&!swatchPopRef.current.contains(e.target))setSwatchEdit(null);};
    document.addEventListener('mousedown',h);
    return()=>document.removeEventListener('mousedown',h);
  },[swatchEdit]);
  const setColor=(name,idx,hex)=>{
    const curr=((colors||{})[name]||Array(6).fill('#808080')).slice();
    curr[idx]=hex;
    const newColors={...colors,[name]:curr};
    setColors(newColors);
    scheduleColorsSave(newColors);
  };
  return(
    <div className="page-fill">
      <p className="section-title" style={{marginBottom:'var(--space-1)'}}>Color schemes</p>
      <p className="hint" style={{marginBottom:'var(--space-4)'}}>Click a swatch to change its color. Colors save automatically. Up to 6 per product.</p>
      {colors===null?(
        <div className="spinner" style={{width:20,height:20}}/>
      ):(
        <>
          <div className="scroll-y">
            {productsByCategory(cfg).map(([cat,prods])=>prods.length===0?null:(
              <div key={cat} style={{marginBottom:'var(--space-5)'}}>
                <CategoryHeading cat={cat}/>
                {prods.map(p=>{
                  const swatches=(colors[p.name]||Array(6).fill('#808080'));
                  return(
                    <div key={p.name} className="list-row" style={{background:'var(--surface2)',padding:'var(--space-2) var(--space-3)'}}>
                      <span style={{flex:1,fontSize:'var(--fs-md)',fontWeight:500}}>{p.name}</span>
                      <div style={{display:'flex',gap:6}}>
                        {Array.from({length:6},(_,idx)=>{
                          const hex=swatches[idx]||'#808080';
                          const isEd=swatchEdit?.prod===p.name&&swatchEdit?.idx===idx;
                          return(
                            <div key={idx} style={{position:'relative',flexShrink:0}}>
                              <div
                                title={'Swatch '+(idx+1)+': '+hex}
                                onClick={()=>setSwatchEdit(isEd?null:{prod:p.name,idx,val:hex})}
                                style={{width:28,height:28,borderRadius:5,background:hex,border:'2px solid '+(isEd?'var(--accent)':'var(--border2)'),cursor:'pointer'}}
                              />
                              {isEd&&(
                                <div ref={swatchPopRef} style={{position:'absolute',bottom:36,left:'50%',transform:'translateX(-50%)',zIndex:200,background:'var(--surface3)',border:'1px solid var(--border2)',borderRadius:'var(--radius-sm)',padding:10,display:'flex',flexDirection:'column',gap:'var(--space-2)',boxShadow:'0 4px 20px var(--shadow-lg)',minWidth:130}}>
                                  <input type="color" value={swatchEdit.val}
                                    onChange={e=>{const v=e.target.value;setSwatchEdit(s=>({...s,val:v}));setColor(p.name,idx,v);}}
                                    style={{width:'100%',height:36,border:'1px solid var(--border2)',borderRadius:4,cursor:'pointer',padding:2,background:'var(--surface2)'}}
                                  />
                                  <input type="text" className="input mono"
                                    value={swatchEdit.val}
                                    style={{fontSize:'var(--fs-sm)',padding:'5px 8px',textTransform:'uppercase',textAlign:'center'}}
                                    onChange={e=>{
                                      let v=e.target.value;
                                      if(v&&!v.startsWith('#'))v='#'+v;
                                      setSwatchEdit(s=>({...s,val:v}));
                                      if(/^#[0-9A-Fa-f]{6}$/.test(v))setColor(p.name,idx,v);
                                    }}
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          {colorsSaved&&<span className="saved-note" style={{flexShrink:0,paddingTop:'var(--space-2)'}}>Colors saved</span>}
        </>
      )}
    </div>
  );
}

function IconsTab({cfg}){
  const [iconLib,setIconLib]=useState(null);
  const [iconAssign,setIconAssign]=useState(null);
  const [iconAssignSaved,scheduleIconSave]=useAutosave(api.saveIconAssignments,600);
  const [iconEditProd,setIconEditProd]=useState(null);
  useEffect(()=>{
    api.getIcons().then(r=>setIconLib(r));
    api.getIconAssignments().then(r=>setIconAssign(r.assignments||{}));
  },[]);
  const toggleIcon=(prod,iconId)=>{
    const curr=(iconAssign?.[prod]||[]);
    const next=curr.includes(iconId)?curr.filter(x=>x!==iconId):[...curr,iconId];
    const newAssign={...iconAssign,[prod]:next};
    setIconAssign(newAssign);
    scheduleIconSave(newAssign);
  };
  return(
    <div style={{display:'flex',gap:'var(--space-5)',flex:1,minHeight:0}}>
      <div className="page-fill" style={{width:230,flex:'none'}}>
        <p className="section-title">Products</p>
        <div className="scroll-y">
          {productsByCategory(cfg).map(([cat,prods])=>prods.length===0?null:(
            <div key={cat} style={{marginBottom:'var(--space-4)'}}>
              <CategoryHeading cat={cat}/>
              <div className="pick-list">
                {prods.map(p=>{
                  const n=(iconAssign?.[p.name]||[]).length;
                  return(
                    <button key={p.name} className={'pick-row'+(iconEditProd===p.name?' on':'')} onClick={()=>setIconEditProd(p.name)}>
                      <span className="pick-row-name">{p.name}</span>
                      <span className="mono muted" style={{fontSize:'var(--fs-2xs)',flexShrink:0}}>{n||''}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="scroll-y">
        {!iconEditProd?(
          <div className="muted" style={{fontSize:'var(--fs-md)',fontStyle:'italic',paddingTop:'var(--space-1)'}}>Select a product to edit its assigned traits.</div>
        ):!iconLib?(
          <div className="spinner" style={{width:20,height:20}}/>
        ):(
          <>
            <div className="flex items-center gap-2" style={{marginBottom:'var(--space-3)'}}>
              <p className="section-title" style={{margin:0}}>{iconEditProd} — traits</p>
              <SavedNote show={iconAssignSaved}/>
            </div>
            {[['microbial_benefit','Microbial benefit'],['adjuvant_benefit','Adjuvant benefit']].map(([cat,catLabel])=>{
              const icons=iconLib.icons.filter(ic=>ic.category===cat);
              if(!icons.length)return null;
              return(
                <div key={cat} style={{marginBottom:'var(--space-5)'}}>
                  <div className="eyebrow mono" style={{marginBottom:'var(--space-2)'}}>{catLabel}</div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:'var(--space-2)'}}>
                    {icons.map(ic=>{
                      const checked=(iconAssign?.[iconEditProd]||[]).includes(ic.id);
                      return(
                        <label key={ic.id} title={ic.name_en} className={'select-card'+(checked?' selected':'')}
                          style={{display:'flex',alignItems:'center',gap:'var(--space-2)',padding:'var(--space-2) 10px'}}>
                          <input type="checkbox" checked={checked} onChange={()=>toggleIcon(iconEditProd,ic.id)} style={{accentColor:'var(--accent)',flexShrink:0}}/>
                          <img src={`/icons/${ic.svg}`} alt="" style={{width:22,height:22,flexShrink:0,opacity:checked?1:.5}}/>
                          <span style={{fontSize:'var(--fs-xs)',lineHeight:1.25,color:checked?'var(--text)':'var(--text3)'}}>{ic.name_en}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

function LanguagesTab({cfg,setCfg,save,saved,files}){
  const [search,setSearch]=useState('');
  const [sort,setSort]=useLangSort();
  const [newLang,setNewLang]=useState({code:'',name:''});
  const usage=useMemo(()=>langUsage(files),[files]);
  const shown=useMemo(()=>sortLangs(cfg.languages.filter(l=>matchesSearch(langText(l),search)),sort,usage),[cfg.languages,search,sort,usage]);
  const setEnabled=(code,enabled)=>setCfg({...cfg,languages:cfg.languages.map(l=>l.code===code?{...l,enabled}:l)});
  const remove=code=>setCfg({...cfg,languages:cfg.languages.filter(l=>l.code!==code)});
  const code=newLang.code.trim().toUpperCase(),name=newLang.name.trim();
  const clash=cfg.languages.find(l=>l.code===code)??cfg.languages.find(l=>l.iso?.toUpperCase()===code);
  const problem=!code?'':!/^[A-Z]{2,3}$/.test(code)?'A code is 2 or 3 letters.'
    :['BL','KR','CZ','EE','GR','UA'].includes(code)?`${code} is how older labels wrote another language.`:clash?`${code} is already ${clash.name}.`:'';
  const add=()=>{
    if(!code||!name||problem)return;
    setCfg({...cfg,languages:[...cfg.languages,{code,name,enabled:true}]});
    setNewLang({code:'',name:''});
    setSearch('');
  };
  return(
    <div className="page-fill">
      <div className="flex gap-2 items-center" style={{flexShrink:0,marginBottom:'var(--space-3)'}}>
        <div className="search-wrap" style={{flex:'1 1 auto',maxWidth:380}}>
          <span className="search-icon"><Icon.Search size={14}/></span>
          <input className="input" placeholder="Search languages..." aria-label="Search languages" value={search} onChange={e=>setSearch(e.target.value)}/>
        </div>
        <LangSortToggle sort={sort} onChange={setSort}/>
        <span className="hint ml-auto">Languages switched on are offered in New Label.</span>
      </div>
      <div className="hint" style={{flexShrink:0,marginBottom:'var(--space-3)'}}>Language codes follow the ISO 639 standard: the two-letter ISO 639-1 codes, except Ewe (EWE), Kanuri (KAU) and Chechen (CHE), which use their three-letter ISO 639-2 codes because their two-letter ones mean something else on labels.</div>
      <div className="scroll-y">
        {langGroups(shown,sort,usage).map(g=>(
          <div key={g.title??'all'} style={{marginBottom:'var(--space-5)'}}>
            {g.title&&<div className="eyebrow" style={{marginBottom:'var(--space-2)'}}>{g.title}</div>}
            {g.items.map(l=>(
              <div key={l.code} className="list-row">
                <label className="toggle"><input type="checkbox" aria-label={`Offer ${l.name} in New Label`} checked={l.enabled} onChange={e=>setEnabled(l.code,e.target.checked)}/><span className="toggle-slider"/></label>
                <span className="mono" style={{fontSize:'var(--fs-md)',fontWeight:600,width:36,flexShrink:0,color:'var(--accent)'}}>{l.code}</span>
                <span style={{flex:1,minWidth:0,fontSize:'var(--fs-md)',color:'var(--text2)'}} title={l.alt?`Also: ${l.alt}`:undefined}>
                  {l.name}
                  {l.iso&&l.iso!==l.code.toLowerCase()&&<span className="mono muted" style={{fontSize:'var(--fs-xs)',marginLeft:'var(--space-2)'}} title={`ISO 639-1 code ${l.iso}. Labels write this language as ${l.code}.`}>ISO {l.iso}</span>}
                </span>
                {usage[l.code]>0&&<span className="mono muted" style={{fontSize:'var(--fs-xs)',flexShrink:0}}>{fileCount(usage[l.code])}</span>}
                {!l.iso&&<button className="btn btn-danger btn-sm" onClick={()=>remove(l.code)} aria-label={`Remove ${l.name}`}>✕</button>}
              </div>
            ))}
          </div>
        ))}
        {shown.length===0&&<div className="muted" style={{fontSize:'var(--fs-md)',fontStyle:'italic'}}>No language matches “{search.trim()}”.</div>}
      </div>
      <div style={{flexShrink:0,borderTop:'1px solid var(--border)',marginTop:'var(--space-3)',paddingTop:'var(--space-4)',display:'flex',flexDirection:'column',gap:'var(--space-2)'}}>
        <div className="eyebrow">Add a language that isn't in ISO 639-1</div>
        <div className="flex gap-2 items-center">
          <input className={'input'+(problem?' invalid':'')} placeholder="Code" aria-label="Language code" value={newLang.code} onChange={e=>setNewLang({...newLang,code:e.target.value.toUpperCase()})} style={{width:84}}/>
          <input className="input" placeholder="Full name" aria-label="Language name" value={newLang.name} onChange={e=>setNewLang({...newLang,name:e.target.value})} style={{flex:1}}/>
          <button className="btn btn-primary" disabled={!code||!name||!!problem} onClick={add}>Add</button>
        </div>
        {problem&&<div style={{fontSize:'var(--fs-sm)',color:'var(--danger)'}}>{problem}</div>}
      </div>
      <div className="action-bar">
        <span className="mono muted" style={{fontSize:'var(--fs-xs)'}}>{cfg.languages.filter(l=>l.enabled).length}/{cfg.languages.length} switched on</span>
        <span className="ml-auto"><SavedNote show={saved}/></span>
        <button className="btn btn-primary" onClick={save}>Save changes</button>
      </div>
    </div>
  );
}

// Lets someone install sooner than the "remind me" they chose, and shows which version this is.
function UpdatesCard({checkUpdates}){
  const [state,setState]=useState(null);
  const [checking,setChecking]=useState(false);
  useEffect(()=>{api.checkUpdate().then(setState).catch(()=>{});},[]);
  const check=async()=>{
    setChecking(true);
    setState(await checkUpdates().catch(()=>({managed:true,error:'Could not check for updates.'})));
    setChecking(false);
  };
  const unmanaged=state?.managed===false;
  const message=!state?'':unmanaged?'This copy runs from a source folder, so it does not update itself.'
    :state.error?state.error:state.available?'A new version is available.':'You have the latest version.';
  return(
    <SettingCard title="Updates" desc={`Etiketas checks when you open it, and offers new versions.${state?.current?` Installed version: ${state.current}.`:''}`}>
      <button className="btn btn-ghost w-full" onClick={check} disabled={checking||unmanaged}>
        {checking?<><div className="spinner"/>Checking...</>:'Check for updates'}
      </button>
      {message&&<div className="hint" style={{marginTop:'var(--space-2)'}}>{message}</div>}
    </SettingCard>
  );
}

function GeneralTab({cfg,setCfg,save,saved,setConfig,refreshMap,checkUpdates}){
  const [scanning,setScanning]=useState(false);
  const [resetting,setResetting]=useState(false);
  const resetToDefaults=async()=>{
    if(!window.confirm('Reset all settings to factory defaults? This cannot be undone.'))return;
    setResetting(true);
    const res=await api.resetConfig();
    if(res.ok){setCfg(res.config);setConfig(res.config);}
    setResetting(false);
  };
  const handleScan=async()=>{setScanning(true);await refreshMap();setScanning(false);};
  return(
    <div className="scroll-y" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'var(--space-4)',alignContent:'start'}}>
      <SettingCard title="File Map" desc="Rescan the labels folder to pick up newly added or renamed files.">
        <button className="btn btn-ghost w-full" onClick={handleScan} disabled={scanning}>
          {scanning?<><div className="spinner"/>Scanning...</>:<><Icon.Refresh/>Rescan labels folder</>}
        </button>
      </SettingCard>
      <SettingCard title="Export config" desc="Download a snapshot of your product list, brand colors and shipping data as a JSON file.">
        <button className="btn btn-ghost w-full" onClick={()=>fetch('/api/export').then(r=>r.blob()).then(blob=>{const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='etiketas_export.json';a.click();})}>
          ↓ Download export
        </button>
      </SettingCard>
      <SettingCard title="Factory reset" desc="Restore all settings to defaults. Your file map, brand colors and shipping data are not affected." danger>
        <button className="btn btn-danger w-full" onClick={resetToDefaults} disabled={resetting}>
          {resetting?<><div className="spinner"/>Resetting...</>:'Reset to factory defaults'}
        </button>
      </SettingCard>
      <SettingCard title="SharePoint links" desc="Base URL of the synced SharePoint folder (the part before the product/size path). Used to add an 'Open in SharePoint' button next to files.">
        <div className="flex gap-2 items-center">
          <input className="input" placeholder="https://yourtenant.sharepoint.com/:f:/r/sites/.../Etiketas" value={cfg.sharepointBaseUrl||''} onChange={e=>setCfg({...cfg,sharepointBaseUrl:e.target.value})} style={{flex:1}}/>
          <button className="btn btn-primary" onClick={save}>Save</button>
        </div>
        {saved&&<div className="saved-note" style={{marginTop:'var(--space-2)'}}>✓ Saved</div>}
      </SettingCard>
      <UpdatesCard checkUpdates={checkUpdates}/>
    </div>
  );
}

function PathsTab({cfg,setCfg,save,saved}){
  const [resDirs,setResDirs]=useState(null);
  useEffect(()=>{api.getResourceDirs().then(r=>setResDirs(r));},[]);
  return(
    <div className="scroll-y">
      <SettingCard title="Folders" desc="Where the app reads templates, QR codes, logos and translations from. Leave a field blank to use the shared 'Marketing - Label Resources' OneDrive folder on this PC -- the default. These settings are shared by everyone who uses the labels folder, so a custom folder should exist on every PC; ~ stands for each user's own profile folder.">
        <div style={{display:'flex',flexDirection:'column',gap:'var(--space-4)'}}>
          {[
            ['templatesDir','templates','Templates','IDML template files used when creating labels'],
            ['qrCodesDir','qrcodes','QR codes','PNG QR code images matched to products ({product}_QR.png)'],
            ['logosDir','logos','Logos','Product logo files used in labels ({product}_LOGO.*)'],
            ['translationsDir','translations','Translations','Language/translation JSON files'],
          ].map(([key,dirKey,label,desc])=>{
            const missing=resDirs?.missing?.includes(dirKey);
            return(
              <div key={key}>
                <div style={{fontSize:'var(--fs-sm)',fontWeight:600,color:'var(--text)',marginBottom:2}}>{label}</div>
                <div className="muted" style={{fontSize:'var(--fs-xs)',marginBottom:6}}>{desc}</div>
                <div className="flex gap-2 items-center">
                  <input className="input mono" aria-label={`${label} folder`} placeholder={resDirs?.defaults?.[key]||''} value={cfg[key]||''} onChange={e=>setCfg({...cfg,[key]:e.target.value})} style={{flex:1,fontSize:'var(--fs-sm)'}}/>
                  <button className="btn btn-folder btn-sm" title="Browse for folder" onClick={async()=>{const pick=await api.pickDir();if(pick.ok&&pick.path)setCfg(c=>({...c,[key]:pick.path}));}}><Icon.Folder/></button>
                  {cfg[key]&&<button className="btn btn-ghost btn-sm" title="Reset to default" onClick={()=>setCfg(c=>({...c,[key]:''}))}>&#8634;</button>}
                  <button className="btn btn-ghost btn-sm" title="Open in Explorer" disabled={!resDirs?.[dirKey]||missing} onClick={()=>api.openFile(resDirs[dirKey])}><Icon.External/></button>
                </div>
                {missing&&<div style={{fontSize:'var(--fs-xs)',color:'var(--danger)',marginTop:'var(--space-1)'}}>Folder not found: {resDirs[dirKey]}</div>}
              </div>
            );
          })}
        </div>
        <div className="flex gap-2 items-center mt-4">
          <button className="btn btn-primary" onClick={async()=>{await save();setResDirs(await api.getResourceDirs());}}>Save</button>
          <SavedNote show={saved}/>
        </div>
      </SettingCard>
    </div>
  );
}

// ── Settings: shipping data ──────────────────────────────────────────────────────────
const SHIP_IDENTITY=[
  ['name','Name','text'],['variant','Variant','text','If two versions ship'],['unit','Unit','unit'],['group','Group','group'],
  ['shelfLifeMonths','Shelf life','months'],['density','Density (kg per L)','number'],['strapWeight','Strap per pallet (kg)','number'],
];
const SHIP_DETAILS=[
  ['customsCode','Customs code','text'],['origin','Country of origin','text'],['storageMin','Storage from','celsius'],['storageMax','Storage to','celsius'],
  ['adrClass','ADR class','adr'],['packingGroup','Packing group','pg'],['airTransport','Air transport allowed','bool'],
  ['subgroup','Subgroup','long'],['note','Note','long'],
];
const TDS_FIELDS=[
  ['name','Product','text'],['code','Code','text'],['version','Version','text'],['revised','Revised','text','YYYY-MM-DD'],
  ['shelfLifeMonths','Shelf life','months'],['storageMin','Storage from','celsius'],['storageMax','Storage to','celsius'],
  ['form','Form','text'],['colour','Colour','text'],['odour','Odour','text'],['ph','pH','text'],['density','Density (g/cm³)','text'],
  ['packaging','Packaging','text'],['concentration','Concentration','text'],['organic','Suitable for organic farming','bool'],['older','Older document','bool'],
  ['type','Type','long'],['application','Application','long'],['hazard','Hazard classification','long'],['file','File','text'],['folder','Folder','text'],
];
const ADR_CLASSES=['1','2','3','4.1','4.2','4.3','5.1','5.2','6.1','6.2','7','8','9'];

const shipProblem=p=>{
  if(!p.name?.trim())return 'needs a name';
  if(p.packs?.length&&p.unit==='L'&&!(p.density>0))return 'needs a density';
  if(p.packs?.length&&!(p.strapWeight>0))return 'needs a strap weight';
  for(const k of p.packs??[]){
    if(!(k.packSize>0))return 'has a pack with no size';
    const size=`${k.packSize} ${p.unit}`;
    if(!(k.palletSize>0))return `${size} needs to say what a pallet holds`;
    if(!k.palletId)return `${size} needs a pallet`;
    if(!k.containerId)return `${size} needs a container`;
    if(k.boxId&&!(k.unitsPerBox>0))return `${size} needs units per box`;
  }
  const sizes=(p.packs??[]).map(k=>k.packSize);
  return new Set(sizes).size<sizes.length?'has two packs of the same size':null;
};
const duplicateProduct=draft=>{
  const seen=new Set();
  for(const p of draft.products??[]){
    const key=profileName(p).trim().toLowerCase();
    if(seen.has(key))return p;
    seen.add(key);
  }
  return null;
};
const catalogueUse=(draft,field)=>{
  const n={};
  for(const p of draft.products??[])for(const k of p.packs??[])if(k[field])n[k[field]]=(n[k[field]]||0)+1;
  return n;
};
const catalogueProblem=draft=>{
  for(const c of SHIP_CATALOGUES){
    const used=catalogueUse(draft,c.usedBy);
    for(const r of draft[c.key]??[]){
      if(!r.name?.trim())return `${c.title}: a row needs a name.`;
      if(used[r.id]&&!(r.weight>0))return `${c.title}: ${r.name} is used by ${used[r.id]} pack${used[r.id]===1?'':'s'} and needs a weight.`;
    }
  }
  return null;
};
const newId=prefix=>`${prefix}-${Date.now().toString(36)}${Math.floor(Math.random()*1296).toString(36)}`;
const blankPack=()=>({id:newId('pack'),packSize:null,palletSize:null,palletId:null,containerId:null,boxId:null,unitsPerBox:null});
// What the rest of the data says, so a new entry starts from how things are done here.
const usualStrap=(draft,unit)=>mostCommon((draft.products??[]).filter(p=>p.unit===unit&&p.strapWeight>0).map(p=>p.strapWeight));
const containerKind=unit=>unit==='kg'?'bag':'container';
const usualPack=(draft,unit,size,skipId)=>{
  if(!(size>0))return {};
  const others=(draft.products??[]).filter(p=>p.unit===unit).flatMap(p=>p.packs??[]).filter(k=>k.id!==skipId);
  const same=others.filter(k=>k.packSize===size);
  const made=(draft.containers??[]).filter(c=>c.forSize===size&&c.kind===containerKind(unit)).map(c=>c.id);
  const boxId=mostCommon(same.map(k=>k.boxId))??null;
  return {
    palletSize:mostCommon(same.map(k=>k.palletSize))??null,
    palletId:mostCommon((same.length?same:others).map(k=>k.palletId))??null,
    containerId:mostCommon(same.map(k=>k.containerId).filter(id=>made.includes(id)))??made[0]??null,
    boxId,
    unitsPerBox:boxId?mostCommon(same.filter(k=>k.boxId===boxId).map(k=>k.unitsPerBox))??null:null,
  };
};
// A pack after its size or unit changes. Blank, or only what the old size and unit would have filled in, follows; a choice someone made stays.
const refillPack=(draft,config,k,fromUnit,unit,size)=>{
  const was=usualPack(draft,fromUnit,k.packSize,k.id),now=usualPack(draft,unit,size,k.id);
  const follow=f=>k[f]==null||k[f]===was[f]?now[f]??null:k[f];
  const boxId=follow('boxId');
  const onSheet=size>0?unitsPerBoxOnSheet(config,size,unit):null;
  return {packSize:size,palletSize:follow('palletSize'),palletId:follow('palletId'),containerId:follow('containerId'),boxId,
    unitsPerBox:boxId?onSheet??(boxId===k.boxId?k.unitsPerBox:now.unitsPerBox??null):null};
};
// A label product's data sheets, the ones that suit the unit first: BioSplito has a powder and a liquid.
const sheetsForLabel=(draft,name,unit)=>{
  const all=(draft.tds??[]).filter(t=>t.labels?.includes(name));
  const fit=all.filter(t=>(t.form||'').toLowerCase().startsWith('powder')===(unit==='kg'));
  return fit.length?fit:all;
};
const fromSheet=sheet=>sheet?{shelfLifeMonths:sheet.shelfLifeMonths??null,storageMin:sheet.storageMin??null,storageMax:sheet.storageMax??null}:{};
const newProfile=(name,link,draft)=>{
  const unit=link?.unit??'L';
  const sheets=link?sheetsForLabel(draft,link.name,unit):[];
  const sibling=link?(draft.products??[]).find(p=>p.links?.includes(link.name)&&p.shelfLifeMonths):null;
  return {id:newId('product'),name,variant:'',links:link?[link.name]:[],tds:sheets.map(t=>t.id),unit,group:link?.category??'',subgroup:'',density:null,strapWeight:usualStrap(draft,unit),
    shelfLifeMonths:sibling?.shelfLifeMonths??null,origin:'LT',customsCode:'',storageMin:null,storageMax:null,adrClass:'',packingGroup:'',airTransport:true,note:'',packs:[blankPack()],...fromSheet(sheets[0])};
};
const blankSheet=()=>({id:newId('tds'),name:'',labels:[],code:'',version:'',revised:'',file:'',folder:'',older:false,type:'',application:'',form:'',colour:'',odour:'',ph:'',density:'',concentration:'',shelfLifeMonths:null,storageMin:null,storageMax:null,packaging:'',hazard:'',organic:false});

function ShippingTab({draft,setDraft,dirty,saveShipping,config}){
  const [section,setSection]=useState('items');
  const [saved,setSaved]=useState(false);
  const [error,setError]=useState('');
  if(!draft||draft.error)return <div className="alert alert-error">{draft?.error??'The shipping data could not be read'}. Close whatever has it open, then reload this page.</div>;
  const badProduct=(draft.products??[]).find(shipProblem);
  const twin=duplicateProduct(draft);
  const problem=badProduct?`${profileName(badProduct)||'A product'} ${shipProblem(badProduct)}.`
    :twin?`Two products are called ${profileName(twin)}. Give one a variant.`
    :(draft.tds??[]).some(t=>!t.name?.trim())?'A data sheet needs a product name.'
    :catalogueProblem(draft);
  const save=async()=>{
    setError('');
    const r=await saveShipping(draft);
    if(r.ok){setSaved(true);setTimeout(()=>setSaved(false),2000);}
    else setError(r.error||'Could not save');
  };
  return(
    <div className="page-fill">
      <div className="flex items-center gap-3" style={{flexShrink:0,marginBottom:'var(--space-4)'}}>
        <div className="seg" role="group" aria-label="Section">
          {[['items','Products'],['tables','Pallets & packaging'],['sheets','Data sheets']].map(([s,l])=>(
            <button key={s} type="button" aria-pressed={section===s} className={'seg-btn'+(section===s?' on':'')} onClick={()=>setSection(s)}>{l}</button>
          ))}
        </div>
        <span className="hint">Saved as shipping_profiles.json in the labels folder, next to the file map, and shared with everyone who uses it.</span>
        <button className="btn btn-folder btn-sm ml-auto" style={{flexShrink:0}} onClick={async()=>{const p=await api.getLabelsDir();api.openFile(p);}}><Icon.Folder/>Open folder</button>
      </div>
      {section==='items'&&<ShipProductsEditor draft={draft} setDraft={setDraft} config={config}/>}
      {section==='tables'&&<ShipTablesEditor draft={draft} setDraft={setDraft}/>}
      {section==='sheets'&&<ShipSheetsEditor draft={draft} setDraft={setDraft} config={config}/>}
      {(problem||error)&&<div className="alert alert-error" style={{flexShrink:0,marginTop:'var(--space-3)'}}>{error||`${problem} Fix this before saving.`}</div>}
      <div className="action-bar">
        <span className="ml-auto"><SavedNote show={saved}/>{dirty&&!saved&&<span className="badge badge-wip">Unsaved changes</span>}</span>
        <button className="btn btn-primary" disabled={!dirty||!!problem} onClick={save}>Save changes</button>
      </div>
    </div>
  );
}

// A new profile starts from a label product, which fills in what the app already knows about it,
// or from just a name: products that ship but never get a label stay out of the label side altogether.
function AddShipProduct({config,draft,onCreate,onOpen,onClose}){
  const [kind,setKind]=useState('label');
  const [linkName,setLinkName]=useState('');
  const [name,setName]=useState('');
  const appProducts=useMemo(()=>[...(config?.products??[])].sort((a,b)=>a.name.localeCompare(b.name)),[config]);
  const link=appProducts.find(p=>p.name===linkName);
  const existing=link?(draft.products??[]).filter(p=>p.links?.includes(link.name)):[];
  const clash=kind==='new'&&(draft.products??[]).find(p=>p.name.trim().toLowerCase()===name.trim().toLowerCase());
  const preview=link?newProfile(link.name,link,draft):null;
  const canCreate=kind==='label'?!!link:!!name.trim()&&!clash;
  const create=()=>{
    if(!canCreate)return;
    onCreate(kind==='label'?newProfile(link.name,link,draft):newProfile(name.trim(),null,draft));
  };
  return(
    <Modal title="Add a shipping product" onEscape={onClose}>
      <div className="seg modal-section" role="group" aria-label="Kind of product">
        <button type="button" aria-pressed={kind==='label'} className={'seg-btn'+(kind==='label'?' on':'')} onClick={()=>setKind('label')}>A label product</button>
        <button type="button" aria-pressed={kind==='new'} className={'seg-btn'+(kind==='new'?' on':'')} onClick={()=>setKind('new')}>A new product</button>
      </div>
      {kind==='label'?(
        <div className="field modal-section" style={{marginBottom:0}}>
          <label htmlFor="ship-link">Product</label>
          <select id="ship-link" className="input" value={linkName} onChange={e=>setLinkName(e.target.value)}>
            <option value="">Choose a product…</option>
            {['MO','PAM','CE'].map(cat=>(
              <optgroup key={cat} label={cat}>{appProducts.filter(p=>p.category===cat).map(p=><option key={p.name} value={p.name}>{p.name}</option>)}</optgroup>
            ))}
          </select>
          {preview
            ?<div className="hint">Fills in: unit {preview.unit} · group {preview.group} · shelf life {preview.shelfLifeMonths?fmtMonths(preview.shelfLifeMonths):'not in a data sheet'}{preview.storageMin!=null?` · storage ${fmtStorage(preview)}`:''}</div>
            :<div className="hint">Fills in its unit, group, and from its data sheet the shelf life and storage.</div>}
          {existing.length>0&&(
            <div className="alert alert-warning" style={{marginTop:'var(--space-2)'}}>
              <span>{link.name} is already in {profileName(existing[0])}. Add packs to it there, or make a new one only if it ships as a separate version.</span>
              <button type="button" className="btn btn-ghost btn-sm" style={{flexShrink:0}} onClick={()=>onOpen(existing[0].id)}>Open it</button>
            </div>
          )}
        </div>
      ):(
        <div className="field modal-section" style={{marginBottom:0}}>
          <label htmlFor="ship-new-name">Name</label>
          <input id="ship-new-name" className={'input'+(clash?' invalid':'')} value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')create();}}/>
          {clash
            ?<div style={{fontSize:'var(--fs-sm)',color:'var(--danger)'}}>There is already a product called {clash.name}.</div>
            :<div className="hint">For products that ship but never get a label. It stays here, out of New Label and the label product list.</div>}
        </div>
      )}
      <div className="flex gap-2 modal-section">
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary ml-auto" disabled={!canCreate} onClick={create}>Add product</button>
      </div>
    </Modal>
  );
}

function ShipProductsEditor({draft,setDraft,config}){
  const [search,setSearch]=useState('');
  const [selectedId,setSelectedId]=useState(null);
  const [adding,setAdding]=useState(false);
  const shown=useMemo(()=>(draft.products??[]).filter(p=>matchesSearch(`${p.name} ${p.variant} ${p.customsCode} ${(p.links??[]).join(' ')}`,search)).sort(byProfileName),[draft.products,search]);
  const groups=[...SHIP_GROUPS,...new Set(shown.map(p=>p.group).filter(g=>!SHIP_GROUPS.includes(g)))];
  const product=(draft.products??[]).find(p=>p.id===selectedId);
  const setProducts=products=>setDraft({...draft,products});
  const update=change=>setProducts(draft.products.map(p=>p.id===selectedId?{...p,...change}:p));
  const add=fresh=>{setProducts([...(draft.products??[]),fresh]);setSelectedId(fresh.id);setSearch('');setAdding(false);};
  return(
    <div className="ship-edit">
      <div className="ship-edit-list">
        <div className="search-wrap" style={{flexShrink:0}}>
          <span className="search-icon"><Icon.Search size={14}/></span>
          <input className="input" placeholder="Search..." aria-label="Search products" value={search} onChange={e=>setSearch(e.target.value)}/>
        </div>
        <div className="scroll-y">
          {groups.map(g=>{
            const inGroup=shown.filter(p=>p.group===g);
            return inGroup.length===0?null:(
              <div key={g||'none'} style={{marginBottom:'var(--space-4)'}}>
                {g?<CategoryHeading cat={g}/>:<div className="eyebrow" style={{marginBottom:'var(--space-2)'}}>No group</div>}
                <div className="pick-list">
                  {inGroup.map(p=>(
                    <button key={p.id} className={'pick-row'+(p.id===selectedId?' on':'')} onClick={()=>setSelectedId(p.id)}>
                      <span className="pick-row-name" title={profileName(p)}>{p.name}{p.variant&&<span className="muted"> · {p.variant}</span>}</span>
                      {shipProblem(p)
                        ?<span className="dot" style={{background:'var(--danger)'}} title={shipProblem(p)}/>
                        :<span className="mono muted" style={{fontSize:'var(--fs-2xs)',flexShrink:0}}>{(p.packs??[]).length} {(p.packs??[]).length===1?'pack':'packs'}</span>}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          {shown.length===0&&<div className="muted" style={{fontSize:'var(--fs-sm)',fontStyle:'italic',padding:'var(--space-2) var(--space-1)'}}>No products{search?' match':' yet'}.</div>}
        </div>
        <button className="btn btn-ghost btn-sm" style={{flexShrink:0}} onClick={()=>setAdding(true)}>+ Add product</button>
      </div>
      {!product?(
        <div className="muted" style={{flex:1,fontSize:'var(--fs-md)',fontStyle:'italic',paddingTop:'var(--space-2)'}}>Select a product to edit its shipping data.</div>
      ):(
        <ShipProductForm key={product.id} product={product} draft={draft} config={config} update={update}
          onDuplicate={()=>add({...product,id:newId('product'),variant:product.variant?`${product.variant} (copy)`:'copy',packs:(product.packs??[]).map(k=>({...k,id:newId('pack')}))})}
          onDelete={()=>{setProducts(draft.products.filter(p=>p.id!==selectedId));setSelectedId(null);}}/>
      )}
      {adding&&<AddShipProduct config={config} draft={draft} onCreate={add} onOpen={id=>{setSelectedId(id);setSearch('');setAdding(false);}} onClose={()=>setAdding(false)}/>}
    </div>
  );
}

// One field of a form; the type says which control it gets.
function ShipField({spec:[k,label,type,placeholder],value,set,disabled,hint}){
  const id=`ship-${k}`;
  return(
    <div className={`field${type==='long'?' wide':''}`}>
      <label htmlFor={id}>{label}</label>
      {type==='number'?<NumInput id={id} value={value} onChange={set}/>
      :type==='months'?<div className="input-unit ship-unit-long"><NumInput id={id} value={value} onChange={set}/><span>months</span></div>
      :type==='celsius'?<div className="input-unit"><NumInput id={id} value={value} onChange={set}/><span>°C</span></div>
      :type==='unit'?(
        <select id={id} className="input" value={value} onChange={e=>set(e.target.value)}><option>L</option><option>kg</option></select>
      ):type==='group'?(
        <select id={id} className="input" value={value??''} onChange={e=>set(e.target.value)}>
          <option value="">—</option>
          {[...new Set([...SHIP_GROUPS,value].filter(Boolean))].map(g=><option key={g}>{g}</option>)}
        </select>
      ):type==='adr'?(
        <select id={id} className="input" value={value??''} onChange={e=>set(e.target.value)}>
          <option value="">None</option>
          {[...new Set([...ADR_CLASSES,value].filter(Boolean))].map(c=><option key={c}>{c}</option>)}
        </select>
      ):type==='pg'?(
        <select id={id} className="input" disabled={disabled} value={value??''} onChange={e=>set(e.target.value)}>
          <option value="">{disabled?'Not applicable':'—'}</option>
          {['I','II','III'].map(g=><option key={g}>{g}</option>)}
        </select>
      ):type==='bool'?(
        <label className="toggle"><input id={id} type="checkbox" checked={!!value} onChange={e=>set(e.target.checked)}/><span className="toggle-slider"/></label>
      ):type==='long'?(
        <textarea id={id} className="input" rows={3} value={value??''} onChange={e=>set(e.target.value)}/>
      ):(
        <input id={id} className="input" placeholder={placeholder} value={value??''} onChange={e=>set(e.target.value)}/>
      )}
      {hint}
    </div>
  );
}
const FieldNote=({children,onUse})=><div className="ship-sheet">{children}{onUse&&<button type="button" className="ship-use" onClick={onUse}>Use</button>}</div>;

// Things picked from a list, shown as chips: label products on a profile, data sheets on a profile, label products on a data sheet.
function LinkChips({values,options,isGone,goneTitle,keptTitle,onChange,label,addFirst,addMore}){
  const nameOf=v=>options.find(o=>o.value===v)?.label??v;
  return(
    <div className="ship-links">
      {values.map(v=>(
        <span key={v} className={`badge ${isGone?.(v)?'badge-danger':'badge-ok'} ship-link`} title={isGone?.(v)?goneTitle:keptTitle}>
          {nameOf(v)}<button type="button" aria-label={`Unlink ${nameOf(v)}`} onClick={()=>onChange(values.filter(x=>x!==v))}><Icon.Close size={10}/></button>
        </span>
      ))}
      <select className="input ship-link-add" aria-label={label} value="" onChange={e=>e.target.value&&onChange([...values,e.target.value])}>
        <option value="">{values.length?addMore:addFirst}</option>
        {options.filter(o=>!values.includes(o.value)).map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function ShipProductForm({product:p,draft,config,update,onDuplicate,onDelete}){
  const labelOptions=useMemo(()=>(config?.products??[]).map(x=>({value:x.name,label:x.name})).sort((a,b)=>a.label.localeCompare(b.label)),[config]);
  const sheetOptions=useMemo(()=>(draft.tds??[]).map(t=>({value:t.id,label:t.name})).sort((a,b)=>a.label.localeCompare(b.label)),[draft.tds]);
  const links=p.links??[];
  const sheets=tdsOf(p,draft);
  // What a newly linked data sheet knows, for the fields still blank.
  const fillBlanks=sheet=>{
    const known=fromSheet(sheet);
    return Object.fromEntries(Object.entries(known).filter(([k])=>p[k]==null));
  };
  // The name follows the links until someone has typed their own.
  const setLinks=next=>{
    const added=next.filter(n=>!links.includes(n));
    const found=added.flatMap(n=>sheetsForLabel(draft,n,p.unit)).filter(t=>!(p.tds??[]).includes(t.id));
    // A data sheet a link brought along goes with it, unless another link still needs it.
    const removed=links.filter(n=>!next.includes(n));
    const dropped=(draft.tds??[]).filter(t=>t.labels?.some(l=>removed.includes(l))&&!t.labels.some(l=>next.includes(l))).map(t=>t.id);
    update({links:next,...(next.length&&(!p.name?.trim()||p.name===links.join(' / '))?{name:next.join(' / ')}:{}),tds:[...(p.tds??[]).filter(id=>!dropped.includes(id)),...found.map(t=>t.id)],...fillBlanks(found[0])});
  };
  const setSheets=next=>{
    const added=(draft.tds??[]).find(t=>next.includes(t.id)&&!(p.tds??[]).includes(t.id));
    update({tds:next,...fillBlanks(added)});
  };
  const setUnit=unit=>update({unit,
    density:unit==='kg'?null:p.density,
    strapWeight:p.strapWeight==null||p.strapWeight===usualStrap(draft,p.unit)?usualStrap(draft,unit):p.strapWeight,
    packs:(p.packs??[]).map(k=>({...k,...refillPack(draft,config,k,p.unit,unit,k.packSize)}))});
  const setAdr=adrClass=>update({adrClass,...(adrClass?{}:{packingGroup:''})});
  const setters={unit:setUnit,adrClass:setAdr};
  // Where this differs from what it is linked to. These only inform: a figure may differ on purpose.
  const other=links.map(n=>(config?.products??[]).find(x=>x.name===n)).find(x=>x?.unit&&x.unit!==p.unit);
  const months=sheets.find(t=>t.shelfLifeMonths&&t.shelfLifeMonths!==p.shelfLifeMonths);
  const stored=sheets.find(t=>t.storageMin!=null&&(t.storageMin!==p.storageMin||t.storageMax!==p.storageMax));
  const dense=p.unit==='L'&&p.density==null?sheets.find(t=>t.density):null;      // it varies by batch: a guide while blank, not a check
  const hints={
    unit:other&&<FieldNote>{other.name}'s labels are in {other.unit}</FieldNote>,
    shelfLifeMonths:months&&<FieldNote onUse={()=>update({shelfLifeMonths:months.shelfLifeMonths})}>Data sheet: {fmtMonths(months.shelfLifeMonths)}</FieldNote>,
    storageMin:stored&&<FieldNote onUse={()=>update({storageMin:stored.storageMin,storageMax:stored.storageMax})}>Data sheet: {fmtStorage(stored)}</FieldNote>,
    density:dense&&<FieldNote>Data sheet: {dense.density}</FieldNote>,
  };
  const fields=list=>list.filter(([k])=>!(k==='density'&&p.unit==='kg')).map(spec=>(
    <ShipField key={spec[0]} spec={spec} value={p[spec[0]]} set={setters[spec[0]]??(v=>update({[spec[0]]:v}))} disabled={spec[0]==='packingGroup'&&!p.adrClass} hint={hints[spec[0]]}/>
  ));
  return(
    <div className="ship-edit-form scroll-y">
      <div className="card-flat">
        <div className="flex items-center justify-between gap-3">
          <div className="card-title">Product</div>
          <div className="flex gap-2">
            <button className="btn btn-ghost btn-sm" onClick={onDuplicate}>Duplicate</button>
            <button className="btn btn-danger btn-sm" onClick={onDelete}>Delete</button>
          </div>
        </div>
        <div className="ship-form-grid">
          <div className="field wide">
            <span className="field-label">Label products</span>
            <LinkChips values={links} options={labelOptions} isGone={n=>!labelOptions.some(o=>o.value===n)} goneTitle="There is no label product with this name any more" keptTitle="Its Information page shows this profile"
              onChange={setLinks} label="Link a label product" addFirst="Link a label product…" addMore="Link another…"/>
            {!links.length&&<div className="hint">Shipping only: this product doesn't appear anywhere else in the app.</div>}
          </div>
          {fields(SHIP_IDENTITY)}
        </div>
      </div>
      <ShipPacksEditor product={p} draft={draft} config={config} update={update}/>
      <div className="card-flat">
        <div className="card-title">Shipping details</div>
        <div className="ship-form-grid">{fields(SHIP_DETAILS)}</div>
      </div>
      <div className="card-flat">
        <div className="card-title">Data sheets</div>
        <div className="ship-form-grid">
          <div className="field wide">
            <LinkChips values={p.tds??[]} options={sheetOptions} isGone={id=>!sheetOptions.some(o=>o.value===id)} goneTitle="This data sheet has been removed" onChange={setSheets} label="Link a data sheet" addFirst="Link a data sheet…" addMore="Link another…"/>
            {sheets.map(t=><div key={t.id} className="hint ship-sheet-line">{t.name}: {tdsSource(t)} · {fmtMonths(t.shelfLifeMonths)} · {fmtStorage(t)}{t.packaging?` · ${t.packaging}`:''}</div>)}
            {!sheets.length&&<div className="hint">None linked, so nothing here has been checked against a document.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

// A product's packs, one per size. Picking a size fills in what other products of that size use;
// pallet, container and box come from the catalogues, which hold their weights, and the units per
// box come from the label cheat sheet.
function ShipPacksEditor({product:p,draft,config,update}){
  const packs=p.packs??[];
  const pallets=draft.pallets??[],containers=draft.containers??[],boxes=draft.boxes??[];
  const entries=byId(shipEntries({...draft,products:[p]}));
  const setPack=(id,change)=>update({packs:packs.map(k=>k.id===id?{...k,...change}:k)});
  const setSize=(k,size)=>setPack(k.id,refillPack(draft,config,k,p.unit,p.unit,size));
  const setBox=(k,boxId)=>setPack(k.id,{boxId:boxId||null,unitsPerBox:boxId?unitsPerBoxOnSheet(config,k.packSize,p.unit)??usualPack(draft,p.unit,k.packSize,k.id).unitsPerBox??k.unitsPerBox:null});
  const addPack=()=>update({packs:[...packs,blankPack()]});
  // Bags for what is sold by weight, containers for liquids, the other kind after them.
  const kinds=p.unit==='kg'?[['bag','Bags'],['container','Containers']]:[['container','Containers'],['bag','Bags']];
  return(
    <div className="card-flat">
      <div className="flex items-center justify-between gap-3">
        <div className="card-title">Packs</div>
        <button className="btn btn-ghost btn-sm" onClick={addPack}>+ Add pack</button>
      </div>
      {!pallets.length||!containers.length?(
        <div className="hint" style={{marginTop:'var(--space-2)'}}>Add pallets and containers under Pallets &amp; packaging first, then pick them here.</div>
      ):null}
      {packs.length===0?(
        <div className="hint" style={{marginTop:'var(--space-2)'}}>No packs, so this product won't be in the calculator. Add one for each size it ships in.</div>
      ):(
        <div className="table-scroll" style={{marginTop:'var(--space-2)'}}>
          <table className="table dense ship-pack-edit">
            <thead><tr><th>Size</th><th>Pallet holds</th><th>Pallet</th><th>Container or bag</th><th>Box</th><th>Per box</th><th className="num">Full pallet</th><th aria-label="Remove"/></tr></thead>
            <tbody>
              {[...packs].sort((a,b)=>(a.packSize??1e9)-(b.packSize??1e9)).map(k=>{
                const sheet=k.packSize>0?unitsPerBoxOnSheet(config,k.packSize,p.unit):null;
                const pickable=pallets.filter(x=>x.weight>0||x.id===k.palletId);
                const made=containers.filter(x=>k.packSize>0&&x.forSize===k.packSize&&x.kind===containerKind(p.unit));
                const container=containers.find(x=>x.id===k.containerId);
                const count=packsPerPallet(k),boxCount=count!=null&&k.boxId&&k.unitsPerBox>0?count/k.unitsPerBox:null;
                const uneven=(count!=null&&!isWhole(count))||(boxCount!=null&&!isWhole(boxCount));
                return(
                  <tr key={k.id}>
                    <td><div className="input-unit ship-num"><NumInput className={k.packSize>0?'':'invalid'} aria-label="Pack size" value={k.packSize} onChange={v=>setSize(k,v)}/><span>{p.unit}</span></div></td>
                    <td>
                      <div className="input-unit ship-num"><NumInput className={k.palletSize>0?'':'invalid'} aria-label="What a pallet holds" value={k.palletSize} onChange={v=>setPack(k.id,{palletSize:v})}/><span>{p.unit}</span></div>
                      {count!=null&&<div className={'ship-derived'+(uneven?' warn':'')} title={uneven?'A pallet would hold part of a pack or box. Check the size, what a pallet holds, or the units per box.':undefined}>{fmtNum(count,2)} packs{boxCount!=null?` · ${fmtNum(boxCount,2)} boxes`:''}</div>}
                    </td>
                    <td>
                      <select className={'input'+(k.palletId?'':' invalid')} aria-label="Pallet" value={k.palletId??''} onChange={e=>setPack(k.id,{palletId:e.target.value||null})}>
                        <option value="">Choose…</option>
                        {pickable.map(x=><option key={x.id} value={x.id}>{x.name} · {fmtNum(x.weight)} kg</option>)}
                      </select>
                    </td>
                    <td>
                      <select className={'input'+(k.containerId?'':' invalid')} aria-label="Container or bag" value={k.containerId??''} onChange={e=>setPack(k.id,{containerId:e.target.value||null})}>
                        <option value="">Choose…</option>
                        {made.length>0&&<optgroup label={`For ${fmtNum(k.packSize,3)} ${p.unit}`}>{made.map(x=><option key={x.id} value={x.id}>{x.name} · {fmtNum(x.weight,4)} kg</option>)}</optgroup>}
                        {kinds.map(([kind,label])=>{
                          const rest=containers.filter(x=>x.kind===kind&&!made.includes(x));
                          return rest.length?<optgroup key={kind} label={made.length?`Other ${label.toLowerCase()}`:label}>{rest.map(x=><option key={x.id} value={x.id}>{x.name} · {fmtNum(x.weight,4)} kg</option>)}</optgroup>:null;
                        })}
                      </select>
                      {container?.forSize>0&&k.packSize>0&&container.forSize!==k.packSize&&<FieldNote>Made for {fmtNum(container.forSize,3)} {p.unit}</FieldNote>}
                    </td>
                    <td>
                      <select className="input" aria-label="Box" value={k.boxId??''} onChange={e=>setBox(k,e.target.value)}>
                        <option value="">No box</option>
                        {boxes.map(x=><option key={x.id} value={x.id}>{x.name} · {fmtNum(x.weight,4)} kg</option>)}
                      </select>
                      {k.boxId&&k.packSize>0&&noBoxOnSheet(config,k.packSize,p.unit)&&<FieldNote>This size has no box label</FieldNote>}
                    </td>
                    <td>
                      <NumInput className="ship-per-box" aria-label="Units per box" disabled={!k.boxId} value={k.boxId?k.unitsPerBox:null} placeholder={k.boxId?'':'–'} onChange={v=>setPack(k.id,{unitsPerBox:v})}/>
                      {k.boxId&&sheet!=null&&k.unitsPerBox!==sheet&&<div className="ship-sheet" title="The label cheat sheet's figure for this size">sheet: {sheet}</div>}
                    </td>
                    <td className="num" style={{fontWeight:600}}>{fmtNum(shipCalc(entries[k.id],k.palletSize).totalKg)} kg</td>
                    <td><button className="ship-remove" aria-label={`Remove ${k.packSize??'new'} ${p.unit} pack`} onClick={()=>update({packs:packs.filter(x=>x.id!==k.id)})}><Icon.Close size={12}/></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// The data sheets: what the TDS documents say, kept here so they can be read and linked without opening each one.
function ShipSheetsEditor({draft,setDraft,config}){
  const [search,setSearch]=useState('');
  const [selectedId,setSelectedId]=useState(null);
  const rows=draft.tds??[];
  const shown=useMemo(()=>rows.filter(t=>matchesSearch(`${t.name} ${t.code} ${t.file}`,search)).sort((a,b)=>(a.name||'').localeCompare(b.name||'')),[rows,search]);
  const sheet=rows.find(t=>t.id===selectedId);
  const labelOptions=useMemo(()=>(config?.products??[]).map(x=>({value:x.name,label:x.name})).sort((a,b)=>a.label.localeCompare(b.label)),[config]);
  const setRows=next=>setDraft({...draft,tds:next});
  const update=change=>setRows(rows.map(t=>t.id===selectedId?{...t,...change}:t));
  const add=()=>{const fresh=blankSheet();setRows([...rows,fresh]);setSelectedId(fresh.id);setSearch('');};
  const remove=()=>{
    setDraft({...draft,tds:rows.filter(t=>t.id!==selectedId),products:(draft.products??[]).map(p=>p.tds?.includes(selectedId)?{...p,tds:p.tds.filter(id=>id!==selectedId)}:p)});
    setSelectedId(null);
  };
  const usedBy=sheet?(draft.products??[]).filter(p=>p.tds?.includes(sheet.id)):[];
  return(
    <div className="ship-edit">
      <div className="ship-edit-list">
        <div className="search-wrap" style={{flexShrink:0}}>
          <span className="search-icon"><Icon.Search size={14}/></span>
          <input className="input" placeholder="Search..." aria-label="Search data sheets" value={search} onChange={e=>setSearch(e.target.value)}/>
        </div>
        <div className="scroll-y">
          <div className="pick-list">
            {shown.map(t=>(
              <button key={t.id} className={'pick-row'+(t.id===selectedId?' on':'')} onClick={()=>setSelectedId(t.id)}>
                <span className="pick-row-name" title={t.name}>{t.name||<span className="muted">New data sheet</span>}</span>
                <span className="mono muted" style={{fontSize:'var(--fs-2xs)',flexShrink:0}}>{t.shelfLifeMonths?`${t.shelfLifeMonths} mo`:''}</span>
              </button>
            ))}
          </div>
          {shown.length===0&&<div className="muted" style={{fontSize:'var(--fs-sm)',fontStyle:'italic',padding:'var(--space-2) var(--space-1)'}}>No data sheets{search?' match':' yet'}.</div>}
        </div>
        <button className="btn btn-ghost btn-sm" style={{flexShrink:0}} onClick={add}>+ Add data sheet</button>
      </div>
      {!sheet?(
        <div className="muted" style={{flex:1,fontSize:'var(--fs-md)',fontStyle:'italic',paddingTop:'var(--space-2)'}}>
          Select a data sheet to edit it.{draft.tdsReadOn?` These were read from the TDS documents on ${draft.tdsReadOn}; when a document is revised, update its entry here.`:''}
        </div>
      ):(
        <div key={sheet.id} className="ship-edit-form scroll-y">
          <div className="card-flat">
            <div className="flex items-center justify-between gap-3">
              <div className="card-title">Data sheet</div>
              <button className="btn btn-danger btn-sm" onClick={remove}>Delete</button>
            </div>
            <div className="ship-form-grid">
              <div className="field wide">
                <span className="field-label">Label products</span>
                <LinkChips values={sheet.labels??[]} options={labelOptions} isGone={n=>!labelOptions.some(o=>o.value===n)} goneTitle="There is no label product with this name any more" onChange={labels=>update({labels})} label="Link a label product" addFirst="Link a label product…" addMore="Link another…"/>
                <div className="hint">{usedBy.length?`Linked from ${usedBy.map(profileName).join(', ')}.`:'No shipping product links to this yet.'}</div>
              </div>
              {TDS_FIELDS.map(spec=><ShipField key={spec[0]} spec={spec} value={sheet[spec[0]]} set={v=>update({[spec[0]]:v})}/>)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ShipTablesEditor({draft,setDraft}){
  const setCatalogue=(key,rows)=>setDraft({...draft,[key]:rows});
  const setRows=(tid,rows)=>setDraft({...draft,tables:draft.tables.map(t=>t.id===tid?{...t,rows}:t)});
  const cell=(c,r,set)=>c.type==='number'
    ?<NumInput aria-label={c.label} value={r[c.key]??null} onChange={set}/>
    :c.type==='kind'
      ?<select className="input" aria-label={c.label} value={r[c.key]??'container'} onChange={e=>set(e.target.value)}><option value="container">Container</option><option value="bag">Bag</option></select>
      :<input className="input" aria-label={c.label} value={r[c.key]??''} onChange={e=>set(e.target.value)}/>;
  const numClass=c=>c.type==='number'?'num-col':c.type==='kind'?'kind-col':'';
  return(
    <div className="scroll-y">
      <div className="ship-ref-grid wide">
        {SHIP_CATALOGUES.map(cat=>{
          const rows=draft[cat.key]??[];
          const used=catalogueUse(draft,cat.usedBy);
          return(
            <div key={cat.key} className="card-flat">
              <div className="card-title">{cat.title}</div>
              <div className="hint">{cat.hint??'Picked for each pack. Changing a weight here changes every pack using it.'}</div>
              <table className="table ship-table-edit" style={{marginTop:'var(--space-2)'}}>
                <thead><tr>{cat.columns.map(c=><th key={c.key} className={c.type==='number'?'num':''}>{c.label}</th>)}<th/></tr></thead>
                <tbody>
                  {rows.map(r=>(
                    <tr key={r.id}>
                      {cat.columns.map(c=><td key={c.key} className={numClass(c)}>{cell(c,r,v=>setCatalogue(cat.key,rows.map(x=>x.id===r.id?{...x,[c.key]:v}:x)))}</td>)}
                      <td>
                        {used[r.id]
                          ?<span className="mono muted ship-used" title={`Used by ${used[r.id]} pack${used[r.id]===1?'':'s'}, so it can't be removed`}>{used[r.id]}</span>
                          :<button className="ship-remove" aria-label={`Remove ${r.name||'row'}`} onClick={()=>setCatalogue(cat.key,rows.filter(x=>x.id!==r.id))}><Icon.Close size={12}/></button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="btn btn-ghost btn-sm mt-3" onClick={()=>setCatalogue(cat.key,[...rows,{id:newId(cat.key),name:'',weight:null,...(cat.key==='containers'?{kind:'container'}:{})}])}>+ Add row</button>
            </div>
          );
        })}
        {(draft.tables??[]).map(t=>(
          <div key={t.id} className="card-flat">
            <div className="card-title">{t.title}</div>
            {t.note&&<div className="hint">{t.note}</div>}
            <table className="table ship-table-edit" style={{marginTop:'var(--space-2)'}}>
              <thead><tr>{t.columns.map(c=><th key={c.key} className={c.type==='number'?'num':''}>{c.label}</th>)}<th/></tr></thead>
              <tbody>
                {t.rows.map((r,i)=>(
                  <tr key={i}>
                    {t.columns.map(c=><td key={c.key} className={numClass(c)}>{cell(c,r,v=>setRows(t.id,t.rows.map((x,j)=>j===i?{...x,[c.key]:v}:x)))}</td>)}
                    <td><button className="ship-remove" aria-label="Remove row" onClick={()=>setRows(t.id,t.rows.filter((_,j)=>j!==i))}><Icon.Close size={12}/></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="btn btn-ghost btn-sm mt-3" onClick={()=>setRows(t.id,[...t.rows,{}])}>+ Add row</button>
          </div>
        ))}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
