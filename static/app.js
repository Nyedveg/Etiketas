// Etiketas - Label Manager
// React components (JSX transpiled by Babel standalone)
const {useState, useEffect, useCallback, Fragment} = React;
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
  getDefaultConfig:()    => api.get('/api/config/default'),
  pickDir:         ()    => api.get('/api/pick_dir'),
  ingest:          (p)   => api.post('/api/ingest', {path:p}),
};

const scoreLabel = s => s>=75?{label:'Perfect',cls:'score-high'}:s>=50?{label:'Good',cls:'score-med'}:{label:'Fallback',cls:'score-low'};

const Icon = {
  Dashboard:()=><svg className="icon" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="6" height="6" rx="1.5"/><rect x="9" y="1" width="6" height="6" rx="1.5"/><rect x="1" y="9" width="6" height="6" rx="1.5"/><rect x="9" y="9" width="6" height="6" rx="1.5"/></svg>,
  New:()=><svg className="icon" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm1 6h2a1 1 0 010 2H9v2a1 1 0 01-2 0V9H5a1 1 0 010-2h2V5a1 1 0 012 0v2z"/></svg>,
  Browse:()=><svg className="icon" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3a1 1 0 011-1h3.586A1 1 0 017 2.293L7.707 3H13a1 1 0 011 1v8a1 1 0 01-1 1H3a1 1 0 01-1-1V3z"/></svg>,
  Settings:()=><svg className="icon" viewBox="0 0 16 16" fill="currentColor"><path fillRule="evenodd" d="M7.1 1.2a1 1 0 011.8 0l.5.9a5 5 0 011.2.7l1-.2a1 1 0 01.9 1.5l-.5.9c.1.4.1.8 0 1.2l.5.9a1 1 0 01-.9 1.5l-1-.2a5 5 0 01-1.2.7l-.5.9a1 1 0 01-1.8 0l-.5-.9A5 5 0 015.4 8.3l-1 .2a1 1 0 01-.9-1.5l.5-.9A5 5 0 014 4.9l-.5-.9a1 1 0 01.9-1.5l1 .2A5 5 0 016.6 2l.5-.9zM8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z" clipRule="evenodd"/></svg>,
  Refresh:()=><svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13"><path d="M13.6 2.4A7 7 0 102 8H1a7 7 0 013-5.8V1l3 2.5L4 6V4.5A5 5 0 108 3l-.8.1A5 5 0 0113 8a5 5 0 01-5 5 5 5 0 01-4.7-3.3L1.5 10A7 7 0 008 15a7 7 0 005.6-11.2l.5-1.4z"/></svg>,
  Open:()=><svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13"><path d="M9 2H3a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1V7l-5-5zM3 13V3h5v4h4v6H3z"/></svg>,
  Folder:()=><svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13"><path d="M2 3a1 1 0 011-1h3.586L8 3.414 8.707 3H13a1 1 0 011 1v8a1 1 0 01-1 1H3a1 1 0 01-1-1V3zm5.293 1H5V3H3v9h10V5H7.293z"/></svg>,
  Check:()=><svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M13.3 3.3a1 1 0 00-1.4 0L6 9.2 4.1 7.3a1 1 0 00-1.4 1.4l2.6 2.6a1 1 0 001.4 0l6.6-6.6a1 1 0 000-1.4z"/></svg>,
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
        <div className="content">
          {view==='dashboard'&&<Dashboard map={map} config={config} setView={setView} refreshMap={refreshMap}/>}
          {view==='new'&&<NewLabelWizard config={config} map={map} setMap={setMap}/>}
          {view==='browse'&&<LabelsBrowser map={map} config={config}/>}
          {view==='settings'&&<Settings config={config} saveConfig={saveConfig} setConfig={setConfig} refreshMap={refreshMap}/>}
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
          {id:'settings',label:'Settings',I:Icon.Settings}
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
  const titles={dashboard:'Dashboard',new:'New Label',browse:'Browse',settings:'Settings'};
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
        {[{label:'Total files',value:total,a:false},{label:'InDesign',value:indd,a:false},
          {label:'WIP labels',value:wip,a:true},{label:'Unsorted',value:unsorted,a:false}
        ].map(({label,value,a})=>(
          <div key={label} className="stat-card">
            <div className={`stat-value ${a?'stat-accent':''}`}>{value}</div>
            <div className="stat-label">{label}</div>
          </div>
        ))}
      </div>
      <div className="flex gap-3 mb-4" style={{alignItems:'center',flexWrap:'wrap'}}>
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
                      {!f.print_file&&<span className="topbar-badge" style={{background:'rgba(224,64,160,.15)',color:'#E040A0'}}>InDesign</span>}
                      {f.wip&&<span className="topbar-badge badge-wip">WIP</span>}
                    </div></td>
                    <td><div className="file-actions">
                      <button className="btn btn-ghost btn-sm" title="Open in InDesign" onClick={()=>api.openFile(f.path)}><Icon.Open/></button>
                      <button className="btn btn-ghost btn-sm" title="Show in Explorer" onClick={()=>api.revealFile(f.path)}><Icon.Folder/></button>
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
  const enabledProducts=(config?.products??[]).filter(p=>p.enabled);
  const enabledLangs=(config?.languages??[]).filter(l=>l.enabled);
  const productCfg=product?config.products.find(p=>p.name===product):null;
  const dimKey=productCfg?(productCfg.category==='PAM'?(productCfg.acidic?'PAM_acidic':'PAM_normal'):'MO'):null;
  const sizes=dimKey?(config?.packagingSizes?.[dimKey]??[]):[];
  const filtered=enabledProducts.filter(p=>p.name.toLowerCase().includes(search.toLowerCase()));
  useEffect(()=>{
    if(step!==4||!product||!languages.length||!size)return;
    setLoading(true);setSelectedLabel(0);setSelectedBox(0);
    api.findTemplate({product,languages,packagingSize:size}).then(info=>{setTmplInfo(info);setLoading(false);});
  },[step]);
  const reset=()=>{setStep(1);setProduct(null);setLanguages([]);setSize(null);setTmplInfo(null);setResult(null);setSearch('');setSelectedLabel(0);setSelectedBox(0);setReviewTab('template');};
  const toggleLang=code=>setLanguages(prev=>prev.includes(code)?prev.filter(c=>c!==code):prev.length<3?[...prev,code]:prev);
  const handleCreate=async()=>{
    setLoading(true);
    const cfg=await api.loadConfig();
    const labelPath=tmplInfo?.labels?.[selectedLabel]?.file?.path??null;
    const boxPath=tmplInfo?.boxes?.[selectedBox]?.file?.path??null;
    const res=await api.createLabel({product,languages,packagingSize:size,config:cfg,labelTemplatePath:labelPath,boxTemplatePath:boxPath});
    if(res.success){const m=await api.loadMap();setMap(m);}
    setResult(res);setLoading(false);setStep(5);
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
      {step<5&&(
        <div className="wizard-steps" style={{flexShrink:0}}>
          {['Product','Languages','Size','Review'].map((label,i)=>{
            const n=i+1,cls=n<step?'done':n===step?'active':'future';
            return(
              <Fragment key={n}>
                <div className="step-wrap">
                  <div className={'step-circle '+cls}>{n<step?<Icon.Check/>:n}</div>
                  <div className="step-label" style={{color:n===step?'var(--text)':'var(--text3)'}}>{label}</div>
                </div>
                {i<3&&<div className={'step-line '+(n<step?'done':'')}/>}
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
                  <span style={{padding:'1px 7px',borderRadius:3,fontSize:10,fontFamily:"'DM Mono',monospace",background:p.category==='PAM'?'rgba(255,159,71,.15)':'rgba(75,191,255,.15)',color:p.category==='PAM'?'var(--pam)':'var(--mo)'}}>{p.category}</span>
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
          <div style={{flexShrink:0,marginBottom:12,fontSize:13,color:'var(--text2)'}}>
            {productCfg?.category==='PAM'?'PAM (Adjuvant)':'MO (Biostimulant)'}
            {productCfg?.acidic&&<span className="acidic-badge" style={{marginLeft:8}}>acidic sizing</span>}
          </div>
          <div className="size-grid" style={{flexShrink:0}}>
            {sizes.map(s=>{
              const d=config?.dimensions?.[dimKey]?.[s];
              return(
                <div key={s} className={'size-card '+(size===s?'selected':'')}
                  onClick={()=>setSize(s)}
                  onDoubleClick={()=>{setSize(s);setStep(4);}}>
                  <div className="size-label">{s}</div>
                  <div className="size-dims">{d??'--'}</div>
                </div>
              );
            })}
          </div>
          <div className="flex mt-4 gap-2" style={{flexShrink:0}}>
            <button className="btn btn-ghost" onClick={()=>setStep(2)}>&larr; Back</button>
            <button className="btn btn-primary ml-auto" disabled={!size} onClick={()=>setStep(4)}>Next &rarr;</button>
          </div>
        </div>
      )}
      {step===4&&(
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
                            <button className="btn btn-ghost btn-sm" onClick={()=>api.openFile(f.path)}><Icon.Open/></button>
                            <button className="btn btn-ghost btn-sm" onClick={()=>api.revealFile(f.path)}><Icon.Folder/></button>
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
            <button className="btn btn-ghost" onClick={()=>setStep(3)}>&larr; Back</button>
            <button className="btn btn-primary ml-auto btn-lg" disabled={loading} onClick={handleCreate}>
              {loading?<><div className="spinner"/>Creating...</>:'Create Labels'}
            </button>
          </div>
        </div>
      )}
      {step===5&&result&&(
        <div style={{overflowY:'auto',flex:1}}>
          {result.success?(
            <div className="result-success">
              <div className="result-icon">&#10003;</div>
              <div className="result-title">Labels created!</div>
              <p style={{color:'var(--text2)',fontSize:13}}>Both files are ready in the labels folder.</p>
              <div className="result-files">
                {result.results?.map((r,i)=>(
                  <div key={i} className="result-file">
                    <div style={{fontSize:20,flexShrink:0}}>{r.type==='box_label'?'Box':'Label'}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div className="result-file-name">{r.filename}</div>
                      <div className="result-file-info">{r.type==='box_label'?'Box label':'Packaging label'}{r.template?' - from: '+r.template:' - no template'}</div>
                    </div>
                    <div className="flex gap-2">
                      <button className="btn btn-ghost btn-sm" onClick={()=>api.openFile(r.path)}>Open</button>
                      <button className="btn btn-ghost btn-sm" onClick={()=>api.revealFile(r.path)}>Reveal</button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-3 justify-between">
                <button className="btn btn-ghost" onClick={reset}>Create another</button>
                <button className="btn btn-primary" onClick={()=>window.location.reload()}>Done</button>
              </div>
            </div>
          ):(
            <div className="result-success">
              <div className="result-icon">&#10007;</div>
              <div className="result-title">Something went wrong</div>
              <div className="alert alert-error mt-3">{result.error}</div>
              <button className="btn btn-ghost mt-4" onClick={()=>setStep(4)}>&larr; Try again</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
function LabelsBrowser({map,config}){
  const [search,setSearch]=useState('');
  const [filterCat,setFilterCat]=useState('all');
  const [filterType,setFilterType]=useState('all');
  const [filterSize,setFilterSize]=useState('all');
  const [filterWip,setFilterWip]=useState('all');
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
    if(filterType==='print'&&!f.print_file)return false;
    if(filterType==='box'&&(f.print_file||!f.deze))return false;
    if(filterType==='label'&&(f.print_file||f.deze))return false;
    if(filterWip==='wip'&&!f.wip)return false;
    if(!sizeMatch(f))return false;
    return true;
  });
  return(
    <div>
      <div className="browser-filters">
        <div className="search-wrap" style={{width:260}}>
          <span className="search-icon">&#128269;</span>
          <input className="input" placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)}/>
        </div>
        {['all','PAM','MO'].map(v=>(
          <button key={v} className={'filter-chip '+(filterCat===v?'active':'')} onClick={()=>setFilterCat(v)}>{v==='all'?'All':v}</button>
        ))}
        <div style={{width:'100%',display:'flex',gap:8,flexWrap:'wrap',marginTop:6}}>
          {[['all','All types'],['box','Box'],['label','Label'],['print','Print']].map(([v,lbl])=>(
            <button key={v} className={'filter-chip '+(filterType===v?'active':'')} onClick={()=>setFilterType(v)}>{lbl}</button>
          ))}
          <div style={{width:1,background:'var(--border2)',margin:'0 2px'}}/>
          {[['all','All sizes'],['1kg-1l','1kg / 1L'],['5kg-5l','5kg / 5L'],['0.25','0.25kg / 0.25L'],['other','Other']].map(([v,lbl])=>(
            <button key={v} className={'filter-chip '+(filterSize===v?'active':'')} onClick={()=>setFilterSize(v)}>{lbl}</button>
          ))}
          <div style={{width:1,background:'var(--border2)',margin:'0 2px'}}/>
          <button className={'filter-chip '+(filterWip==='wip'?'active':'')} onClick={()=>setFilterWip(filterWip==='wip'?'all':'wip')}>WIP only</button>
          <span style={{marginLeft:'auto',fontSize:12,color:'var(--text3)',fontFamily:"'DM Mono',monospace",alignSelf:'center'}}>{filtered.length} files</span>
        </div>
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
                      {!f.print_file&&<span className="topbar-badge" style={{background:'rgba(224,64,160,.15)',color:'#E040A0'}}>InDesign</span>}
                      {f.wip&&<span className="topbar-badge badge-wip">WIP</span>}
                    </div></td>
                    <td><div className="file-actions">
                      <button className="btn btn-ghost btn-sm" title="Open in InDesign" onClick={()=>api.openFile(f.path)}><Icon.Open/></button>
                      <button className="btn btn-ghost btn-sm" title="Show in Explorer" onClick={()=>api.revealFile(f.path)}><Icon.Folder/></button>
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
  const [tab,setTab]=useState('products');
  const [cfg,setCfg]=useState(config);
  const [saved,setSaved]=useState(false);
  const [newLang,setNewLang]=useState({code:'',name:'',flag:''});
  const [newProd,setNewProd]=useState({name:'',category:'MO',acidic:false});
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
  const updP=(i,k,v)=>{const p=[...cfg.products];p[i]={...p[i],[k]:v};setCfg({...cfg,products:p});};
  const remP=i=>setCfg({...cfg,products:cfg.products.filter((_,j)=>j!==i)});
  const addP=()=>{if(!newProd.name.trim())return;setCfg({...cfg,products:[...cfg.products,{...newProd,enabled:true}]});setNewProd({name:'',category:'MO',acidic:false});};
  const updL=(i,k,v)=>{const l=[...cfg.languages];l[i]={...l[i],[k]:v};setCfg({...cfg,languages:l});};
  const remL=i=>setCfg({...cfg,languages:cfg.languages.filter((_,j)=>j!==i)});
  const addL=()=>{if(!newLang.code.trim()||!newLang.name.trim())return;setCfg({...cfg,languages:[...cfg.languages,{...newLang,enabled:true}]});setNewLang({code:'',name:'',flag:''});};
  const handleScan=async()=>{setScanning(true);await refreshMap();setScanning(false);};
  return(
    <div>
      <div className="settings-tabs">
        {['products','languages','general'].map(t=>(
          <button key={t} className={`settings-tab ${tab===t?'active':''}`} onClick={()=>setTab(t)}>
            {t.charAt(0).toUpperCase()+t.slice(1)}
          </button>
        ))}
      </div>
      {tab==='products'&&(
        <div>
          <p className="section-title">Product list</p>
          <div style={{maxHeight:460,overflowY:'auto',paddingRight:4}}>
            {cfg.products.map((p,i)=>(
              <div key={p.name+i} className="product-list-item">
                <label className="toggle"><input type="checkbox" checked={p.enabled} onChange={e=>updP(i,'enabled',e.target.checked)}/><span className="toggle-slider"/></label>
                <span style={{flex:1,fontSize:13,fontWeight:500,color:p.enabled?'var(--text)':'var(--text3)'}}>{p.name}</span>
                {p.category==='PAM'&&(
                  <label className="flex items-center gap-2" style={{cursor:'pointer',fontSize:12,color:'var(--text3)'}}>
                    <input type="checkbox" checked={p.acidic} onChange={e=>updP(i,'acidic',e.target.checked)} style={{accentColor:'var(--pam)'}}/>acidic
                  </label>
                )}
                <div className="pill-toggle">
                  {['PAM','MO'].map(cat=>(
                    <button key={cat} className={`pill-btn ${p.category===cat?'active-'+cat.toLowerCase():'inactive'}`} onClick={()=>updP(i,'category',cat)}>{cat}</button>
                  ))}
                </div>
                <button className="btn btn-danger btn-sm" onClick={()=>remP(i)}>x</button>
              </div>
            ))}
          </div>
          <div className="divider"/>
          <p className="section-title">Add product</p>
          <div className="flex gap-2 items-center">
            <input className="input" placeholder="Product name" value={newProd.name} onChange={e=>setNewProd({...newProd,name:e.target.value})} style={{flex:1}}/>
            <div className="pill-toggle">
              {['PAM','MO'].map(cat=>(
                <button key={cat} className={`pill-btn ${newProd.category===cat?'active-'+cat.toLowerCase():'inactive'}`} onClick={()=>setNewProd({...newProd,category:cat})}>{cat}</button>
              ))}
            </div>
            <button className="btn btn-primary" onClick={addP}>Add</button>
          </div>
        </div>
      )}
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
          <p className="section-title">Dimensions reference</p>
          <div className="card mb-3" style={{fontSize:13}}>
            {['PAM_normal','PAM_acidic','MO'].map(key=>(
              <div key={key} style={{marginBottom:16}}>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:'var(--text2)',marginBottom:8,textTransform:'uppercase',letterSpacing:'.05em'}}>{key.replace('_',' - ')}</div>
                <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
                  {Object.entries(cfg.dimensions?.[key]??{}).map(([sz,dims])=>(
                    <div key={sz} style={{background:'var(--surface2)',border:'1px solid var(--border2)',borderRadius:6,padding:'6px 12px',textAlign:'center'}}>
                      <div style={{fontSize:14,fontWeight:600,fontFamily:"'Syne',sans-serif"}}>{sz}</div>
                      <div style={{fontSize:11,fontFamily:"'DM Mono',monospace",color:'var(--text3)',marginTop:2}}>{dims}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="section-title">Box packaging reference</p>
          <div className="card" style={{fontSize:13}}>
            <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
              {[['1kg','1kgx10'],['5kg','5kgx2'],['0.5kg','0.5kgx20'],['0.25kg','0.25kgx40'],['1L','1Lx12'],['5L','5Lx4'],['0.25L','0.25Lx32']].map(([sz,box])=>(
                <div key={sz} style={{background:'var(--surface2)',border:'1px solid var(--border2)',borderRadius:6,padding:'6px 12px',textAlign:'center'}}>
                  <div style={{fontSize:14,fontWeight:600,fontFamily:"'Syne',sans-serif"}}>{sz}</div>
                  <div style={{fontSize:11,fontFamily:"'DM Mono',monospace",color:'var(--text3)',marginTop:2}}>{box}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {tab!=='general'&&(
        <div className="flex mt-4 gap-2 items-center">
          <button className="btn btn-primary" onClick={save}>Save changes</button>
          {saved&&<span style={{fontSize:12,color:'var(--success)'}}>Saved</span>}
        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
