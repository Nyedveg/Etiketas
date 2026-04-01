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
  getLabelsDir:    ()    => api.get('/api/labels_dir').then(r=>r.path),
  resetConfig:     ()    => api.post('/api/config/reset', {}),
  syncProducts:    ()    => api.post('/api/config/sync_products', {}),
  getDefaultConfig:()    => api.get('/api/config/default'),
  pickDir:         ()    => api.get('/api/pick_dir'),
  ingest:          (p)   => api.post('/api/ingest', {path:p}),
  listQrCodes:     ()    => api.get('/api/qrcodes'),
  applyQr:         (indd_path, qr_path) => api.post('/api/apply_qr', {indd_path, qr_path}),
  getTemplates:    ()    => api.get('/api/templates'),
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
};

function App(){
  const [view,setView]=useState('dashboard');
  const [config,setConfig]=useState(null);
  const [map,setMap]=useState(null);
  const [loading,setLoading]=useState(true);
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
        <div className={`content${view==='resources'?' no-scroll':''}`}>
          {view==='dashboard'&&<Dashboard map={map} config={config} setView={setView} refreshMap={refreshMap}/>}
          {view==='new'&&<NewLabelWizard config={config} map={map} setMap={setMap}/>}
          {view==='browse'&&<LabelsBrowser map={map} config={config}/>}
          {view==='settings'&&<Settings config={config} saveConfig={saveConfig} setConfig={setConfig} refreshMap={refreshMap}/>}
          {view==='resources'&&<Resources config={config} saveConfig={saveConfig}/>}
          {view==='information'&&<Information config={config} map={map}/>}
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

function Dashboard({map,config,setView,refreshMap}){
  const [ingesting,setIngesting]=useState(false);
  const [ingestResult,setIngestResult]=useState(null);
  const [templateCount,setTemplateCount]=useState(null);
  useEffect(()=>{api.getTemplates().then(r=>setTemplateCount(r.count??0)).catch(()=>{});},[]);
  const files=map?.files??[];
  const total=files.length, indd=files.filter(f=>f.extension==='.indd').length;
  const wip=files.filter(f=>f.wip).length, unsorted=files.filter(f=>!f.sorted).length;
  const recent=[...files]
    .sort((a,b)=>{const ta=a.added_at??'',tb=b.added_at??'';return tb>ta?1:tb<ta?-1:0;})
    .slice(0,12);
  const handleReadFiles=async()=>{
    const pick=await api.pickDir();
    if(!pick.ok||!pick.path)return;
    setIngesting(true); setIngestResult(null);
    const res=await api.ingest(pick.path);
    setIngestResult(res);
    if(res.ok&&res.copied>0)await refreshMap();
    setIngesting(false);
  };
  return(
    <div>
      <div className="stats-grid">
        {[
          {label:'Total files',   value:total,                  color:null},
          {label:'InDesign',      value:indd,                   color:'#E040A0'},
          {label:'WIP labels',    value:wip,                    color:'#00DCC8'},
          {label:'Unsorted',      value:unsorted,               color:'var(--danger)'},
          {label:'Templates',     value:templateCount??'—',     color:'var(--accent)'},
        ].map(({label,value,color})=>(
          <div key={label} className="stat-card">
            <div className="stat-value" style={color?{color}:{}}>{value}</div>
            <div className="stat-label">{label}</div>
          </div>
        ))}
      </div>
      <div className="flex gap-3" style={{alignItems:'center',flexWrap:'wrap',marginBottom:24}}>
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
      {total===0?(
        <div className="card">
          <div className="empty-state">
            <div className="icon">📂</div>
            <p>No labels found yet</p>
            <span>Run the organizer script first, then click Rescan.</span>
            <div className="mt-3">
              <button className="btn btn-primary" onClick={()=>setView('new')}>Create first label</button>
            </div>
          </div>
        </div>
      ):(
        <>
          <p className="section-title">Recently Added</p>
          <div className="card" style={{padding:0,overflow:'hidden'}}>
            <table className="files-table">
              <thead><tr><th>Filename</th><th>Product</th><th>Languages</th><th>Type</th><th></th></tr></thead>
              <tbody>
                {recent.map(f=>(
                  <tr key={f.filename+f.path}>
                    <td className="path-cell" title={f.path}>{f.filename}</td>
                    <td>{f.product??<span style={{color:'var(--text3)'}}>--</span>}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",fontSize:12}}>{f.languages?f.languages.join(' . '):'--'}</td>
                    <td><div style={{display:'flex',gap:4,alignItems:'center'}}>
                      {f.print_file?<span className="topbar-badge" style={{background:'rgba(255,255,255,.07)',color:'var(--text)'}}>Print</span>:f.deze?<span className="topbar-badge badge-pam">Box</span>:<span className="topbar-badge badge-ok">Label</span>}
                      {!f.print_file&&(f.extension==='.idml'?<span className="topbar-badge" style={{background:'rgba(100,180,255,.15)',color:'#64B4FF'}}>IDML</span>:<span className="topbar-badge" style={{background:'rgba(224,64,160,.15)',color:'#E040A0'}}>InDesign</span>)}
                      {f.wip&&<span className="topbar-badge badge-wip">WIP</span>}
                    </div></td>
                    <td><div className="file-actions">
                      <button className="btn btn-ghost btn-indesign btn-sm" title="Open in InDesign" onClick={()=>api.openFile(f.path)}><Icon.Open/></button>
                      <button className="btn btn-folder btn-sm" title="Show in Explorer" onClick={()=>api.revealFile(f.path)}><Icon.Folder/></button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function NewLabelWizard({config,map,setMap}){
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
  const dimKey=productCfg?(productCfg.category==='PAM'?(productCfg.acidic?'PAM_acidic':'PAM_normal'):productCfg.category==='CE'?'CE':'MO'):null;
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
    const labelPath=tmplInfo?.labels?.[selectedLabel]?.file?.path??null;
    const boxPath=tmplInfo?.boxes?.[selectedBox]?.file?.path??null;
    const isPAM=productCfg?.category==='PAM';
  const footerValues=(sku||ufi)?{sku,ufi:isPAM?ufi:'',manufacturer_value:''}:null;
    const res=await api.createLabel({product,languages,packagingSize:size,config:cfg,labelTemplatePath:labelPath,boxTemplatePath:boxPath,langFiles,footerValues});
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
  const TemplatePicker=({items,selected,onSelect,title,newName})=>(
    <div style={{marginBottom:14}}>
      <div style={{fontSize:11,fontWeight:500,color:'var(--text2)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:8}}>{title}</div>
      {items&&items.length>0?(
        items.map((item,idx)=>(
          <div key={idx} onClick={()=>onSelect(idx)} style={{background:selected===idx?'var(--accent-dim)':'var(--surface2)',border:'1px solid '+(selected===idx?'var(--accent)':'var(--border2)'),borderRadius:'var(--radius-sm)',padding:'10px 12px',marginBottom:6,cursor:'pointer',transition:'all .15s'}}>
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
      <div style={{fontSize:11,color:'var(--text3)',marginTop:6}}>Will be saved as: <span style={{fontFamily:"'DM Mono',monospace",color:'var(--accent)'}}>{newName}</span></div>
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
            <span style={{fontSize:13,color:'var(--text2)'}}>Select up to 3 languages &middot; </span>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:13,color:'var(--accent)'}}>{languages.length}/3</span>
            {languages.length>0&&(
              <div className="flex gap-2 mt-2">
                {languages.map(code=>{
                  const l=enabledLangs.find(x=>x.code===code);
                  return(
                    <span key={code} onClick={()=>toggleLang(code)} style={{background:'var(--accent-dim)',border:'1px solid var(--accent)',borderRadius:4,padding:'4px 10px',fontSize:12,fontFamily:"'DM Mono',monospace",color:'var(--accent)',cursor:'pointer'}}>
                      {l?.flag} {code} x
                    </span>
                  );
                })}
              </div>
            )}
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
          <div className="flex mt-4 gap-2" style={{flexShrink:0,alignItems:'center'}}>
            <button className="btn btn-ghost" onClick={()=>setStep(2)}>&larr; Back</button>
            {(()=>{
              const missing=[...(!sku?['SKU']:[]),...(productCfg?.category==='PAM'&&!ufi?['UFI']:[])];
              return missing.length>0&&<span style={{fontSize:11,color:'var(--warn,#d97706)',marginLeft:'auto',marginRight:8}}>&#9888; No {missing.join(' or ')} provided</span>;
            })()}
            <button className="btn btn-primary" style={(sku&&(productCfg?.category!=='PAM'||ufi))?{marginLeft:'auto'}:{}} onClick={()=>setStep(4)}>Next &rarr;</button>
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
          {loading?(
            <div className="flex items-center gap-3" style={{padding:'20px 0',flexShrink:0}}>
              <div className="spinner"/><span style={{color:'var(--text2)'}}>Finding best templates...</span>
            </div>
          ):reviewTab==='template'?(
            <div style={{flex:1,overflowY:'auto',paddingRight:4}}>
              <TemplatePicker items={tmplInfo?.labels} selected={selectedLabel} onSelect={setSelectedLabel} title="Packaging Label Template" newName={prevLabel}/>
              <TemplatePicker items={tmplInfo?.boxes} selected={selectedBox} onSelect={setSelectedBox} title="Box Label Template" newName={prevBox}/>
            </div>
          ):(
            <div style={{flex:1,overflowY:'auto',paddingRight:4}}>
              {relatedFiles.length===0?(
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
                          <td><div className="file-actions">
                            <button className="btn btn-ghost btn-indesign btn-sm" onClick={()=>api.openFile(f.path)}><Icon.Open/></button>
                            <button className="btn btn-folder btn-sm" onClick={()=>api.revealFile(f.path)}><Icon.Folder/></button>
                          </div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          <div className="flex mt-4 gap-2" style={{flexShrink:0}}>
            <button className="btn btn-ghost" onClick={()=>setStep(4)}>&larr; Back</button>
            <button className="btn btn-primary ml-auto btn-lg" disabled={loading} onClick={handleCreate}>
              {loading?<><div className="spinner"/>Creating...</>:'Create Labels'}
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
function Information({config,map}){
  const [selected,setSelected]=useState(null);
  const [search,setSearch]=useState('');
  const [colors,setColors]=useState({});
  const [transFiles,setTransFiles]=useState([]);
  const [assets,setAssets]=useState({});
  const [fileType,setFileType]=useState('all');
  const [showWip,setShowWip]=useState('all');
  const [catFilter,setCatFilter]=useState('all');
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
  const dimKey=prodCfg?(prodCfg.category==='PAM'?(prodCfg.acidic?'PAM_acidic':'PAM_normal'):prodCfg.category==='CE'?'CE':'MO'):null;
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
  const dimRows=[['PAM_normal','PAM Normal','var(--pam)'],['PAM_acidic','PAM Acidic','#f5a623'],['MO','MO','var(--mo)'],['CE','CE','#3dbf7a']];
  return(
    <div style={{display:'flex',flexDirection:'column',height:'100%',overflow:'hidden'}}>
      {/* Product search + list */}
      <div style={{flexShrink:0,marginBottom:12}}>
        <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:8}}>
          <div className="search-wrap" style={{flex:1}}>
            <span className="search-icon">&#128269;</span>
            <input className="input" placeholder="Search products..." value={search} onChange={e=>setSearch(e.target.value)} autoFocus/>
          </div>
          {selected&&(
            <div style={{display:'flex',alignItems:'center',gap:6,background:'var(--accent-dim)',border:'1px solid var(--accent)',borderRadius:'var(--radius-sm)',padding:'5px 10px',flexShrink:0,maxWidth:200}}>
              <span style={{fontSize:12,color:'var(--accent)',fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{selected}</span>
              <button onClick={()=>{setSelected(null);setSearch('');setCatFilter('all');}} style={{background:'none',border:'none',color:'var(--accent)',cursor:'pointer',fontSize:14,padding:0,lineHeight:1,flexShrink:0}}>✕</button>
            </div>
          )}
        </div>
        <div style={{display:'flex',gap:5,marginBottom:6,flexWrap:'wrap'}}>
          {[['all','All'],['MO','MO'],['PAM','PAM'],['CE','CE']].map(([v,l])=>(
            <button key={v} onClick={()=>{setCatFilter(v);setSelected(null);}}
              style={{fontSize:10,fontFamily:"'DM Mono',monospace",padding:'2px 9px',borderRadius:10,border:'1px solid '+(catFilter===v?(v==='PAM'?'var(--pam)':v==='CE'?'#3dbf7a':'var(--mo)'):'var(--border2)'),background:catFilter===v?(v==='PAM'?'rgba(255,159,71,.15)':v==='CE'?'rgba(80,200,140,.15)':'rgba(75,191,255,.15)'):'transparent',color:catFilter===v?(v==='PAM'?'var(--pam)':v==='CE'?'#3dbf7a':'var(--mo)'):'var(--text3)',cursor:'pointer',transition:'all .15s'}}>
              {l}
            </button>
          ))}
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:3,maxHeight:120,overflowY:'auto',paddingRight:4}}>
          {filteredProds.map(p=>(
            <button key={p.name} onClick={()=>setSelected(selected===p.name?null:p.name)} style={{display:'flex',alignItems:'center',gap:8,padding:'7px 10px',borderRadius:'var(--radius-sm)',border:'1px solid '+(selected===p.name?'var(--accent)':'var(--border2)'),background:selected===p.name?'var(--accent-dim)':'var(--surface2)',cursor:'pointer',textAlign:'left',transition:'all .15s',flexShrink:0}}>
              <span style={{flex:1,fontSize:12,fontWeight:selected===p.name?500:400,color:selected===p.name?'var(--accent)':'var(--text)'}}>{p.name}</span>
              <span style={{fontSize:9,fontFamily:"'DM Mono',monospace",padding:'1px 5px',borderRadius:2,background:p.category==='PAM'?'rgba(255,159,71,.15)':p.category==='CE'?'rgba(80,200,140,.15)':'rgba(75,191,255,.15)',color:p.category==='PAM'?'var(--pam)':p.category==='CE'?'#3dbf7a':'var(--mo)'}}>{p.category}{p.acidic?' / acidic':''}</span>
            </button>
          ))}
          {filteredProds.length===0&&<div style={{fontSize:12,color:'var(--text3)',fontStyle:'italic',padding:'8px 0'}}>No products match.</div>}
        </div>
      </div>
      {!selected?(
        /* Size reference + box packaging shown when no product selected */
        <div style={{flex:1,overflowY:'auto',paddingRight:4}}>
          <p className="section-title">Label Size Reference</p>
          {dimRows.map(([key,label,clr])=>(
            <div key={key} style={{marginBottom:14}}>
              <div style={{fontSize:10,fontFamily:"'DM Mono',monospace",color:clr,marginBottom:6,fontWeight:600,textTransform:'uppercase',letterSpacing:'.05em'}}>{label}</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                {Object.entries(config?.dimensions?.[key]??{}).map(([sz,dims])=>(
                  <div key={sz} style={{background:'var(--surface2)',border:'1px solid var(--border2)',borderRadius:6,padding:'6px 12px',textAlign:'center',minWidth:72}}>
                    <div style={{fontSize:13,fontWeight:600,fontFamily:"'Syne',sans-serif",color:'var(--text)'}}>{sz}</div>
                    <div style={{fontSize:10,fontFamily:"'DM Mono',monospace",color:'var(--text3)',marginTop:2}}>{dims}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <p className="section-title" style={{marginTop:8}}>Box Packaging Reference</p>
          <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:14}}>
            {Object.entries(config?.boxMultipliers??{}).map(([sz,box])=>(
              <div key={sz} style={{background:'var(--surface2)',border:'1px solid var(--border2)',borderRadius:6,padding:'6px 12px',textAlign:'center',minWidth:72}}>
                <div style={{fontSize:13,fontWeight:600,fontFamily:"'Syne',sans-serif",color:'var(--text)'}}>{sz}</div>
                <div style={{fontSize:10,fontFamily:"'DM Mono',monospace",color:'var(--text3)',marginTop:2}}>{box}</div>
              </div>
            ))}
          </div>
        </div>
      ):(
        <div style={{flex:1,overflowY:'auto',paddingRight:4}}>
          {/* Gradient header bar */}
          <div style={{height:52,borderRadius:'var(--radius-sm)',marginBottom:10,background:`linear-gradient(135deg, ${swatches.map(c=>c||'#808080').join(', ')})`,border:'1px solid var(--border2)',boxShadow:'0 2px 16px rgba(0,0,0,.35)',display:'flex',alignItems:'center',paddingLeft:16,gap:10}}>
            <span style={{fontWeight:600,fontSize:15,color:'#fff',textShadow:'0 1px 4px rgba(0,0,0,.5)',fontFamily:"'Syne',sans-serif"}}>{selected}</span>
            {prodCfg&&<span style={{fontSize:10,fontFamily:"'DM Mono',monospace",color:'rgba(255,255,255,.75)',background:'rgba(0,0,0,.25)',padding:'2px 8px',borderRadius:3}}>{prodCfg.category}{prodCfg.acidic?' · acidic':''}</span>}
            <span style={{marginLeft:'auto',fontSize:11,fontFamily:"'DM Mono',monospace",color:'rgba(255,255,255,.6)',paddingRight:16}}>{prodFiles.length} files</span>
          </div>
          {/* Swatch row */}
          <div style={{display:'flex',gap:5,marginBottom:12}}>
            {swatches.map((c,i)=>(
              <div key={i} title={`Brand${i+1}: ${c||'#808080'}`} style={{flex:1,height:14,borderRadius:3,background:c||'#808080',border:'1px solid var(--border2)'}}/>
            ))}
          </div>
          {/* 2-column: label sizes (left) | assets + translations (right) */}
          <div style={{display:'grid',gridTemplateColumns:'55% 1fr',gap:12,marginBottom:14,alignItems:'start'}}>
            {/* Left: label sizes with dimming */}
            <div>
              <div style={{fontSize:11,fontWeight:500,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:8}}>Label sizes</div>
              <div style={{display:'flex',flexDirection:'column',gap:8}}>
                {dimRows.map(([key,label,clr])=>{
                  const isActive=dimKey===key;
                  const entries=Object.entries(config?.dimensions?.[key]??{});
                  return(
                    <div key={key} style={{opacity:isActive?1:.35,transition:'opacity .2s'}}>
                      <div style={{fontSize:10,fontFamily:"'DM Mono',monospace",color:isActive?clr:'var(--text3)',marginBottom:5,fontWeight:isActive?600:400,textTransform:'uppercase',letterSpacing:'.04em'}}>{label}</div>
                      <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
                        {entries.map(([sz,dims])=>(
                          <div key={sz} style={{background:isActive?'var(--surface2)':'var(--surface3)',border:'1px solid '+(isActive?clr:'var(--border2)'),borderRadius:5,padding:'5px 10px',textAlign:'center',minWidth:60}}>
                            <div style={{fontSize:12,fontWeight:600,fontFamily:"'Syne',sans-serif",color:isActive?'var(--text)':'var(--text3)'}}>{sz}</div>
                            <div style={{fontSize:10,fontFamily:"'DM Mono',monospace",color:'var(--text3)',marginTop:1}}>{dims}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            {/* Right: assets + translations stacked */}
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              <div className="card" style={{padding:'12px 14px'}}>
                <div style={{fontSize:11,fontWeight:500,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:10}}>Assets</div>
                {[['QR Code',prodAssets.qr,'qrcodes'],['Logo',prodAssets.logo,'logos']].map(([label,ok,dirKey])=>(
                  <div key={label} style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                    <span style={{width:8,height:8,borderRadius:'50%',background:ok?'var(--success)':'var(--danger)',flexShrink:0}}/>
                    <span style={{fontSize:12,flex:1,color:ok?'var(--text)':'var(--text3)'}}>{label}</span>
                    <button className="btn btn-folder btn-sm" title="Open folder" onClick={()=>api.getResourceDirs().then(d=>api.openFile(d[dirKey]))}><Icon.Folder/></button>
                  </div>
                ))}
              </div>
              <div className="card" style={{padding:'12px 14px'}}>
                <div style={{fontSize:11,fontWeight:500,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:10}}>
                  Translations <span style={{color:'var(--accent)',fontFamily:"'DM Mono',monospace"}}>{prodTrans.length}</span>
                </div>
                {prodTrans.length===0?(
                  <div style={{fontSize:12,color:'var(--text3)',fontStyle:'italic'}}>None found</div>
                ):(
                  prodTrans.map(f=>(
                    <div key={f.path} style={{display:'flex',alignItems:'center',gap:6,marginBottom:5}}>
                      <span style={{fontSize:15}}>{f.flag}</span>
                      <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:'var(--accent)',width:26,flexShrink:0}}>{f.code}</span>
                      <span style={{fontSize:11,color:'var(--text2)'}}>{f.name}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
          {/* Box packaging – full width */}
          <div style={{marginBottom:14}}>
            <div style={{fontSize:11,fontWeight:500,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:8}}>Box packaging</div>
            <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
              {Object.entries(config?.boxMultipliers??{}).map(([sz,box])=>(
                <div key={sz} style={{background:'var(--surface2)',border:'1px solid var(--border2)',borderRadius:5,padding:'5px 10px',textAlign:'center',minWidth:60}}>
                  <div style={{fontSize:12,fontWeight:600,fontFamily:"'Syne',sans-serif",color:'var(--text)'}}>{sz}</div>
                  <div style={{fontSize:10,fontFamily:"'DM Mono',monospace",color:'var(--text3)',marginTop:1}}>{box}</div>
                </div>
              ))}
            </div>
          </div>
          {/* File browser – full width */}
          <div>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8,flexWrap:'wrap'}}>
              <span style={{fontSize:11,fontWeight:500,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'.06em'}}>
                Files <span style={{color:'var(--text2)',fontFamily:"'DM Mono',monospace"}}>{filteredFiles.length}/{prodFiles.length}</span>
              </span>
              <div style={{display:'flex',gap:6,flexWrap:'wrap',marginLeft:'auto'}}>
                {[['all','All'],['indd','INDD'],['idml','IDML'],['print','Print']].map(([v,l])=>(
                  <button key={v} className={'filter-chip '+(fileType===v?'active':'')} onClick={()=>setFileType(v)}>{l}</button>
                ))}
                <div style={{width:1,background:'var(--border2)',margin:'0 2px'}}/>
                <button className={'filter-chip '+(showWip==='wip'?'active-wip':'')} onClick={()=>setShowWip(showWip==='wip'?'all':'wip')}>WIP</button>
              </div>
            </div>
            {filteredFiles.length===0?(
              <div style={{color:'var(--text3)',fontSize:13,fontStyle:'italic',padding:'12px 0'}}>No files match.</div>
            ):(
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
                        <td><div className="file-actions">
                          <button className="btn btn-ghost btn-indesign btn-sm" onClick={()=>api.openFile(f.path)}><Icon.Open/></button>
                          <button className="btn btn-folder btn-sm" onClick={()=>api.revealFile(f.path)}><Icon.Folder/></button>
                        </div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
function LabelsBrowser({map,config}){
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
    if(filterSize==='1kg-1l')return p.startsWith('1kg')||p.startsWith('1l');
    if(filterSize==='5kg-5l')return p.startsWith('5kg')||p.startsWith('5l');
    if(filterSize==='0.25')return p.startsWith('0.25');
    if(filterSize==='other')return !p.startsWith('1kg')&&!p.startsWith('1l')&&!p.startsWith('5kg')&&!p.startsWith('5l')&&!p.startsWith('0.25');
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
          {[['all','All sizes',null],['1kg-1l','1kg / 1L',null],['5kg-5l','5kg / 5L',null],['0.25','0.25kg / 0.25L',null],['other','Other',null]].map(([v,lbl])=>(
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
                    <td>{cat!=='?'&&<span className="topbar-badge" style={{background:cat==='PAM'?'rgba(255,159,71,.15)':'rgba(75,191,255,.15)',color:cat==='PAM'?'var(--pam)':'var(--mo)'}}>{cat}</span>}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",fontSize:12}}>{f.languages?.join(' . ')??'--'}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",fontSize:12}}>{f.packaging??'--'}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:'var(--text3)'}}>{f.date??'--'}</td>
                    <td><div style={{display:'flex',gap:4,alignItems:'center',flexWrap:'wrap'}}>
                      {f.print_file?<span className="topbar-badge" style={{background:'rgba(255,255,255,.07)',color:'var(--text)'}}>Print</span>:f.deze?<span className="topbar-badge badge-pam">Box</span>:<span className="topbar-badge badge-ok">Label</span>}
                      {!f.print_file&&(f.extension==='.idml'?<span className="topbar-badge" style={{background:'rgba(100,180,255,.15)',color:'#64B4FF'}}>IDML</span>:<span className="topbar-badge" style={{background:'rgba(224,64,160,.15)',color:'#E040A0'}}>InDesign</span>)}
                      {f.wip&&<span className="topbar-badge badge-wip">WIP</span>}
                    </div></td>
                    <td><div className="file-actions">
                      <button className="btn btn-ghost btn-indesign btn-sm" title="Open in InDesign" onClick={()=>api.openFile(f.path)}><Icon.Open/></button>
                      <button className="btn btn-folder btn-sm" title="Show in Explorer" onClick={()=>api.revealFile(f.path)}><Icon.Folder/></button>
                    </div></td>
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
function Settings({config,saveConfig,setConfig,refreshMap}){
  const [tab,setTab]=useState('languages');
  const [cfg,setCfg]=useState(config);
  const [saved,setSaved]=useState(false);
  const [newLang,setNewLang]=useState({code:'',name:'',flag:''});
  const [scanning,setScanning]=useState(false);
  const [resetting,setResetting]=useState(false);
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
  return(
    <div>
      <div className="settings-tabs">
        {['languages','general'].map(t=>(
          <button key={t} className={`settings-tab ${tab===t?'active':''}`} onClick={()=>setTab(t)}>
            {t.charAt(0).toUpperCase()+t.slice(1)}
          </button>
        ))}
      </div>
      {tab==='languages'&&(
        <div>
          <p className="section-title">Language list</p>
          <div style={{maxHeight:440,overflowY:'auto',paddingRight:4}}>
            {cfg.languages.map((l,i)=>(
              <div key={l.code+i} className="product-list-item">
                <label className="toggle"><input type="checkbox" checked={l.enabled} onChange={e=>updL(i,'enabled',e.target.checked)}/><span className="toggle-slider"/></label>
                <span style={{fontSize:18}}>{l.flag}</span>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:500,width:32,flexShrink:0}}>{l.code}</span>
                <span style={{flex:1,fontSize:13,color:'var(--text2)'}}>{l.name}</span>
                <button className="btn btn-danger btn-sm" onClick={()=>remL(i)}>x</button>
              </div>
            ))}
          </div>
          <div className="divider"/>
          <p className="section-title">Add language</p>
          <div className="flex gap-2 items-center">
            <input className="input" placeholder="Flag emoji" value={newLang.flag} onChange={e=>setNewLang({...newLang,flag:e.target.value})} style={{width:80}}/>
            <input className="input" placeholder="Code" value={newLang.code} onChange={e=>setNewLang({...newLang,code:e.target.value.toUpperCase()})} style={{width:80}}/>
            <input className="input" placeholder="Full name" value={newLang.name} onChange={e=>setNewLang({...newLang,name:e.target.value})} style={{flex:1}}/>
            <button className="btn btn-primary" onClick={addL}>Add</button>
          </div>
        </div>
      )}
      {tab==='general'&&(
        <div>
          <p className="section-title">File Map</p>
          <div className="card mb-3">
            <p style={{fontSize:13,color:'var(--text2)',marginBottom:12}}>
              Rescan the <span style={{fontFamily:"'DM Mono',monospace",color:'var(--text)'}}>~/labels</span> folder to rebuild the file map.
            </p>
            <button className="btn btn-ghost" onClick={handleScan} disabled={scanning}>
              {scanning?<><div className="spinner"/>Scanning...</>:<><Icon.Refresh/>Rescan now</>}
            </button>
          </div>
          <p className="section-title">Factory defaults</p>
          <div className="card mb-3">
            <p style={{fontSize:13,color:'var(--text2)',marginBottom:12}}>
              Reset all settings to their original factory defaults. Your file map is not affected.
            </p>
            <button className="btn btn-danger" onClick={resetToDefaults} disabled={resetting}>
              {resetting?<><div className="spinner"/>Resetting...</>:'Reset to factory defaults'}
            </button>
          </div>
        </div>
      )}
      {tab==='languages'&&(
        <div className="flex mt-4 gap-2 items-center">
          <button className="btn btn-primary" onClick={save}>Save changes</button>
          {saved&&<span style={{fontSize:12,color:'var(--success)'}}>Saved</span>}
        </div>
      )}
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
  const exportConfig=()=>{
    fetch('/api/export').then(r=>r.blob()).then(blob=>{
      const a=document.createElement('a');
      a.href=URL.createObjectURL(blob);
      a.download='etiketas_export.json';
      a.click();
      URL.revokeObjectURL(a.href);
    });
  };
  const moProds=(cfg?.products??[]).filter(p=>p.category==='MO').sort((a,b)=>a.name.localeCompare(b.name));
  const pamProds=(cfg?.products??[]).filter(p=>p.category==='PAM').sort((a,b)=>a.name.localeCompare(b.name));
  const ceProds=(cfg?.products??[]).filter(p=>p.category==='CE').sort((a,b)=>a.name.localeCompare(b.name));
  return(
    <div style={{display:'flex',flexDirection:'column',height:'100%',minHeight:0}}>
      <div style={{flexShrink:0}}>
        <div className="flex gap-3" style={{marginBottom:16,alignItems:'center'}}>
          {[['logos','Logos'],['qrcodes','QR Codes'],['templates','Templates']].map(([key,label])=>(
            <button key={key} className="btn btn-folder" onClick={()=>resDirs&&api.openFile(resDirs[key])}>
              <Icon.Folder/>{label}
            </button>
          ))}
          <button className="btn btn-ghost" style={{marginLeft:'auto'}} onClick={exportConfig} title="Download current product list and colors as a JSON file">
            ↓ Export config
          </button>
        </div>
        <div className="settings-tabs" style={{marginBottom:0}}>
          {['products','colors'].map(t=>(
            <button key={t} className={`settings-tab ${tab===t?'active':''}`} onClick={()=>setTab(t)}>
              {t.charAt(0).toUpperCase()+t.slice(1)}
            </button>
          ))}
        </div>
      </div>
      {tab==='products'&&(
        <div style={{display:'flex',flexDirection:'column',flex:1,minHeight:0}}>
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
        <div style={{display:'flex',flexDirection:'column',flex:1,minHeight:0}}>
          <p className="section-title" style={{flexShrink:0,marginBottom:4}}>Color schemes</p>
          <p style={{fontSize:12,color:'var(--text3)',marginBottom:12,flexShrink:0}}>Click a swatch to change its color. Colors save automatically. Up to 6 per product.</p>
          {colors===null?(
            <div className="spinner" style={{width:20,height:20}}/>
          ):(
            <>
              <div style={{flex:1,overflowY:'auto',paddingRight:4,minHeight:0}}>
                {[['MO',moProds],['PAM',pamProds]].map(([cat,prods])=>(
                  <div key={cat} style={{marginBottom:24}}>
                    <div style={{fontSize:11,fontWeight:500,color:cat==='PAM'?'var(--pam)':'var(--mo)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:10,fontFamily:"'DM Mono',monospace"}}>{cat}</div>
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
