// Etiketas - Label Manager
// React components (JSX transpiled by Babel standalone)
const {useState, useEffect, useCallback, useRef, Fragment} = React;
const PORT = 7842;
const API  = `http://localhost:${PORT}`;

const api = {
  get:  (p)    => fetch(API+p).then(r=>r.json()),
  post: (p, b) => fetch(API+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(r=>r.json()),
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
  getDefaultConfig:()    => api.get('/api/config/default'),
  pickDir:         ()    => api.get('/api/pick_dir'),
  ingest:          (p)   => api.post('/api/ingest', {path:p}),
  listQrCodes:     ()    => api.get('/api/qrcodes'),
  applyQr:         (indd_path, qr_path) => api.post('/api/apply_qr', {indd_path, qr_path}),
  getTemplates:    ()    => api.get('/api/templates'),
  getHistory:      ()    => api.get('/api/history'),
  getColors:       ()    => api.get('/api/colors'),
  saveColors:      (c)   => api.post('/api/colors/save', c),
  getResourceDirs: ()    => api.get('/api/resource_dirs'),
  checkAssets:        ()    => api.get('/api/assets_check'),
  listTranslations:   ()    => api.get('/api/translations'),
};

const scoreLabel = s => s>=75?{label:'Perfect',cls:'score-high'}:s>=50?{label:'Good',cls:'score-med'}:{label:'Fallback',cls:'score-low'};


const Icon = {
  Dashboard:()=><svg className="icon" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="6" height="6" rx="1.5"/><rect x="9" y="1" width="6" height="6" rx="1.5"/><rect x="1" y="9" width="6" height="6" rx="1.5"/><rect x="9" y="9" width="6" height="6" rx="1.5"/></svg>,
  New:()=><svg className="icon" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm1 6h2a1 1 0 010 2H9v2a1 1 0 01-2 0V9H5a1 1 0 010-2h2V5a1 1 0 012 0v2z"/></svg>,
  Browse:()=><svg className="icon" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3a1 1 0 011-1h3.586A1 1 0 017 2.293L7.707 3H13a1 1 0 011 1v8a1 1 0 01-1 1H3a1 1 0 01-1-1V3z"/></svg>,
  Settings:()=><svg className="icon" viewBox="0 0 16 16" fill="currentColor"><path d="M8 4.754a3.246 3.246 0 100 6.492 3.246 3.246 0 000-6.492zM5.754 8a2.246 2.246 0 114.492 0 2.246 2.246 0 01-4.492 0z"/><path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 01-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 01-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 01.52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 011.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 011.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 01.52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 01-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 01-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 002.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 001.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 00-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 00-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 00-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 003.06 8.858l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 004.175 4.4l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 002.692-1.115l.094-.319z"/></svg>,
  Refresh:()=><svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13"><path d="M13.6 2.4A7 7 0 102 8H1a7 7 0 013-5.8V1l3 2.5L4 6V4.5A5 5 0 108 3l-.8.1A5 5 0 0113 8a5 5 0 01-5 5 5 5 0 01-4.7-3.3L1.5 10A7 7 0 008 15a7 7 0 005.6-11.2l.5-1.4z"/></svg>,
  Open:()=><svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13"><path d="M9 2H3a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1V7l-5-5zM3 13V3h5v4h4v6H3z"/></svg>,
  Folder:()=><svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13"><path d="M2 3a1 1 0 011-1h3.586L8 3.414 8.707 3H13a1 1 0 011 1v8a1 1 0 01-1 1H3a1 1 0 01-1-1V3zm5.293 1H5V3H3v9h10V5H7.293z"/></svg>,
  Check:()=><svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M13.3 3.3a1 1 0 00-1.4 0L6 9.2 4.1 7.3a1 1 0 00-1.4 1.4l2.6 2.6a1 1 0 001.4 0l6.6-6.6a1 1 0 000-1.4z"/></svg>,
  Resources:()=><svg className="icon" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.2 0-1.1.9-2 2-2h2a3 3 0 000-6A7 7 0 008 1zM5 8a1 1 0 110-2 1 1 0 010 2zm0-3a1 1 0 110-2 1 1 0 010 2zm3-2a1 1 0 110-2 1 1 0 010 2zm3 2a1 1 0 110-2 1 1 0 010 2z"/></svg>,
  Info:()=><svg className="icon" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 2a5 5 0 110 10A5 5 0 018 3zM7.25 6.5h1.5v1h-1.5v-1zm0 2h1.5v3.5h-1.5V8.5z"/></svg>,
  Trash:()=><svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13"><path d="M6 2a1 1 0 00-1 1H3.5a.5.5 0 000 1H4v8a1 1 0 001 1h6a1 1 0 001-1V4h.5a.5.5 0 000-1H11a1 1 0 00-1-1H6zm0 1h4v1H6V3zM5 5h6v7H5V5zm1.5 1a.5.5 0 00-.5.5v4a.5.5 0 001 0v-4a.5.5 0 00-.5-.5zm3 0a.5.5 0 00-.5.5v4a.5.5 0 001 0v-4a.5.5 0 00-.5-.5z"/></svg>,
};

function FileActions({path, onDeleted}){
  const handleDelete=async()=>{
    if(!window.confirm('Do you REALLY want to delete this file?\n\nIt will be moved to the Recycle Bin.'))return;
    const r=await api.trashFile(path);
    if(r.ok){if(onDeleted)onDeleted(path);}
    else alert('Could not delete file:\n'+(r.error||'Unknown error'));
  };
  return(
    <div className="file-actions">
      <button className="btn btn-ghost btn-indesign btn-sm" title="Open file" onClick={()=>api.openFile(path)}><Icon.Open/></button>
      <button className="btn btn-folder btn-sm" title="Show in Explorer" onClick={()=>api.revealFile(path)}><Icon.Folder/></button>
      <button className="btn btn-sm" title="Move to Recycle Bin" style={{background:'rgba(255,77,109,.08)',color:'var(--danger)',border:'1px solid rgba(255,77,109,.2)'}} onClick={handleDelete}><Icon.Trash/></button>
    </div>
  );
}

function App(){
  const [view,setView]=useState('dashboard');
  const [config,setConfig]=useState(null);
  const [map,setMap]=useState(null);
  const [loading,setLoading]=useState(true);
  const [lightMode,setLightMode]=useState(()=>localStorage.getItem('etiketas-theme')==='light');
  const toggleTheme=()=>setLightMode(v=>{
    const next=!v;
    document.documentElement.setAttribute('data-theme',next?'light':'dark');
    if(!next)document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('etiketas-theme',next?'light':'dark');
    return next;
  });
  useEffect(()=>{
    Promise.all([api.loadConfig(),api.loadMap()]).then(([cfg,m])=>{setConfig(cfg);setMap(m);setLoading(false);});
  },[]);
  const saveConfig=useCallback(async cfg=>{await api.saveConfig(cfg);setConfig(cfg);},[]);
  const refreshMap=useCallback(async()=>{const m=await api.scanLabels();setMap(m);},[]);
  if(loading)return(
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',flexDirection:'column',gap:20}}>
      <img src="/Nando-white.png" alt="Etiketas" style={{height:52,opacity:.7}}/>
      <div className="spinner" style={{width:28,height:28,marginTop:4}}/>
      <span style={{color:'var(--text2)',fontSize:13,fontFamily:"'DM Mono',monospace"}}>Loading Etiketas...</span>
    </div>
  );
  return(
    <div className="app">
      <Sidebar view={view} setView={setView} map={map} refreshMap={refreshMap}/>
      <div className="main">
        <Topbar view={view} map={map}/>
        <div className={`content${['resources','settings','information','dashboard'].includes(view)?' no-scroll':''}`}>
          <div key={view} className="view-anim" style={{height:'100%'}}>
            {view==='dashboard'&&<Dashboard map={map} setMap={setMap} config={config} setView={setView} refreshMap={refreshMap}/>}
            {view==='new'&&<NewLabelWizard config={config} map={map} setMap={setMap}/>}
            {view==='browse'&&<LabelsBrowser map={map} setMap={setMap} config={config}/>}
            {view==='settings'&&<Settings config={config} saveConfig={saveConfig} setConfig={setConfig} refreshMap={refreshMap} lightMode={lightMode} toggleTheme={toggleTheme}/>}
            {view==='resources'&&<Resources config={config} saveConfig={saveConfig}/>}
            {view==='information'&&<Information config={config} map={map} setMap={setMap}/>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Sidebar({view,setView,map,refreshMap}){
  const total=map?.files?.length??0, wip=map?.files?.filter(f=>f.wip).length??0;
  return(
    <div className="sidebar">
      <div className="sidebar-logo">
        <img src="/Nando-white.png" alt="Nando" className="sidebar-logo-img"/>
        <div>
          <div className="sidebar-logo-text">Etiketas</div>
          <div className="sidebar-logo-sub">Nando Bio</div>
        </div>
      </div>
      <nav className="sidebar-nav">
        {[{id:'dashboard',label:'Dashboard',I:Icon.Dashboard},
          {id:'new',label:'New Label',I:Icon.New},
          {id:'browse',label:'Browse Files',I:Icon.Browse},
          {id:'information',label:'Information',I:Icon.Info},
          {id:'settings',label:'Settings',I:Icon.Settings},
          {id:'resources',label:'Resources',I:Icon.Resources}
        ].map(({id,label,I})=>(
          <button key={id} className={`nav-item ${view===id?'active':''}`} onClick={()=>setView(id)}>
            <I/>{label}
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div style={{fontSize:11,color:'var(--text3)',fontFamily:"'DM Mono',monospace",marginBottom:8}}>
          {total} files &middot; {wip} WIP
        </div>
        <button className="btn btn-ghost btn-sm w-full" onClick={refreshMap}>
          <Icon.Refresh/>Rescan
        </button>
      </div>
    </div>
  );
}

function Topbar({view,map}){
  const titles={dashboard:'Dashboard',new:'New Label',browse:'Browse',settings:'Settings',resources:'Resources',information:'Information'};
  return(
    <div className="topbar">
      <span className="topbar-title">{titles[view]}</span>
      {map?.generated&&(
        <span style={{fontSize:11,color:'var(--text3)',fontFamily:"'DM Mono',monospace"}}>
          Updated {new Date(map.generated).toLocaleString()}
        </span>
      )}
    </div>
  );
}

function Dashboard({map,setMap,config,setView,refreshMap}){
  const removeFile=p=>setMap(m=>({...m,files:(m?.files??[]).filter(f=>f.path!==p)}));
  const [ingesting,setIngesting]=useState(false);
  const [ingestResult,setIngestResult]=useState(null);
  const [templates,setTemplates]=useState([]);
  const [history,setHistory]=useState([]);
  useEffect(()=>{
    api.getTemplates().then(r=>setTemplates(r.templates??[])).catch(()=>{});
    api.getHistory().then(r=>setHistory(r.history??[])).catch(()=>{});
  },[]);
  const files=map?.files??[];
  const total=files.length, indd=files.filter(f=>f.extension==='.indd').length;
  const wip=files.filter(f=>f.wip).length, unsorted=files.filter(f=>!f.sorted).length;
  const handleReadFiles=async()=>{
    const pick=await api.pickDir();
    if(!pick.ok||!pick.path)return;
    setIngesting(true); setIngestResult(null);
    const res=await api.ingest(pick.path);
    setIngestResult(res);
    if(res.ok&&res.copied>0)await refreshMap();
    setIngesting(false);
  };
  const grouped={};
  for(const t of templates){const c=t.category||'Other';if(!grouped[c])grouped[c]=[];grouped[c].push(t);}
  const catColors={'MO':'var(--mo)','PAM':'var(--pam)','CE':'var(--accent)'};
  const fmtTime=ts=>{if(!ts)return'';try{const d=new Date(ts);return d.toLocaleDateString(undefined,{month:'short',day:'numeric'})+' '+d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});}catch(e){return ts.slice(0,16).replace('T',' ');}};
  return(
    <div style={{display:'flex',flexDirection:'column',height:'100%',minHeight:0}}>
      <div style={{flexShrink:0}}>
        <div className="stats-grid" style={{marginBottom:12}}>
          {[
            {label:'Total files',value:total,color:null},
            {label:'InDesign',value:indd,color:'#E040A0'},
            {label:'WIP labels',value:wip,color:'#00DCC8'},
            {label:'Unsorted',value:unsorted,color:'var(--danger)'},
            {label:'Templates',value:templates.length,color:'var(--accent)'},
          ].map(({label,value,color})=>(
            <div key={label} className="stat-card">
              <div className="stat-value" style={color?{color}:{}}>{value}</div>
              <div className="stat-label">{label}</div>
            </div>
          ))}
        </div>
        <div className="flex gap-3" style={{alignItems:'center',flexWrap:'wrap',marginBottom:12}}>
          <button className="btn btn-primary" onClick={handleReadFiles} disabled={ingesting}>
            {ingesting?<><div className="spinner" style={{width:14,height:14}}/>Reading files...</>:'Read files from folder'}
          </button>
          <button className="btn btn-ghost" onClick={()=>setView('new')}>+ New Label</button>
          {ingestResult&&(
            <span style={{fontSize:13,color:ingestResult.ok?'var(--success)':'var(--danger)'}}>
              {ingestResult.ok
                ?`${ingestResult.copied} file(s) copied, ${ingestResult.skipped} already existed${ingestResult.errors?` (${ingestResult.errors} errors)`:''}`
                :ingestResult.error}
            </span>
          )}
        </div>
      </div>
      <div style={{display:'flex',gap:14,flex:1,minHeight:0}}>
        <div style={{flex:'0 0 55%',display:'flex',flexDirection:'column',minWidth:0}}>
          <p className="section-title" style={{flexShrink:0,marginBottom:6}}>Creation History</p>
          <div className="card" style={{flex:1,overflowY:'auto',padding:0,minHeight:0}}>
            {history.length===0?(
              <div style={{padding:'32px 16px',textAlign:'center',color:'var(--text3)',fontSize:13}}>No labels created yet</div>
            ):(
              <table className="files-table">
                <thead><tr><th>Time</th><th>Product</th><th>Size</th><th>Languages</th><th>Files</th></tr></thead>
                <tbody>
                  {history.map((h,i)=>(
                    <tr key={i}>
                      <td style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:'var(--text3)',whiteSpace:'nowrap'}}>{fmtTime(h.timestamp)}</td>
                      <td style={{fontWeight:500}}>{h.product}</td>
                      <td style={{fontFamily:"'DM Mono',monospace",fontSize:12}}>{h.packagingSize}</td>
                      <td style={{fontFamily:"'DM Mono',monospace",fontSize:11}}>{(h.languages??[]).join(' · ')}</td>
                      <td>
                        <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                          {(h.files??[]).map((f,j)=>(
                            <button key={j} className="btn btn-sm" title={f.filename}
                              style={{padding:'2px 7px',fontSize:11,background:'rgba(255,255,255,.05)',border:'1px solid var(--border2)',color:'var(--text2)'}}
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
        <div style={{flex:'0 0 calc(45% - 14px)',display:'flex',flexDirection:'column',minWidth:0}}>
          <p className="section-title" style={{flexShrink:0,marginBottom:6}}>Available Templates</p>
          <div className="card" style={{flex:1,overflowY:'auto',padding:0,minHeight:0}}>
            {templates.length===0?(
              <div style={{padding:'32px 16px',textAlign:'center',color:'var(--text3)',fontSize:13}}>No templates found</div>
            ):(
              Object.entries(grouped).sort().map(([cat,tmplList])=>(
                <div key={cat}>
                  <div style={{padding:'7px 14px 4px',fontSize:11,fontWeight:700,letterSpacing:'0.06em',textTransform:'uppercase',color:catColors[cat]??'var(--text3)',borderBottom:'1px solid var(--border2)',background:'rgba(255,255,255,.02)',position:'sticky',top:0}}>
                    {cat} <span style={{fontWeight:400,opacity:.6}}>({tmplList.length})</span>
                  </div>
                  {tmplList.map((t,i)=>(
                    <div key={i} style={{display:'flex',alignItems:'center',gap:8,padding:'5px 14px',borderBottom:'1px solid rgba(255,255,255,.04)',fontSize:12}}>
                      <span style={{flex:1,fontFamily:"'DM Mono',monospace",fontSize:11,color:'var(--text2)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={t.filename}>{t.filename.replace(/\.idml$/i,'')}</span>
                      <span style={{flexShrink:0,fontSize:10,fontFamily:"'DM Mono',monospace",color:'var(--text3)'}}>{t.dimensions}</span>
                      {t.deze?<span className="topbar-badge badge-pam" style={{fontSize:9}}>Box</span>:<span className="topbar-badge badge-ok" style={{fontSize:9}}>Label</span>}
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
  );
}

function NewLabelWizard({config,map,setMap}){
  const removeFile=p=>setMap(m=>({...m,files:(m?.files??[]).filter(f=>f.path!==p)}));
  const [step,setStep]=useState(1);
  const [product,setProduct]=useState(null);
  const [languages,setLanguages]=useState([]);
  const [size,setSize]=useState(null);
  const [tmplInfo,setTmplInfo]=useState(null);
  const [loading,setLoading]=useState(false);
  const [result,setResult]=useState(null);
  const [search,setSearch]=useState('');
  const [selectedLabel,setSelectedLabel]=useState(0);
  const [selectedBox,setSelectedBox]=useState(0);
  const [reviewTab,setReviewTab]=useState('template');
  const [langFiles,setLangFiles]=useState([]);
  const [transFiles,setTransFiles]=useState([]);
  const [sku,setSku]=useState('');
  const [ufi,setUfi]=useState('');
  const enabledProducts=(config?.products??[]).filter(p=>p.enabled).sort((a,b)=>a.name.localeCompare(b.name));
  const enabledLangs=(config?.languages??[]).filter(l=>l.enabled);
  const productCfg=product?config.products.find(p=>p.name===product):null;
  const dimKey=productCfg?(()=>{const{category,acidic,unit}=productCfg;const u=unit||(category==='PAM'?'L':'kg');if(category==='PAM')return acidic?'PAM_acidic':'PAM_normal';if(category==='CE')return u==='kg'?'CE_solid':'CE';return u==='L'?'MO_liquid':'MO';})():null;
  const sizes=dimKey?(config?.packagingSizes?.[dimKey]??[]):[];
  const filtered=enabledProducts.filter(p=>p.name.toLowerCase().includes(search.toLowerCase()));
  useEffect(()=>{setLangFiles(languages.map(()=>null));},[languages.length]);
  useEffect(()=>{
    if(step===3&&transFiles.length===0)
      api.listTranslations().then(r=>{if(r?.files)setTransFiles(r.files);});
    if(step!==5||!product||!languages.length||!size)return;
    setLoading(true);setSelectedLabel(0);setSelectedBox(0);
    api.findTemplate({product,languages,packagingSize:size}).then(info=>{setTmplInfo(info);setLoading(false);});
  },[step]);
  const reset=()=>{setStep(1);setProduct(null);setLanguages([]);setSize(null);setTmplInfo(null);setResult(null);setSearch('');setSelectedLabel(0);setSelectedBox(0);setReviewTab('template');setLangFiles([]);setTransFiles([]);setSku('');setUfi('');};
  const toggleLang=code=>setLanguages(prev=>prev.includes(code)?prev.filter(c=>c!==code):prev.length<3?[...prev,code]:prev);
  const handleCreate=async()=>{
    setLoading(true);
    const cfg=await api.loadConfig();
    const skipLabel=selectedLabel===null;
    const skipBox=selectedBox===null;
    const labelPath=skipLabel?null:(tmplInfo?.labels?.[selectedLabel]?.file?.path??null);
    const boxPath=skipBox?null:(tmplInfo?.boxes?.[selectedBox]?.file?.path??null);
    const isPAM=productCfg?.category==='PAM';
    const footerValues=(sku||ufi)?{sku,ufi:isPAM?ufi:'',manufacturer_value:''}:null;
    const res=await api.createLabel({product,languages,packagingSize:size,config:cfg,labelTemplatePath:labelPath,boxTemplatePath:boxPath,langFiles,footerValues,skipLabel,skipBox});
    if(res.success&&res.results?.length){const m=await api.loadMap();setMap(m);}
    setResult(res);setLoading(false);setStep(6);
  };
  const now=new Date(),dateStr=now.getFullYear()+'_'+String(now.getMonth()+1).padStart(2,'0');
  const boxMult=size?(config?.boxMultipliers?.[size]??size):'';
  const dims=tmplInfo?.dimensions??'?x?';
  const langStr=languages.join('_');
  const prevLabel=product&&size&&languages.length?product+'_'+size+'_'+langStr+'_'+dims+'_'+dateStr+'_WIP.indd':'--';
  const prevBox=product&&size&&languages.length?product+'_'+boxMult+'_'+langStr+'_180x180_'+dateStr+'_deze_WIP.indd':'--';
  const relatedFiles=(map?.files??[]).filter(f=>
    f.product===product&&f.extension==='.indd'&&!f.wip&&
    f.languages&&languages.some(l=>f.languages.includes(l))
  );
  const reasonBadge=(r,i)=>{
    const s=r.type==='match'?{background:'rgba(108,181,113,.15)',color:'var(--success)'}
      :r.type==='warn'?{background:'rgba(255,179,64,.15)',color:'var(--warning)'}
      :{background:'rgba(255,255,255,.06)',color:'var(--text3)'};
    return <span key={i} style={{...s,fontSize:10,padding:'1px 6px',borderRadius:3,fontFamily:"'DM Mono',monospace",whiteSpace:'nowrap'}}>{r.text}</span>;
  };
  const TemplatePicker=({items,selected,onSelect,title,newName,skipped})=>(
    <div style={{marginBottom:14,opacity:skipped?.5:1,transition:'opacity .2s'}}>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
        <div style={{fontSize:11,fontWeight:500,color:'var(--text2)',textTransform:'uppercase',letterSpacing:'.06em'}}>{title}</div>
        {skipped&&<span style={{fontSize:10,fontFamily:"'DM Mono',monospace",padding:'1px 7px',borderRadius:10,background:'rgba(255,179,64,.15)',color:'var(--warning)',border:'1px solid rgba(255,179,64,.3)'}}>skipped</span>}
      </div>
      {items&&items.length>0?(
        items.map((item,idx)=>(
          <div key={idx} onClick={()=>onSelect(selected===idx?null:idx)} style={{background:selected===idx?'var(--accent-dim)':'var(--surface2)',border:'1px solid '+(selected===idx?'var(--accent)':'var(--border2)'),borderRadius:'var(--radius-sm)',padding:'10px 12px',marginBottom:6,cursor:'pointer',transition:'all .15s'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:selected===idx?'var(--accent)':'var(--text2)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1,marginRight:8}}>{item.file.filename}</span>
              <span className={'match-score '+scoreLabel(item.score).cls}>{scoreLabel(item.score).label} ({item.score}pts)</span>
            </div>
            <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
              {(item.reasons||[]).map((r,i)=>reasonBadge(r,i))}
            </div>
          </div>
        ))
      ):(
        <div style={{fontSize:12,color:'var(--text3)',fontStyle:'italic',padding:'8px 0'}}>No template found -- empty file will be created</div>
      )}
      {!skipped&&<div style={{fontSize:11,color:'var(--text3)',marginTop:6}}>Will be saved as: <span style={{fontFamily:"'DM Mono',monospace",color:'var(--accent)'}}>{newName}</span></div>}
    </div>
  );
  return(
    <div style={{display:'flex',flexDirection:'column',height:'100%',overflow:'hidden',maxWidth:720}}>
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
        <div style={{display:'flex',flexDirection:'column',flex:1,overflow:'hidden'}}>
          <div className="field" style={{flexShrink:0}}>
            <div className="search-wrap">
              <span className="search-icon">&#128269;</span>
              <input className="input" placeholder="Search products..." value={search} onChange={e=>setSearch(e.target.value)} autoFocus/>
            </div>
          </div>
          <div className="product-grid" style={{flex:1,maxHeight:'none',overflowY:'auto',paddingRight:4}}>
            {filtered.map(p=>(
              <button key={p.name} className={'product-card '+(product===p.name?'selected':'')}
                onClick={()=>setProduct(p.name)}
                onDoubleClick={()=>{setProduct(p.name);setStep(2);}}>
                <div className="product-name">{p.name}</div>
                <div style={{display:'flex',gap:6,marginTop:4}}>
                  <span style={{padding:'1px 7px',borderRadius:3,fontSize:10,fontFamily:"'DM Mono',monospace",background:p.category==='PAM'?'rgba(255,159,71,.15)':p.category==='CE'?'rgba(80,200,140,.15)':'rgba(75,191,255,.15)',color:p.category==='PAM'?'var(--pam)':p.category==='CE'?'#3dbf7a':'var(--mo)'}}>{p.category}</span>
                  {p.acidic&&<span className="acidic-badge">acidic</span>}
                </div>
              </button>
            ))}
          </div>
          <div className="flex mt-4" style={{flexShrink:0}}><button className="btn btn-primary ml-auto" disabled={!product} onClick={()=>setStep(2)}>Next &rarr;</button></div>

        </div>
      )}
      {step===2&&(
        <div style={{display:'flex',flexDirection:'column',flex:1,overflow:'hidden'}}>
          <div style={{flexShrink:0,marginBottom:12}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
              <span style={{fontSize:13,color:'var(--text2)'}}>Select up to 3 languages</span>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:13,color:languages.length>0?'var(--accent)':'var(--text3)'}}>{languages.length}/3</span>
            </div>
            <div style={{height:30,display:'flex',gap:6,alignItems:'center'}}>
              {languages.length===0
                ?<span style={{fontSize:12,color:'var(--text3)',fontStyle:'italic'}}>No languages selected yet</span>
                :languages.map(code=>{
                  const l=enabledLangs.find(x=>x.code===code);
                  return(
                    <span key={code} onClick={()=>toggleLang(code)} style={{background:'var(--accent-dim)',border:'1px solid var(--accent)',borderRadius:4,padding:'3px 10px',fontSize:12,fontFamily:"'DM Mono',monospace",color:'var(--accent)',cursor:'pointer',display:'inline-flex',alignItems:'center',gap:5}}>
                      {l?.flag} {code} <span style={{opacity:.5}}>×</span>
                    </span>
                  );
                })
              }
            </div>
          </div>
          <div className="lang-grid" style={{flex:1,maxHeight:'none',overflowY:'auto'}}>
            {enabledLangs.map(l=>{
              const sel=languages.includes(l.code),dis=!sel&&languages.length>=3;
              return(
                <div key={l.code} className={'lang-card '+(sel?'selected':'')+(dis?' disabled':'')}
                  onClick={e=>{if(e.detail===1&&!dis)toggleLang(l.code);}}
                  onDoubleClick={()=>{
                    if(dis)return;
                    const next=languages.includes(l.code)?languages:languages.length<3?[...languages,l.code]:languages;
                    if(next.length>0){setLanguages(next);setStep(3);}
                  }}>
                  <span className="lang-flag">{l.flag}</span>
                  <div><div className="lang-code">{l.code}</div><div className="lang-name">{l.name}</div></div>
                  {sel&&<Icon.Check/>}
                </div>
              );
            })}
          </div>
          <div className="flex mt-4 gap-2" style={{flexShrink:0}}>
            <button className="btn btn-ghost" onClick={()=>setStep(1)}>&larr; Back</button>
            <button className="btn btn-primary ml-auto" disabled={languages.length===0} onClick={()=>setStep(3)}>Next &rarr;</button>

          </div>
        </div>
      )}
      {step===3&&(
        <div style={{display:'flex',flexDirection:'column',flex:1,overflow:'hidden'}}>
          <div style={{flexShrink:0,marginBottom:14,fontSize:13,color:'var(--text2)'}}>
            Optionally assign a translation file to each language slot. Leave blank to keep the template text.
          </div>
          <div style={{flex:1,overflowY:'auto',paddingRight:4}}>
            {languages.map((code,i)=>{
              const l=enabledLangs.find(x=>x.code===code);
              return(
                <div key={code} style={{marginBottom:10,background:'var(--surface2)',border:'1px solid var(--border2)',borderRadius:'var(--radius-sm)',padding:'12px 14px'}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
                    <span style={{fontSize:20}}>{l?.flag}</span>
                    <span style={{fontWeight:500,color:'var(--text)'}}>{l?.name??code}</span>
                    <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:'var(--text3)',background:'var(--surface3)',padding:'2px 6px',borderRadius:3}}>{code}</span>
                    <span style={{fontSize:11,color:'var(--text3)',marginLeft:'auto'}}>Slot LANG{i+1}</span>
                  </div>
                  <select
                    style={{width:'100%',background:'var(--surface3)',border:'1px solid var(--border2)',borderRadius:'var(--radius-sm)',color:langFiles[i]?'var(--text)':'var(--text3)',padding:'7px 10px',fontSize:12,cursor:'pointer'}}
                    value={langFiles[i]??''}
                    onChange={e=>{const v=e.target.value||null;setLangFiles(prev=>{const n=[...prev];n[i]=v;return n;})}}>
                    <option value=''>— Skip (keep template text) —</option>
                    {transFiles.map(f=>(
                      <option key={f.path} value={f.path}>{f.flag} {f.name} ({f.code}){f.product?` — ${f.product}`:''}</option>
                    ))}
                  </select>
                  {(()=>{const sel=transFiles.find(f=>f.path===langFiles[i]);return sel?.product&&sel.product!==product?(<div style={{marginTop:6,fontSize:11,color:'#f5a623',display:'flex',alignItems:'center',gap:5}}><span>⚠</span><span>This file is for <strong>{sel.product}</strong>, not <strong>{product}</strong>. The text may not match.</span></div>):null;})()}
                </div>
              );
            })}
            {transFiles.length===0&&(
              <div style={{fontSize:12,color:'var(--text3)',fontStyle:'italic',padding:'8px 0'}}>No translation files found in translations/ folder.</div>
            )}
            {/* Label footer details */}
            <div style={{marginTop:16,borderTop:'1px solid var(--border2)',paddingTop:14}}>
              <div style={{fontSize:11,fontWeight:500,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:10}}>
                Label details <span style={{fontSize:10,fontWeight:400,textTransform:'none',letterSpacing:0,color:'var(--text3)'}}>— optional, written to FOOTER_* stories</span>
              </div>
              <div style={{display:'grid',gridTemplateColumns:productCfg?.category==='PAM'?'1fr 1fr':'1fr',gap:10}}>
                <div>
                  <div style={{fontSize:11,color:'var(--text2)',marginBottom:4}}>SKU code</div>
                  <input className="input" type="text" value={sku} onChange={e=>setSku(e.target.value)} placeholder="e.g. FNS-1L-001" style={{width:'100%',boxSizing:'border-box'}}/>
                </div>
                {productCfg?.category==='PAM'&&(
                  <div>
                    <div style={{fontSize:11,color:'var(--text2)',marginBottom:4}}>UFI code</div>
                    <input className="input" type="text" value={ufi} onChange={e=>setUfi(e.target.value)} placeholder="e.g. XXXX-XXXX-XXXX-XXXX" style={{width:'100%',boxSizing:'border-box'}}/>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div style={{flexShrink:0}}>
            <div style={{minHeight:22,display:'flex',alignItems:'center',marginBottom:6}}>
              {(()=>{const missing=[...(!sku?['SKU']:[]),...(productCfg?.category==='PAM'&&!ufi?['UFI']:[])];return missing.length>0&&<span style={{fontSize:11,color:'var(--warn,#d97706)'}}>&#9888; No {missing.join(' or ')} provided</span>;})()}
            </div>
            <div className="flex gap-2">
              <button className="btn btn-ghost" onClick={()=>setStep(2)}>&larr; Back</button>
              <button className="btn btn-primary ml-auto" onClick={()=>setStep(4)}>Next &rarr;</button>
            </div>
          </div>
        </div>
      )}
      {step===4&&(
        <div style={{display:'flex',flexDirection:'column',flex:1,overflow:'hidden'}}>
          <div style={{flexShrink:0,marginBottom:12,fontSize:13,color:'var(--text2)'}}>
            {productCfg?.category==='PAM'?'PAM (Adjuvant)':productCfg?.category==='CE'?'CE (Crop Enhancement)':'MO (Biostimulant)'}
            {productCfg?.acidic&&<span className="acidic-badge" style={{marginLeft:8}}>acidic sizing</span>}
          </div>
          <div className="size-grid" style={{flexShrink:0}}>
            {sizes.map(s=>{
              const d=config?.dimensions?.[dimKey]?.[s];
              return(
                <div key={s} className={'size-card '+(size===s?'selected':'')}
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
        <div style={{display:'flex',flexDirection:'column',flex:1,overflow:'hidden'}}>
          <div style={{flexShrink:0}}>
            <div className="review-row"><span className="review-label">Product</span><span className="review-value" style={{fontWeight:500}}>{product}</span></div>
            <div className="review-row"><span className="review-label">Languages</span><span className="review-value" style={{fontFamily:"'DM Mono',monospace"}}>{languages.map(c=>{const l=enabledLangs.find(x=>x.code===c);return (l?.flag??'')+' '+c;}).join('  .  ')}</span></div>
            <div className="review-row"><span className="review-label">Size</span><span className="review-value">{size} <span style={{color:'var(--text3)',fontFamily:"'DM Mono',monospace",fontSize:11}}>{tmplInfo?.dimensions}</span></span></div>
            <div className="divider" style={{margin:'12px 0'}}/>
            <div style={{display:'flex',gap:2,marginBottom:12,background:'var(--surface2)',borderRadius:'var(--radius-sm)',padding:3,border:'1px solid var(--border)',width:'fit-content'}}>
              {['template','related'].map(t=>(
                <button key={t} onClick={()=>setReviewTab(t)} style={{padding:'5px 16px',borderRadius:5,cursor:'pointer',fontSize:12,fontWeight:500,border:'none',background:reviewTab===t?'var(--surface3)':'transparent',color:reviewTab===t?'var(--text)':'var(--text2)',transition:'all .15s'}}>
                  {t==='template'?'Template':'Related'+(relatedFiles.length?' ('+relatedFiles.length+')':'')}
                </button>
              ))}
            </div>
          </div>
          <div style={{flex:1,overflowY:'auto',paddingRight:4}}>
            {loading?(
              <div className="flex items-center gap-3" style={{padding:'20px 0'}}>
                <div className="spinner"/><span style={{color:'var(--text2)'}}>Finding best templates...</span>
              </div>
            ):reviewTab==='template'?(
              <>
                <TemplatePicker items={tmplInfo?.labels} selected={selectedLabel} onSelect={setSelectedLabel} title="Packaging Label Template" newName={prevLabel} skipped={selectedLabel===null}/>
                <TemplatePicker items={tmplInfo?.boxes} selected={selectedBox} onSelect={setSelectedBox} title="Box Label Template" newName={prevBox} skipped={selectedBox===null}/>
                {(selectedLabel===null)!==(selectedBox===null)&&(
                  <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',borderRadius:'var(--radius-sm)',background:'rgba(255,179,64,.1)',border:'1px solid rgba(255,179,64,.25)',fontSize:12,color:'var(--warning)',marginTop:4}}>
                    <span style={{fontSize:14}}>⚠</span>
                    {selectedLabel===null?'Only the box label will be created — packaging label is skipped.':'Only the packaging label will be created — box label is skipped.'}
                  </div>
                )}
              </>
            ):(
              relatedFiles.length===0?(
                <div style={{color:'var(--text3)',fontSize:13,fontStyle:'italic',padding:'16px 0'}}>No related labels found for {product} with selected languages.</div>
              ):(
                <div className="card" style={{padding:0,overflow:'hidden'}}>
                  <table className="files-table">
                    <thead><tr><th>Filename</th><th>Languages</th><th>Size</th><th>Date</th><th></th></tr></thead>
                    <tbody>
                      {relatedFiles.map(f=>(
                        <tr key={f.filename+f.path}>
                          <td className="path-cell" title={f.path}>{f.filename}</td>
                          <td style={{fontFamily:"'DM Mono',monospace",fontSize:12}}>{f.languages?.join(' . ')??'--'}</td>
                          <td style={{fontFamily:"'DM Mono',monospace",fontSize:12}}>{f.packaging??'--'}</td>
                          <td style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:'var(--text3)'}}>{f.date??'--'}</td>
                          <td><FileActions path={f.path} onDeleted={removeFile}/></td>
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
                      const code=languages[i];
                      const l=config?.languages?.find(x=>x.code===code);
                      return {key:`lang${i+1}`,label:`${l?.flag??''} ${code??''}`,val};
                    }).filter(Boolean);
                  const opRows=[
                    {key:'colors', label:'Color swatches', val:ops.colors},
                    ...(!isBox?[{key:'qr', label:'QR code', val:ops.qr}]:[]),
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
                          <button className="btn btn-ghost btn-sm" style={{color:'#E040A0',borderColor:'rgba(224,64,160,.3)'}} onClick={()=>api.openFile(r.path)}>Open</button>
                          <button className="btn btn-folder btn-sm" onClick={()=>api.revealFile(r.path)}>Reveal</button>
                        </div>
                      </div>
                      <div style={{display:'flex',gap:8,flexWrap:'wrap',paddingLeft:30}}>
                        {opRows.map(({key,label,val})=>{
                          const ok=val===true;
                          const na=val===null||val===undefined;
                          return(
                            <span key={key} style={{
                              display:'inline-flex',alignItems:'center',gap:4,
                              fontSize:11,fontFamily:"'DM Mono',monospace",
                              padding:'2px 8px',borderRadius:10,
                              background:na?'rgba(255,255,255,.04)':ok?'rgba(108,181,113,.13)':'rgba(255,77,109,.13)',
                              color:na?'var(--text3)':ok?'var(--success)':'var(--danger)',
                              border:'1px solid '+(na?'var(--border2)':ok?'rgba(108,181,113,.3)':'rgba(255,77,109,.3)'),
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
function Information({config,map,setMap}){
  const removeFile=p=>setMap(m=>({...m,files:(m?.files??[]).filter(f=>f.path!==p)}));
  const [selected,setSelected]=useState(null);
  const [search,setSearch]=useState('');
  const [colors,setColors]=useState({});
  const [transFiles,setTransFiles]=useState([]);
  const [assets,setAssets]=useState({});
  const [fileType,setFileType]=useState('all');
  const [showWip,setShowWip]=useState('all');
  const [catFilter,setCatFilter]=useState('all');
  const [tab,setTab]=useState('files');
  const [sizeRefOpen,setSizeRefOpen]=useState(false);
  useEffect(()=>{
    api.getColors().then(r=>setColors(r.colors||{}));
    api.listTranslations().then(r=>{if(r?.files)setTransFiles(r.files);});
    api.checkAssets().then(r=>{if(r&&!r.error)setAssets(r);});
  },[]);
  const enabledProds=(config?.products??[]).filter(p=>p.enabled).sort((a,b)=>a.name.localeCompare(b.name));
  const filteredProds=enabledProds
    .filter(p=>catFilter==='all'||p.category===catFilter)
    .filter(p=>!search||p.name.toLowerCase().includes(search.toLowerCase()));
  const prodCfg=selected?(config?.products??[]).find(p=>p.name===selected):null;
  const dimKey=prodCfg?(()=>{const{category,acidic,unit}=prodCfg;const u=unit||(category==='PAM'?'L':'kg');if(category==='PAM')return acidic?'PAM_acidic':'PAM_normal';if(category==='CE')return u==='kg'?'CE_solid':'CE';return u==='L'?'MO_liquid':'MO';})():null;
  const swatches=selected?(colors[selected]||Array(6).fill('#808080')):[];
  const allFiles=map?.files??[];
  const prodFiles=allFiles.filter(f=>f.product===selected);
  const filteredFiles=prodFiles.filter(f=>{
    if(fileType==='indd')return f.extension==='.indd'&&!f.print_file;
    if(fileType==='idml')return f.extension==='.idml';
    if(fileType==='print')return f.print_file;
    return true;
  }).filter(f=>showWip==='wip'?f.wip:showWip==='done'?!f.wip:true);
  const prodTrans=transFiles.filter(f=>f.product===selected);
  const prodAssets=selected?(assets[selected]||{}):{};
  const dimRows=[['PAM_normal','PAM Normal','var(--pam)'],['PAM_acidic','PAM Acidic','#f5a623'],['MO','MO','var(--mo)'],['MO_liquid','MO Liquid','var(--mo)'],['CE','CE','#3dbf7a'],['CE_solid','CE Solid','#3dbf7a']];
  const catColor=c=>c==='PAM'?'var(--pam)':c==='CE'?'#3dbf7a':'var(--mo)';
  const catBg=c=>c==='PAM'?'rgba(255,159,71,.15)':c==='CE'?'rgba(80,200,140,.15)':'rgba(75,191,255,.15)';
  const SizeTable=({showAll})=>(
    <div style={{display:'flex',flexDirection:'column',gap:10}}>
      {dimRows.filter(([key])=>showAll||key===dimKey||!dimKey).map(([key,label,clr])=>{
        const isActive=dimKey===key;
        const entries=Object.entries(config?.dimensions?.[key]??{});
        if(!entries.length)return null;
        return(
          <div key={key} style={{opacity:(!dimKey||isActive||showAll)?1:.35,transition:'opacity .2s'}}>
            <div style={{fontSize:10,fontFamily:"'DM Mono',monospace",color:isActive?clr:'var(--text3)',fontWeight:isActive?700:400,textTransform:'uppercase',letterSpacing:'.05em',marginBottom:6}}>{label}</div>
            <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
              {entries.map(([sz,dims])=>(
                <div key={sz} style={{background:isActive?'var(--surface2)':'var(--surface3)',border:'1px solid '+(isActive?clr:'var(--border2)'),borderRadius:6,padding:'6px 11px',textAlign:'center',minWidth:64,transition:'all .2s'}}>
                  <div style={{fontSize:12,fontWeight:600,fontFamily:"'Syne',sans-serif",color:isActive?'var(--text)':'var(--text3)'}}>{sz}</div>
                  <div style={{fontSize:10,fontFamily:"'DM Mono',monospace",color:'var(--text3)',marginTop:2}}>{dims}mm</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      <div>
        <div style={{fontSize:10,fontFamily:"'DM Mono',monospace",color:'var(--text3)',fontWeight:500,textTransform:'uppercase',letterSpacing:'.05em',marginBottom:6}}>Box</div>
        <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
          {Object.entries(config?.boxMultipliers??{}).map(([sz,box])=>(
            <div key={sz} style={{background:'var(--surface3)',border:'1px solid var(--border2)',borderRadius:6,padding:'6px 11px',textAlign:'center',minWidth:64}}>
              <div style={{fontSize:11,fontFamily:"'DM Mono',monospace",color:'var(--text3)'}}>{sz}</div>
              <div style={{fontSize:11,fontWeight:600,fontFamily:"'Syne',sans-serif",color:'var(--text)',marginTop:2}}>{box}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
  return(
    <div style={{display:'flex',height:'100%',gap:10,overflow:'hidden'}}>
      {/* ── LEFT: product list sidebar ── */}
      <div style={{width:188,flexShrink:0,display:'flex',flexDirection:'column',gap:7,overflow:'hidden'}}>
        <div className="search-wrap">
          <span className="search-icon">&#128269;</span>
          <input className="input" placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)}/>
        </div>
        <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
          {[['all','All'],['MO','MO'],['PAM','PAM'],['CE','CE']].map(([v,l])=>(
            <button key={v} onClick={()=>{setCatFilter(v);setSelected(null);}}
              style={{fontSize:10,fontFamily:"'DM Mono',monospace",padding:'2px 8px',borderRadius:10,border:'1px solid '+(catFilter===v?catColor(v==='all'?'MO':v):'var(--border2)'),background:catFilter===v?catBg(v==='all'?'MO':v):'transparent',color:catFilter===v?catColor(v==='all'?'MO':v):'var(--text3)',cursor:'pointer',transition:'all .15s'}}>
              {l}
            </button>
          ))}
        </div>
        <div style={{flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:2,paddingRight:2}}>
          {filteredProds.map(p=>(
            <button key={p.name} onClick={()=>{setSelected(selected===p.name?null:p.name);setTab('files');setSizeRefOpen(false);}}
              style={{display:'flex',alignItems:'center',gap:6,padding:'6px 9px',borderRadius:'var(--radius-sm)',border:'1px solid '+(selected===p.name?'var(--accent)':'var(--border2)'),background:selected===p.name?'var(--accent-dim)':'var(--surface2)',cursor:'pointer',textAlign:'left',transition:'all .15s',flexShrink:0}}>
              <span style={{flex:1,fontSize:12,fontWeight:selected===p.name?500:400,color:selected===p.name?'var(--accent)':'var(--text)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}</span>
              <span style={{fontSize:9,fontFamily:"'DM Mono',monospace",padding:'1px 4px',borderRadius:2,background:catBg(p.category),color:catColor(p.category),flexShrink:0}}>{p.category}</span>
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
              <span style={{fontSize:11,color:'var(--text3)',fontFamily:"'DM Mono',monospace",transition:'transform .2s',display:'inline-block',transform:sizeRefOpen?'rotate(180deg)':'none'}}>▾</span>
            </button>
            {sizeRefOpen&&(
              <div style={{flex:1,overflowY:'auto',paddingRight:4}}>
                <SizeTable showAll={true}/>
              </div>
            )}
          </div>
        ):(
          <div key={selected} style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
            {/* Gradient header */}
            <div className="info-gradient-bar" style={{height:50,borderRadius:'var(--radius-sm)',marginBottom:8,background:`linear-gradient(135deg, ${swatches.map(c=>c||'#808080').join(', ')})`,border:'1px solid var(--border2)',boxShadow:'0 4px 20px rgba(0,0,0,.4)',display:'flex',alignItems:'center',paddingLeft:10,gap:10,position:'relative',overflow:'hidden',flexShrink:0}}>
              <div className="info-bar-shimmer"/>
              <div title={prodAssets.logo?'Logo on file':'No logo found'} style={{height:32,minWidth:32,maxWidth:120,padding:'4px 8px',borderRadius:8,background:'rgba(255,255,255,.94)',display:'flex',alignItems:'center',justifyContent:'center',overflow:'hidden',flexShrink:0,boxShadow:'0 2px 8px rgba(0,0,0,.35)'}}>
                {prodAssets.logo?(
                  <img src={`/api/logo_thumb?product=${encodeURIComponent(selected)}`} alt="" style={{maxWidth:'100%',maxHeight:'100%',objectFit:'contain'}}/>
                ):(
                  <span style={{fontSize:12,fontWeight:700,color:'#999',fontFamily:"'Syne',sans-serif"}}>{selected.slice(0,1)}</span>
                )}
              </div>
              <span style={{fontWeight:700,fontSize:14,color:'#fff',textShadow:'0 1px 6px rgba(0,0,0,.6)',fontFamily:"'Syne',sans-serif",letterSpacing:'-.01em'}}>{selected}</span>
              {prodCfg&&<span style={{fontSize:10,fontFamily:"'DM Mono',monospace",color:'rgba(255,255,255,.85)',background:'rgba(0,0,0,.28)',padding:'2px 8px',borderRadius:8,backdropFilter:'blur(4px)',flexShrink:0}}>{prodCfg.category}{prodCfg.acidic?' · acidic':''}{prodCfg.unit?' · '+prodCfg.unit:''}</span>}
              <span style={{marginLeft:'auto',fontSize:11,fontFamily:"'DM Mono',monospace",color:'rgba(255,255,255,.5)',paddingRight:14,flexShrink:0}}>{prodFiles.length} file{prodFiles.length!==1?'s':''}</span>
            </div>
            {/* Swatch strip */}
            <div style={{display:'flex',gap:4,marginBottom:8,flexShrink:0}}>
              {swatches.map((c,i)=>(
                <div key={i} title={`Brand${i+1}: ${c||'#808080'}`} className="info-swatch" style={{flex:1,height:12,borderRadius:3,background:c||'#808080',border:'1px solid rgba(255,255,255,.08)',animationDelay:`${i*45}ms`,boxShadow:`0 2px 6px ${(c||'#808080')}55`}}/>
              ))}
            </div>
            {/* Asset dots + size reference — inline, no separate tabs */}
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:sizeRefOpen?6:8,flexShrink:0,flexWrap:'wrap'}}>
              {[['QR',prodAssets.qr,'qrcodes'],['Logo',prodAssets.logo,'logos']].map(([label,ok,dirKey])=>(
                <button key={label} title={`${label}: ${ok?'found':'missing'} — click to open folder`}
                  onClick={()=>api.getResourceDirs().then(d=>api.openFile(d[dirKey]))}
                  style={{display:'flex',alignItems:'center',gap:5,padding:'3px 8px',borderRadius:10,border:'1px solid var(--border2)',background:'var(--surface2)',cursor:'pointer',fontSize:10,fontFamily:"'DM Mono',monospace",color:'var(--text3)',flexShrink:0}}>
                  <span style={{width:7,height:7,borderRadius:'50%',background:ok?'var(--success)':'var(--danger)',boxShadow:`0 0 5px ${ok?'var(--success)':'var(--danger)'}`,flexShrink:0}}/>
                  {label}
                </button>
              ))}
              <div style={{width:1,alignSelf:'stretch',background:'var(--border2)',flexShrink:0}}/>
              <div style={{display:'flex',gap:5,flexWrap:'wrap',flex:1,alignItems:'center',minWidth:0}}>
                {Object.entries(config?.dimensions?.[dimKey]??{}).map(([sz,dims])=>(
                  <span key={sz} style={{fontSize:10,fontFamily:"'DM Mono',monospace",padding:'3px 7px',borderRadius:8,background:'var(--surface2)',border:'1px solid var(--border2)',color:'var(--text2)',whiteSpace:'nowrap',flexShrink:0}}>
                    {sz} <span style={{color:'var(--text3)'}}>· {dims}mm</span>
                  </span>
                ))}
              </div>
              <button onClick={()=>setSizeRefOpen(o=>!o)}
                style={{fontSize:10,fontFamily:"'DM Mono',monospace",color:'var(--accent)',background:'none',border:'none',cursor:'pointer',padding:'3px 4px',display:'flex',alignItems:'center',gap:3,flexShrink:0}}>
                All sizes
                <span style={{display:'inline-block',transition:'transform .2s',transform:sizeRefOpen?'rotate(180deg)':'none'}}>▾</span>
              </button>
            </div>
            {sizeRefOpen&&(
              <div style={{marginBottom:8,padding:10,borderRadius:'var(--radius-sm)',background:'var(--surface2)',border:'1px solid var(--border2)',maxHeight:280,overflowY:'auto',flexShrink:0}}>
                <SizeTable showAll={true}/>
              </div>
            )}
            {/* Tab strip */}
            <div style={{display:'flex',gap:2,marginBottom:10,background:'var(--surface2)',borderRadius:'var(--radius-sm)',padding:3,border:'1px solid var(--border)',flexShrink:0}}>
              {[
                ['files',`Files${prodFiles.length?' ('+prodFiles.length+')':''}`],
                ['translations',`Translations${prodTrans.length?' ('+prodTrans.length+')':''}`],
              ].map(([key,label])=>(
                <button key={key} onClick={()=>setTab(key)}
                  style={{flex:1,padding:'5px 0',borderRadius:5,cursor:'pointer',fontSize:11,fontWeight:500,border:'none',background:tab===key?'var(--surface3)':'transparent',color:tab===key?'var(--text)':'var(--text2)',transition:'all .15s'}}>
                  {label}
                </button>
              ))}
            </div>
            {/* Tab content */}
            <div className="view-anim" key={tab} style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>
              {tab==='files'&&(
                <div style={{display:'flex',flexDirection:'column',height:'100%',overflow:'hidden'}}>
                  <div style={{display:'flex',gap:5,flexWrap:'wrap',marginBottom:8,flexShrink:0}}>
                    {[['all','All'],['indd','INDD'],['idml','IDML'],['print','Print']].map(([v,l])=>(
                      <button key={v} className={'filter-chip '+(fileType===v?'active':'')} onClick={()=>setFileType(v)}>{l}</button>
                    ))}
                    <div style={{width:1,background:'var(--border2)',margin:'0 2px'}}/>
                    <button className={'filter-chip '+(showWip==='wip'?'active-wip':'')} onClick={()=>setShowWip(showWip==='wip'?'all':'wip')}>WIP</button>
                    <span style={{marginLeft:'auto',fontSize:11,fontFamily:"'DM Mono',monospace",color:'var(--text3)',alignSelf:'center'}}>{filteredFiles.length}/{prodFiles.length}</span>
                  </div>
                  {filteredFiles.length===0?(
                    <div style={{color:'var(--text3)',fontSize:13,fontStyle:'italic',padding:'12px 0'}}>No files match.</div>
                  ):(
                    <div style={{flex:1,overflowY:'auto'}}>
                      <div className="card" style={{padding:0,overflow:'hidden'}}>
                        <table className="files-table">
                          <thead><tr><th>Filename</th><th>Langs</th><th>Size</th><th>Date</th><th>Type</th><th></th></tr></thead>
                          <tbody>
                            {filteredFiles.map(f=>(
                              <tr key={f.filename+f.path}>
                                <td className="path-cell" title={f.path}>{f.filename}</td>
                                <td style={{fontFamily:"'DM Mono',monospace",fontSize:11}}>{f.languages?.join('·')??'--'}</td>
                                <td style={{fontFamily:"'DM Mono',monospace",fontSize:12}}>{f.packaging??'--'}</td>
                                <td style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:'var(--text3)'}}>{f.date??'--'}</td>
                                <td><div style={{display:'flex',gap:4,alignItems:'center'}}>
                                  {f.deze?<span className="topbar-badge badge-pam">Box</span>:<span className="topbar-badge badge-ok">Label</span>}
                                  {f.print_file?<span className="topbar-badge" style={{background:'rgba(255,255,255,.07)',color:'var(--text)'}}>Print</span>
                                    :f.extension==='.idml'?<span className="topbar-badge" style={{background:'rgba(100,180,255,.15)',color:'#64B4FF'}}>IDML</span>
                                    :<span className="topbar-badge" style={{background:'rgba(224,64,160,.15)',color:'#E040A0'}}>INDD</span>}
                                  {f.wip&&<span className="topbar-badge badge-wip">WIP</span>}
                                </div></td>
                                <td><FileActions path={f.path} onDeleted={removeFile}/></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {tab==='translations'&&(
                <div style={{overflowY:'auto',flex:1}}>
                  {prodTrans.length===0?(
                    <div style={{color:'var(--text3)',fontSize:13,fontStyle:'italic',padding:'12px 0'}}>No translation files found for {selected}.</div>
                  ):(
                    <div style={{display:'flex',flexDirection:'column',gap:4}}>
                      {prodTrans.map(f=>(
                        <div key={f.path} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',borderRadius:'var(--radius-sm)',background:'var(--surface2)',border:'1px solid var(--border2)'}}>
                          <span style={{fontSize:18,lineHeight:1}}>{f.flag}</span>
                          <span style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:'var(--accent)',width:28,flexShrink:0}}>{f.code}</span>
                          <span style={{fontSize:12,color:'var(--text2)',flex:1}}>{f.name}</span>
                          <span style={{fontSize:11,fontFamily:"'DM Mono',monospace",color:'var(--text3)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:160}} title={f.path}>{f.filename}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
function LabelsBrowser({map,setMap,config}){
  const removeFile=p=>setMap(m=>({...m,files:(m?.files??[]).filter(f=>f.path!==p)}));
  const [search,setSearch]=useState('');
  const [filterCat,setFilterCat]=useState('all');
  const [filterLabelType,setFilterLabelType]=useState('all');
  const [filterFileType,setFilterFileType]=useState('all');
  const [filterSize,setFilterSize]=useState('all');
  const [filterWip,setFilterWip]=useState('all');
  const [filterUnsorted,setFilterUnsorted]=useState(false);
  const [filterLangs,setFilterLangs]=useState([]);
  const [langOpen,setLangOpen]=useState(false);
  const toggleLang=lang=>{
    setFilterLangs(prev=>prev.includes(lang)?prev.filter(l=>l!==lang):prev.length<3?[...prev,lang]:prev);
  };
  const files=map?.files??[];
  const getCategory=product=>(config?.products??[]).find(p=>p.name===product)?.category??'?';
  const sizeMatch=f=>{
    if(filterSize==='all')return true;
    const p=(f.packaging??'').toLowerCase();
    if(!p)return filterSize==='other';
    if(filterSize==='1kg-1l')return p.startsWith('1kg')||p.toLowerCase().startsWith('1l');
    if(filterSize==='5kg-5l')return p.startsWith('5kg')||p.toLowerCase().startsWith('5l');
    if(filterSize==='250g')return p.startsWith('250g');
    if(filterSize==='500g')return p.startsWith('500g');
    if(filterSize==='other')return !p.startsWith('1kg')&&!p.toLowerCase().startsWith('1l')&&!p.startsWith('5kg')&&!p.toLowerCase().startsWith('5l')&&!p.startsWith('250g')&&!p.startsWith('500g');
    return true;
  };
  const filtered=files.filter(f=>{
    if(search&&!f.filename.toLowerCase().includes(search.toLowerCase())&&!f.product?.toLowerCase().includes(search.toLowerCase()))return false;
    if(filterCat!=='all'&&getCategory(f.product)!==filterCat)return false;
    if(filterLabelType==='label'&&f.deze)return false;
    if(filterLabelType==='box'&&!f.deze)return false;
    if(filterFileType==='indd'&&f.extension!=='.indd')return false;
    if(filterFileType==='idml'&&f.extension!=='.idml')return false;
    if(filterFileType==='print'&&!f.print_file)return false;
    if(filterWip==='wip'&&!f.wip)return false;
    if(filterUnsorted&&f.sorted)return false;
    if(!sizeMatch(f))return false;
    if(filterLangs.length>0&&!filterLangs.every(l=>(f.languages??[]).includes(l)))return false;
    return true;
  });
  return(
    <div>
      <div className="browser-filters">
        <button className="btn btn-folder" onClick={async()=>{const p=await api.getLabelsDir();api.openFile(p);}}>
          <Icon.Folder/>Open Labels Folder
        </button>
        <div className="search-wrap" style={{width:260}}>
          <span className="search-icon">&#128269;</span>
          <input className="input" placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)}/>
        </div>
        {[['all','All',null],['PAM','PAM','active-pam'],['MO','MO','active-mo'],['CE','CE','active-ce']].map(([v,lbl,cls])=>(
          <button key={v} className={'filter-chip '+(filterCat===v?(cls||'active'):'')} onClick={()=>setFilterCat(v)}>{lbl}</button>
        ))}
        <div style={{width:'100%',display:'flex',gap:8,flexWrap:'wrap',marginTop:6}}>
          {[['all','All',null],['label','Label','active-label'],['box','Box','active-box']].map(([v,lbl,cls])=>(
            <button key={v} className={'filter-chip '+(filterLabelType===v?(cls||'active'):'')} onClick={()=>setFilterLabelType(v)}>{lbl}</button>
          ))}
          <div style={{width:1,background:'var(--border2)',margin:'0 2px'}}/>
          {[['all','All',null],['indd','InDesign','active-indesign'],['idml','IDML','active-mo'],['print','Print','active-print']].map(([v,lbl,cls])=>(
            <button key={v} className={'filter-chip '+(filterFileType===v?(cls||'active'):'')} onClick={()=>setFilterFileType(v)}>{lbl}</button>
          ))}
          <div style={{width:1,background:'var(--border2)',margin:'0 2px'}}/>
          {[['all','All sizes',null],['1kg-1l','1kg / 1L',null],['5kg-5l','5kg / 5L',null],['250g','250g',null],['500g','500g',null],['other','Other',null]].map(([v,lbl])=>(
            <button key={v} className={'filter-chip '+(filterSize===v?'active':'')} onClick={()=>setFilterSize(v)}>{lbl}</button>
          ))}
          <div style={{width:1,background:'var(--border2)',margin:'0 2px'}}/>
          <button className={'filter-chip '+(filterWip==='wip'?'active-wip':'')} onClick={()=>setFilterWip(filterWip==='wip'?'all':'wip')}>WIP only</button>
          <button className={'filter-chip '+(filterUnsorted?'active-wip':'')} onClick={()=>setFilterUnsorted(o=>!o)}>Unsorted</button>
          <span style={{marginLeft:'auto',fontSize:12,color:'var(--text3)',fontFamily:"'DM Mono',monospace",alignSelf:'center'}}>{filtered.length} files</span>
        </div>
        {(config?.languages??[]).filter(l=>l.enabled).length>0&&(
          <button className={'filter-chip '+(filterLangs.length>0?'active-lang':'')} onClick={()=>setLangOpen(o=>!o)}>
            Language{filterLangs.length>0?` · ${filterLangs.join(', ')}`:''} {langOpen?'▴':'▾'}
          </button>
        )}
        {langOpen&&(config?.languages??[]).filter(l=>l.enabled).length>0&&(
          <div className="lang-chips-row" style={{width:'100%',display:'flex',gap:8,flexWrap:'wrap',marginTop:2,alignItems:'center'}}>
            {(config.languages).filter(l=>l.enabled).map(l=>(
              <button key={l.code} className={'filter-chip '+(filterLangs.includes(l.code)?'active-lang':'')} onClick={()=>toggleLang(l.code)}>
                {l.flag} {l.code}
              </button>
            ))}
            {filterLangs.length>0&&<button className="filter-chip" style={{opacity:.6}} onClick={()=>setFilterLangs([])}>✕ Clear</button>}
          </div>
        )}
      </div>
      {filtered.length===0?(
        <div className="empty-state"><div className="icon">&#128269;</div><p>No files match</p></div>
      ):(
        <div className="card" style={{padding:0,overflow:'hidden'}}>
          <table className="files-table">
            <thead><tr><th>Filename</th><th>Product</th><th>Cat</th><th>Languages</th><th>Size</th><th>Date</th><th>Type</th><th></th></tr></thead>
            <tbody>
              {filtered.map(f=>{
                const cat=getCategory(f.product);
                return(
                  <tr key={f.filename+f.path}>
                    <td className="path-cell" title={f.path}>{f.filename}</td>
                    <td style={{fontSize:13}}>{f.product??<span style={{color:'var(--text3)'}}>--</span>}</td>
                    <td>{cat!=='?'&&<span className="topbar-badge" style={{background:cat==='PAM'?'rgba(255,159,71,.15)':cat==='CE'?'rgba(80,200,140,.15)':'rgba(75,191,255,.15)',color:cat==='PAM'?'var(--pam)':cat==='CE'?'#3dbf7a':'var(--mo)'}}>{cat}</span>}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",fontSize:12}}>{f.languages?.join(' . ')??'--'}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",fontSize:12}}>{f.packaging??'--'}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:'var(--text3)'}}>{f.date??'--'}</td>
                    <td><div style={{display:'flex',gap:4,alignItems:'center',flexWrap:'wrap'}}>
                      {f.print_file?<span className="topbar-badge" style={{background:'rgba(255,255,255,.07)',color:'var(--text)'}}>Print</span>:f.deze?<span className="topbar-badge badge-pam">Box</span>:<span className="topbar-badge badge-ok">Label</span>}
                      {!f.print_file&&(f.extension==='.idml'?<span className="topbar-badge" style={{background:'rgba(100,180,255,.15)',color:'#64B4FF'}}>IDML</span>:<span className="topbar-badge" style={{background:'rgba(224,64,160,.15)',color:'#E040A0'}}>InDesign</span>)}
                      {f.wip&&<span className="topbar-badge badge-wip">WIP</span>}
                    </div></td>
                    <td><FileActions path={f.path} onDeleted={removeFile}/></td>
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
function Settings({config,saveConfig,setConfig,refreshMap,lightMode,toggleTheme}){
  const [tab,setTab]=useState('languages');
  const [cfg,setCfg]=useState(config);
  const [saved,setSaved]=useState(false);
  const [newLang,setNewLang]=useState({code:'',name:'',flag:''});
  const [scanning,setScanning]=useState(false);
  const [resetting,setResetting]=useState(false);
  const [resDirs,setResDirs]=useState(null);
  useEffect(()=>{api.getResourceDirs().then(r=>setResDirs(r));api.get('/api/paths').then(r=>setResDirs(d=>({...d,...r})));},[]);
  const save=async()=>{await saveConfig(cfg);setSaved(true);setTimeout(()=>setSaved(false),2000);};
  const resetToDefaults=async()=>{
    if(!window.confirm('Reset all settings to factory defaults? This cannot be undone.'))return;
    setResetting(true);
    const res=await api.resetConfig();
    if(res.ok){setCfg(res.config);if(setConfig)setConfig(res.config);}
    setResetting(false);
  };
  const updL=(i,k,v)=>{const l=[...cfg.languages];l[i]={...l[i],[k]:v};setCfg({...cfg,languages:l});};
  const remL=i=>setCfg({...cfg,languages:cfg.languages.filter((_,j)=>j!==i)});
  const addL=()=>{if(!newLang.code.trim()||!newLang.name.trim())return;setCfg({...cfg,languages:[...cfg.languages,{...newLang,enabled:true}]});setNewLang({code:'',name:'',flag:''});};
  const handleScan=async()=>{setScanning(true);await refreshMap();setScanning(false);};
  const SettingCard=({title,desc,children,danger})=>(
    <div style={{background:'var(--surface2)',border:'1px solid '+(danger?'rgba(255,77,109,.2)':'var(--border)'),borderRadius:'var(--radius-sm)',padding:'14px 16px'}}>
      <div style={{fontSize:13,fontWeight:600,color:danger?'var(--danger)':'var(--text)',marginBottom:desc?3:10}}>{title}</div>
      {desc&&<div style={{fontSize:12,color:'var(--text3)',marginBottom:12,lineHeight:1.5}}>{desc}</div>}
      {children}
    </div>
  );
  return(
    <div style={{display:'flex',flexDirection:'column',height:'100%',overflow:'hidden'}}>
      {/* Tab strip */}
      <div className="settings-tabs" style={{flexShrink:0}}>
        {[['languages','Languages'],['general','General'],['paths','Paths']].map(([t,l])=>(
          <button key={t} className={`settings-tab ${tab===t?'active':''}`} onClick={()=>setTab(t)}>{l}</button>
        ))}
      </div>

      {/* Tab content */}
      <div className="view-anim" key={tab} style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column',paddingTop:16}}>

        {tab==='languages'&&(
          <div style={{display:'flex',flexDirection:'column',height:'100%',overflow:'hidden'}}>
            <div style={{flex:1,overflowY:'auto',paddingRight:4,marginBottom:10}}>
              {cfg.languages.map((l,i)=>(
                <div key={l.code+i} className="product-list-item">
                  <label className="toggle"><input type="checkbox" checked={l.enabled} onChange={e=>updL(i,'enabled',e.target.checked)}/><span className="toggle-slider"/></label>
                  <span style={{fontSize:18,lineHeight:1}}>{l.flag}</span>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:600,width:30,flexShrink:0,color:'var(--accent)'}}>{l.code}</span>
                  <span style={{flex:1,fontSize:13,color:'var(--text2)'}}>{l.name}</span>
                  <button className="btn btn-danger btn-sm" onClick={()=>remL(i)}>✕</button>
                </div>
              ))}
            </div>
            <div style={{flexShrink:0,borderTop:'1px solid var(--border)',paddingTop:12,display:'flex',flexDirection:'column',gap:10}}>
              <div style={{fontSize:11,fontWeight:500,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'.06em'}}>Add language</div>
              <div className="flex gap-2 items-center">
                <input className="input" placeholder="🏳 Flag" value={newLang.flag} onChange={e=>setNewLang({...newLang,flag:e.target.value})} style={{width:72}}/>
                <input className="input" placeholder="Code" value={newLang.code} onChange={e=>setNewLang({...newLang,code:e.target.value.toUpperCase()})} style={{width:72}}/>
                <input className="input" placeholder="Full name" value={newLang.name} onChange={e=>setNewLang({...newLang,name:e.target.value})} style={{flex:1}}/>
                <button className="btn btn-primary" onClick={addL}>Add</button>
              </div>
              <div className="flex gap-2 items-center">
                <button className="btn btn-primary" onClick={save}>Save changes</button>
                {saved&&<span style={{fontSize:12,color:'var(--success)'}}>✓ Saved</span>}
                <span style={{marginLeft:'auto',fontSize:11,fontFamily:"'DM Mono',monospace",color:'var(--text3)'}}>{cfg.languages.filter(l=>l.enabled).length}/{cfg.languages.length} enabled</span>
              </div>
            </div>
          </div>
        )}

        {tab==='general'&&(
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,alignContent:'start',overflowY:'auto'}}>
            <SettingCard title="Theme" desc="Toggle between the dark and light interface.">
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <span style={{fontSize:12,color:'var(--text2)',flex:1}}>{lightMode?'Light mode':'Dark mode'}</span>
                <label className="toggle"><input type="checkbox" checked={lightMode} onChange={toggleTheme}/><span className="toggle-slider"/></label>
              </div>
            </SettingCard>
            <SettingCard title="File Map" desc="Rescan the labels folder to pick up newly added or renamed files.">
              <button className="btn btn-ghost" onClick={handleScan} disabled={scanning} style={{width:'100%'}}>
                {scanning?<><div className="spinner"/>Scanning...</>:<><Icon.Refresh/>Rescan labels folder</>}
              </button>
            </SettingCard>
            <SettingCard title="Export config" desc="Download a snapshot of your current product list and brand colors as a JSON file.">
              <button className="btn btn-ghost" style={{width:'100%'}} onClick={()=>fetch('/api/export').then(r=>r.blob()).then(blob=>{const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='etiketas_export.json';a.click();})}>
                ↓ Download export
              </button>
            </SettingCard>
            <SettingCard title="Factory reset" desc="Restore all settings to defaults. Your file map and brand colors are not affected." danger>
              <button className="btn btn-danger" onClick={resetToDefaults} disabled={resetting} style={{width:'100%'}}>
                {resetting?<><div className="spinner"/>Resetting...</>:'Reset to factory defaults'}
              </button>
            </SettingCard>
          </div>
        )}

        {tab==='paths'&&(
          <div style={{display:'flex',flexDirection:'column',gap:8,overflowY:'auto'}}>
            <p style={{fontSize:12,color:'var(--text3)',marginBottom:4}}>These are the directories the app reads from and writes to. Click a path to open it in Explorer.</p>
            {[
              ['labels','Labels output','Where generated label files are saved'],
              ['templates','Templates','IDML template files used when creating labels'],
              ['qrcodes','QR Codes','PNG QR code images matched to products'],
              ['logos','Logos','Product logo files used in labels'],
            ].map(([key,label,desc])=>{
              const p=resDirs?.[key];
              return(
                <div key={key} style={{background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:'var(--radius-sm)',padding:'12px 14px',display:'flex',alignItems:'center',gap:12}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:600,color:'var(--text)',marginBottom:2}}>{label}</div>
                    <div style={{fontSize:11,color:'var(--text3)',marginBottom:4}}>{desc}</div>
                    <div style={{fontSize:11,fontFamily:"'DM Mono',monospace",color:p?'var(--accent)':'var(--text3)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={p||''}>{p||'—'}</div>
                  </div>
                  <button className="btn btn-folder btn-sm" disabled={!p} onClick={()=>p&&api.openFile(p)} title="Open in Explorer"><Icon.Folder/></button>
                </div>
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
}

function Resources({config,saveConfig}){
  const [tab,setTab]=useState('products');
  const [cfg,setCfg]=useState(config);
  const [saved,setSaved]=useState(false);
  const [colors,setColors]=useState(null);
  const [colorsSaved,setColorsSaved]=useState(false);
  const [swatchEdit,setSwatchEdit]=useState(null);
  const swatchPopRef=useRef(null);
  const saveTimerRef=useRef(null);
  useEffect(()=>{
    if(!swatchEdit)return;
    const h=e=>{if(swatchPopRef.current&&!swatchPopRef.current.contains(e.target))setSwatchEdit(null);};
    document.addEventListener('mousedown',h);
    return()=>document.removeEventListener('mousedown',h);
  },[swatchEdit]);
  const [resDirs,setResDirs]=useState(null);
  const [assets,setAssets]=useState({});
  useEffect(()=>{
    api.getColors().then(r=>setColors(r.colors||{}));
    api.getResourceDirs().then(r=>setResDirs(r));
    api.checkAssets().then(r=>{if(r&&!r.error)setAssets(r);});
  },[]);
  const save=async()=>{await saveConfig(cfg);setSaved(true);setTimeout(()=>setSaved(false),2000);};
  const [syncing,setSyncing]=useState(false);
  const [syncMsg,setSyncMsg]=useState('');
  const syncFromDefault=async()=>{
    setSyncing(true);
    const r=await api.syncProducts();
    setSyncing(false);
    if(r.ok){
      setCfg(r.config);
      const added=r.added?.length??0, updated=r.updated?.length??0;
      setSyncMsg(added||updated?`Added ${added}, updated ${updated}`:'Already up to date');
      setTimeout(()=>setSyncMsg(''),3000);
    }
  };
  const updP=(i,k,v)=>{const p=[...cfg.products];p[i]={...p[i],[k]:v};setCfg({...cfg,products:p});};
  const remP=i=>setCfg({...cfg,products:cfg.products.filter((_,j)=>j!==i)});
  const setColor=(name,idx,hex)=>{
    const curr=((colors||{})[name]||Array(6).fill('#808080')).slice();
    curr[idx]=hex;
    const newColors={...colors,[name]:curr};
    setColors(newColors);
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current=setTimeout(()=>{api.saveColors(newColors);setColorsSaved(true);setTimeout(()=>setColorsSaved(false),2000);},900);
  };
  const moProds=(cfg?.products??[]).filter(p=>p.category==='MO').sort((a,b)=>a.name.localeCompare(b.name));
  const pamProds=(cfg?.products??[]).filter(p=>p.category==='PAM').sort((a,b)=>a.name.localeCompare(b.name));
  const ceProds=(cfg?.products??[]).filter(p=>p.category==='CE').sort((a,b)=>a.name.localeCompare(b.name));
  return(
    <div style={{display:'flex',flexDirection:'column',height:'100%',minHeight:0}}>
      <div style={{flexShrink:0}}>
        <div className="settings-tabs" style={{marginBottom:0}}>
          {['products','colors'].map(t=>(
            <button key={t} className={`settings-tab ${tab===t?'active':''}`} onClick={()=>setTab(t)}>
              {t.charAt(0).toUpperCase()+t.slice(1)}
            </button>
          ))}
        </div>
      </div>
      {tab==='products'&&(
        <div className="view-anim" style={{display:'flex',flexDirection:'column',flex:1,minHeight:0}}>
          <p className="section-title" style={{flexShrink:0}}>Product list</p>
          <div style={{flex:1,overflowY:'auto',paddingRight:4,minHeight:0}}>
            {(()=>{
              const indexed=[...cfg.products.map((p,i)=>({...p,_i:i}))];
              const renderItem=p=>{const i=p._i;return(
                <div key={p.name+i} className="product-list-item">
                  <label className="toggle"><input type="checkbox" checked={p.enabled} onChange={e=>updP(i,'enabled',e.target.checked)}/><span className="toggle-slider"/></label>
                  <span style={{flex:1,fontSize:13,fontWeight:500,color:p.enabled?'var(--text)':'var(--text3)'}}>{p.name}</span>
                  {(()=>{const a=assets[p.name]||{};return(<div style={{display:'flex',gap:4}}>
                    {[['QR',a.qr],['Logo',a.logo]].map(([lbl,ok])=>(
                      <span key={lbl} title={ok?lbl+' found':lbl+' missing'} style={{fontSize:10,fontFamily:"'DM Mono',monospace",padding:'2px 6px',borderRadius:10,background:ok?'rgba(108,181,113,.15)':'rgba(255,255,255,.05)',color:ok?'var(--success)':'var(--text3)',border:'1px solid '+(ok?'rgba(108,181,113,.3)':'var(--border2)')}}>{lbl}</span>
                    ))}
                  </div>);})()}
                  {p.category==='PAM'&&(
                    <label className="flex items-center gap-2" style={{cursor:'pointer',fontSize:12,color:'var(--text3)'}}>
                      <input type="checkbox" checked={p.acidic} onChange={e=>updP(i,'acidic',e.target.checked)} style={{accentColor:'var(--pam)'}}/>acidic
                    </label>
                  )}
                  <div className="pill-toggle">
                    {['L','kg'].map(u=>(
                      <button key={u} className={`pill-btn ${p.unit===u?'active-mo':'inactive'}`} onClick={()=>updP(i,'unit',u)}>{u}</button>
                    ))}
                  </div>
                  <div className="pill-toggle">
                    {['PAM','MO','CE'].map(cat=>(
                      <button key={cat} className={`pill-btn ${p.category===cat?'active-'+cat.toLowerCase():'inactive'}`} onClick={()=>updP(i,'category',cat)}>{cat}</button>
                    ))}
                  </div>
                  <button className="btn btn-danger btn-sm" onClick={()=>remP(i)}>x</button>
                </div>
              );};
              const catColor=cat=>cat==='PAM'?'var(--pam)':cat==='CE'?'#3dbf7a':'var(--mo)';
              return [['MO',indexed.filter(p=>p.category==='MO')],['PAM',indexed.filter(p=>p.category==='PAM')],['CE',indexed.filter(p=>p.category==='CE')]].map(([cat,prods])=>(
                <div key={cat} style={{marginBottom:16}}>
                  <div style={{fontSize:11,fontWeight:500,color:catColor(cat),textTransform:'uppercase',letterSpacing:'.06em',marginBottom:6,fontFamily:"'DM Mono',monospace"}}>{cat}</div>
                  {prods.sort((a,b)=>a.name.localeCompare(b.name)).map(renderItem)}
                </div>
              ));
            })()}
          </div>
          <div className="flex gap-2 items-center" style={{flexShrink:0,paddingTop:12}}>
            <button className="btn btn-ghost" onClick={syncFromDefault} disabled={syncing} title="Add new products from default_config.json without changing existing ones or your colors">
              {syncing?<><div className="spinner" style={{width:12,height:12}}/>Syncing...</>:'↻ Sync from default'}
            </button>
            {syncMsg&&<span style={{fontSize:12,color:'var(--success)'}}>{syncMsg}</span>}
            <button className="btn btn-primary" style={{marginLeft:'auto'}} onClick={save}>Save changes</button>
            {saved&&<span style={{fontSize:12,color:'var(--success)'}}>Saved</span>}
          </div>
        </div>
      )}
      {tab==='colors'&&(
        <div className="view-anim" style={{display:'flex',flexDirection:'column',flex:1,minHeight:0}}>
          <p className="section-title" style={{flexShrink:0,marginBottom:4}}>Color schemes</p>
          <p style={{fontSize:12,color:'var(--text3)',marginBottom:12,flexShrink:0}}>Click a swatch to change its color. Colors save automatically. Up to 6 per product.</p>
          {colors===null?(
            <div className="spinner" style={{width:20,height:20}}/>
          ):(
            <>
              <div style={{flex:1,overflowY:'auto',paddingRight:4,minHeight:0}}>
                {[['MO',moProds],['PAM',pamProds],['CE',ceProds]].map(([cat,prods])=>prods.length===0?null:(
                  <div key={cat} style={{marginBottom:24}}>
                    <div style={{fontSize:11,fontWeight:500,color:cat==='PAM'?'var(--pam)':cat==='CE'?'#3dbf7a':'var(--mo)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:10,fontFamily:"'DM Mono',monospace"}}>{cat}</div>
                    {prods.map(p=>{
                      const swatches=(colors[p.name]||Array(6).fill('#808080'));
                      return(
                        <div key={p.name} style={{display:'flex',alignItems:'center',gap:10,marginBottom:8,padding:'8px 12px',background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:'var(--radius-sm)'}}>
                          <span style={{flex:1,fontSize:13,fontWeight:500}}>{p.name}</span>
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
                                    <div ref={swatchPopRef} style={{position:'absolute',bottom:36,left:'50%',transform:'translateX(-50%)',zIndex:200,background:'var(--surface3)',border:'1px solid var(--border2)',borderRadius:8,padding:10,display:'flex',flexDirection:'column',gap:8,boxShadow:'0 4px 20px rgba(0,0,0,.5)',minWidth:130}}>
                                      <input type="color" value={swatchEdit.val}
                                        onChange={e=>{const v=e.target.value;setSwatchEdit(s=>({...s,val:v}));setColor(p.name,idx,v);}}
                                        style={{width:'100%',height:36,border:'1px solid var(--border2)',borderRadius:4,cursor:'pointer',padding:2,background:'var(--surface2)'}}
                                      />
                                      <input type="text" className="input"
                                        value={swatchEdit.val}
                                        style={{fontFamily:"'DM Mono',monospace",fontSize:12,padding:'5px 8px',textTransform:'uppercase',textAlign:'center'}}
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
              {colorsSaved&&<span style={{fontSize:12,color:'var(--success)',flexShrink:0,paddingTop:8}}>Colors saved</span>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
