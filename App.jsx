// App.jsx — FINAL CORRECTED VERSION
import React, { useEffect, useRef, useState } from "react";
import "./index.css"; 
import "./App.css"; 
import html2canvas from "html2canvas";

const DEFAULT_CONFIG = { cacheLines: 8, blockSize: 1, assoc: 2, type: "set", repl: "LRU", hitTime: 1, missPenalty: 20 };

function Dropdown({ value, onChange, options, label }){
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(()=>{
    const onDoc = (e)=>{ if(ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e)=>{ if(e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    return ()=>{ document.removeEventListener('pointerdown', onDoc); document.removeEventListener('keydown', onKey); };
  },[]);
  const current = options.find(o=> o.value === value) || options[0];
  return (
    <div className="dropdown" ref={ref} aria-label={label}>
      <button type="button" className="dropdown-trigger" onClick={()=> setOpen(o=>!o)}>
        {current?.label}
        <span className="chev">▾</span>
      </button>
      {open && (
        <div className="dropdown-menu" role="listbox">
          {options.map(opt=> (
            <div key={opt.value} role="option" aria-selected={opt.value===value}
                  className={`dropdown-item ${opt.value===value? 'active':''}`}
                  onClick={()=> { onChange(opt.value); setOpen(false); }}>
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function initLine() { return { valid:false, tag:null, stamp:0, insertedAt:0 }; }
function buildCache(cfg){
  const { cacheLines, assoc, type } = cfg;
  if(type === "fully") return Array(cacheLines).fill(0).map(()=> ({...initLine()}));
  if(type === "direct") return Array(cacheLines).fill(0).map(()=> [initLine()]);
  const sets = Math.max(1, Math.floor(cacheLines / Math.max(1, assoc)));
  return Array(sets).fill(0).map(()=> Array(assoc).fill(0).map(()=> initLine()));
}
function addressSplit(addr, cfg){
  const blockSize = Math.max(1, cfg.blockSize);
  const offsetBits = Math.max(0, Math.log2(blockSize) | 0);
  let numSets = cfg.type === "fully" ? 1 : cfg.type === "direct" ? cfg.cacheLines : Math.max(1, Math.floor(cfg.cacheLines / Math.max(1,cfg.assoc)));
  const indexBits = Math.max(0, Math.log2(Math.max(1, numSets)) | 0);
  const index = (addr >> offsetBits) & ((1<<indexBits)-1);
  const tag = addr >> (offsetBits + indexBits);
  return { tag, index, offset: addr & ((1<<offsetBits) - 1), setForUI: cfg.type === "fully" ? 0 : (cfg.type === "direct" ? index : index % numSets) };
}
function chooseVictimIndex(set, policy){
  if(set.length === 1) return 0;
  if(policy === "Random") return Math.floor(Math.random()*set.length);
  if(policy === "FIFO"){ let idx=0; for(let i=1;i<set.length;i++) if((set[i].insertedAt||0) < (set[idx].insertedAt||0)) idx=i; return idx; }
  let idx=0; for(let i=1;i<set.length;i++) if((set[i].stamp||0) < (set[idx].stamp||0)) idx=i; return idx;
}

export default function App(){
  const [cfg, setCfg] = useState(DEFAULT_CONFIG);
  const [cache, setCache] = useState(()=> buildCache(DEFAULT_CONFIG));
  const [traceText, setTraceText] = useState("3, 7, 3, 2, 9, 7, 1, 3");
  const [trace, setTrace] = useState([3,7,3,2,9,7,1,3]);
  const [stepIndex, setStepIndex] = useState(0);
  const [stats, setStats] = useState({hits:0,misses:0,total:0});
  const [globalCounter, setGlobalCounter] = useState(0);
  const [highlight, setHighlight] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [compact, setCompact] = useState(false);
  const [history, setHistory] = useState([]); // 1 for hit, 0 for miss
  const [usage, setUsage] = useState([]); 
  const intervalRef = useRef(null);
  const containerRef = useRef();

  useEffect(()=> {
    setCache(buildCache(cfg));
    setStepIndex(0);
    setStats({hits:0,misses:0,total:0});
    setGlobalCounter(0);
    setHighlight(null);
    setHistory([]);
    // initialize usage structure based on type
    if(cfg.type === "fully" || cfg.type === "direct"){
      setUsage(Array(cfg.cacheLines).fill(0));
    } else {
      const sets = Math.max(1, Math.floor(cfg.cacheLines / Math.max(1, cfg.assoc)));
      setUsage(Array.from({length:sets}, ()=> Array(cfg.assoc).fill(0)));
    }
  }, [cfg]);

  useEffect(()=>{
    if(playing) intervalRef.current = setInterval(()=> stepForward(), 600);
    else clearInterval(intervalRef.current);
    return ()=> clearInterval(intervalRef.current);
    // eslint-disable-next-line
  }, [playing, trace, cache, stepIndex]);

  // FIX 3: Updated regex to correctly handle commas AND spaces
  function parseTraceText(text){
    return text
      .split(/[\s,]+/) // Splits by one or more spaces, or one or more commas (e.g., "3, 7 ,3" works)
      .map(s=> s.trim())
      .filter(Boolean) // Remove any empty strings resulting from the split
      .map(s=> s.startsWith("0x")? parseInt(s,16) : Number(s))
      .map(n=> Number.isNaN(n)?0:Math.max(0,Math.floor(n)));
  }

  function loadTrace(){
    const arr = parseTraceText(traceText);
    setTrace(arr);
    setStepIndex(0);
    setStats({hits:0,misses:0,total:0});
    setGlobalCounter(0);
    setCache(buildCache(cfg));
    setHistory([]);
  }
  function generateRandom(len=10,maxAddr=31){
    const arr = Array.from({length:len}, ()=> Math.floor(Math.random()*(maxAddr+1)));
    setTrace(arr);
    // Standardized trace output to include comma and space
    setTraceText(arr.join(", "));
    setStepIndex(0);
    setStats({hits:0,misses:0,total:0});
    setGlobalCounter(0);
    setCache(buildCache(cfg));
    setHistory([]);
  }

  function stepForward(){
    if(stepIndex >= trace.length){ setPlaying(false); return; }
    const addr = trace[stepIndex];
    const { tag, setForUI } = addressSplit(addr, cfg);

    let setsCopy;
    if(cfg.type === "fully") setsCopy = cache.map(l=> ({...l}));
    else setsCopy = cache.map(arr=> arr.map(l=> ({...l})));

    let setObj = cfg.type === "fully" ? setsCopy : setsCopy[setForUI];
    let hitWay = -1;
    for(let i=0;i<setObj.length;i++){
      if(setObj[i].valid && setObj[i].tag === tag){ hitWay = i; break; }
    }

    const newStats = {...stats};
    let evicted = null;
    let freeIdx = -1; // New variable to track the way being written to
    
    if(hitWay !== -1){
      newStats.hits++;
      setObj[hitWay].stamp = globalCounter + 1;
      freeIdx = hitWay;
    } else {
      newStats.misses++;
      freeIdx = setObj.findIndex(l=> !l.valid);
      if(freeIdx === -1){ 
        const victim = chooseVictimIndex(setObj, cfg.repl); 
        evicted = {...setObj[victim], way:victim}; 
        freeIdx = victim; 
      }
      setObj[freeIdx].valid = true;
      setObj[freeIdx].tag = tag;
      setObj[freeIdx].stamp = globalCounter + 1;
      setObj[freeIdx].insertedAt = globalCounter + 1;
    }

    setCache(setsCopy);
    setStats({...newStats, total: newStats.hits + newStats.misses});
    setGlobalCounter(c=> c+1);
    setStepIndex(s=> s+1);

    // update history and usage
    setHistory(h=> [...h.slice(-59), hitWay !== -1 ? 1 : 0]);
    setUsage(prev=>{
      try{
        // The target index/way is now consistently tracked by freeIdx
        const targetWay = cfg.type === "direct" ? setForUI : freeIdx; 
        
        if(cfg.type === "fully" || cfg.type === "direct"){
          const arr = Array.isArray(prev) ? [...prev] : [];
          const idx = cfg.type === "direct" ? setForUI : freeIdx; 
          if(arr[idx] !== undefined) arr[idx] = (arr[idx]||0) + 1;
          return arr;
        } else {
          const copy = prev.map(row=> row.slice());
          if(copy[setForUI] && copy[setForUI][targetWay] !== undefined) copy[setForUI][targetWay] += 1;
          return copy;
        }
      } catch(e){ return prev; }
    });

    // Updated highlighting logic to use the correct way (freeIdx) for Misses/Evictions
    const highlightInfo = { 
        set:setForUI, 
        way: freeIdx, // Use freeIdx which is the target way for HIT or MISS/EVICT
        hit: hitWay !== -1, 
        evicted: !!evicted, 
        addr, tag 
    };
    setHighlight(highlightInfo);
    setTimeout(()=> setHighlight(null), 900);
  }

  function restartAll(){
    setCache(buildCache(cfg));
    setStepIndex(0);
    setStats({hits:0,misses:0,total:0});
    setGlobalCounter(0);
    setHighlight(null);
    setPlaying(false);
    setHistory([]);
  }

  function exportCSV(){
    const rows = [
      ["Parameter","Value"],
      ["CacheLines", cfg.cacheLines],
      ["BlockSize", cfg.blockSize],
      ["Assoc", cfg.assoc],
      ["Type", cfg.type],
      ["Repl", cfg.repl],
      [],
      ["Total", stats.total],
      ["Hits", stats.hits],
      ["Misses", stats.misses]
    ];
    const csv = rows.map(r=> r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "cache_stats.csv"; a.click();
  }

  function screenshot(){
    if(!containerRef.current) return;
    const body = document.body;
    body.classList.add('no-effects');
    const bg = getComputedStyle(document.body).backgroundColor || '#071127';
    window.scrollTo(0,0);
    html2canvas(containerRef.current, { backgroundColor: bg, scale: 2, useCORS:true, logging:false, windowWidth: document.documentElement.clientWidth, windowHeight: document.documentElement.clientHeight })
      .then(canvas=>{
        const a = document.createElement("a"); a.href = canvas.toDataURL("image/png"); a.download = "cache_snapshot.png"; a.click();
      })
      .finally(()=> body.classList.remove('no-effects'));
  }

  // FIX: Key listener updated to allow space input in text fields
  useEffect(()=>{
    const onKey = (e)=>{
      const focusedElement = document.activeElement;
      if (focusedElement.tagName === 'TEXTAREA' || focusedElement.tagName === 'INPUT') {
          return;
      }
      
      // Handle global shortcuts only if not typing in an input
      if(e.code === 'Space'){ e.preventDefault(); setPlaying(p=> !p); }
      if(e.key === 'n'){ stepForward(); }
      if(e.key === 'r'){ restartAll(); }
    };
    window.addEventListener('keydown', onKey);
    return ()=> window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line
  }, [stepForward]);


  // build display cells
  const displayCells = (() => {
    const cells = [];
    if(cfg.type === "fully"){
      for(let i=0;i<cache.length;i++) cells.push({ label:`Line ${i}`, line: cache[i], set:i, way:0 });
    } else {
      for(let s=0;s<cache.length;s++){
        for(let w=0; w<cache[s].length; w++){
          cells.push({ label:`S${s} / W${w}`, line: cache[s][w], set:s, way:w });
        }
      }
    }
    return cells;
  })();

  const minCell = compact ? 110 : 140;
  const gridStyle = { gridTemplateColumns: `repeat(auto-fit, minmax(${minCell}px, 1fr))` };

  // derived metrics
  const hitRate = stats.total ? (stats.hits / stats.total) : 0;
  const missRate = 1 - hitRate;
  const amat = (cfg.hitTime || 1) + missRate * (cfg.missPenalty || 0);

  // helpers for address visualization
  function toBinary(n, bits){ return (n >>> 0).toString(2).padStart(bits, '0'); }
  const nextAddr = stepIndex < trace.length ? trace[stepIndex] : null;
  let addrViz = null;
  if(nextAddr !== null){
    const blockSize = Math.max(1, cfg.blockSize);
    const offsetBits = Math.max(0, Math.log2(blockSize) | 0);
    let numSets = cfg.type === "fully" ? 1 : cfg.type === "direct" ? cfg.cacheLines : Math.max(1, Math.floor(cfg.cacheLines / Math.max(1,cfg.assoc)));
    const indexBits = Math.max(0, Math.log2(Math.max(1, numSets)) | 0);
    const tagBits = Math.max(1, 8 - (offsetBits + indexBits));
    const bin = toBinary(nextAddr, offsetBits + indexBits + tagBits);
    addrViz = { tag: bin.slice(0, tagBits), index: bin.slice(tagBits, tagBits + indexBits), offset: bin.slice(tagBits + indexBits) };
  }


  return (
    <div className="page-enhanced">
      <div className="bg-blobs" aria-hidden></div>

      <div className="topbar-enhanced">
        <div className="brand center">
          <div className="title-box">
            <h1 className="title">Cache Memory Simulator</h1>
            <div className="subtitle">Interactive visual demo — Direct | Set-associative | Fully</div>
          </div>
        </div>
      </div>

      <div className="container-enhanced" ref={containerRef}>
        <aside className="panel-left">
          <h2>Config</h2>
          <label>Cache lines</label>
          <input type="number" value={cfg.cacheLines} onChange={e=> setCfg(c=> ({...c, cacheLines: Math.max(1, +e.target.value||1)}))} />

          <label>Block size (bytes)</label>
          <input type="number" value={cfg.blockSize} onChange={e=> setCfg(c=> ({...c, blockSize: Math.max(1, +e.target.value||1)}))} />

          <label>Associativity (ways)</label>
          <input type="number" value={cfg.assoc} onChange={e=> setCfg(c=> ({...c, assoc: Math.max(1, +e.target.value||1)}))} />

          <label>Type</label>
          <Dropdown
            value={cfg.type}
            onChange={(val)=> setCfg(c=> ({...c, type: val}))}
            options={[
              { value:'direct', label:'Direct-mapped' },
              { value:'set', label:'Set-associative' },
              { value:'fully', label:'Fully-associative' }
            ]}
            label="Cache type"
          />

          <label>Replacement</label>
          <Dropdown
            value={cfg.repl}
            onChange={(val)=> setCfg(c=> ({...c, repl: val}))}
            options={[
              { value:'LRU', label:'LRU' },
              { value:'FIFO', label:'FIFO' },
              { value:'Random', label:'Random' }
            ]}
            label="Replacement policy"
          />

          <div className="grid-two">
            <div>
              <label>Hit time (cycles)</label>
              <input type="number" value={cfg.hitTime} onChange={e=> setCfg(c=> ({...c, hitTime: Math.max(0, +e.target.value||0)}))} />
            </div>
            <div>
              <label>Miss penalty (cycles)</label>
              <input type="number" value={cfg.missPenalty} onChange={e=> setCfg(c=> ({...c, missPenalty: Math.max(0, +e.target.value||0)}))} />
            </div>
          </div>

          <div className="panel-row button-group-center">
            <button className="btn primary" onClick={()=> { setCache(buildCache(cfg)); restartAll(); }}>Reset Cache</button>
            <button className="btn outline" onClick={()=> { setCfg(DEFAULT_CONFIG); setCache(buildCache(DEFAULT_CONFIG)); setTrace([3,7,3,2,9,7,1,3]); setTraceText("3, 7, 3, 2, 9, 7, 1, 3"); restartAll(); }}>Default</button>
          </div>

          <div className="panel-row button-group-center">
            <button className="btn tiny" onClick={()=> setCompact(c=>!c)}>{compact? "Expand layout":"Compact layout"}</button>
          </div>

          <div className="help">Tip: use small cache sizes (4–16) and assoc=2 or 4 for clear visuals.</div>
        </aside>

        <main className="panel-right">
          <div className="trace-panel">
            <textarea value={traceText} onChange={e=> setTraceText(e.target.value)} placeholder="Enter addresses (space or comma separated)"/>
            <div className="trace-controls">
              <button className="btn" onClick={loadTrace}>Load Trace</button>
              <button className="btn accent" onClick={()=> generateRandom(12,127)}>Random</button>
              <button className="btn" onClick={()=> setPlaying(p=>!p)}>{playing? "Pause":"Auto"}</button>
              <button className="btn" onClick={stepForward}>Next</button>
              <button className="btn outline" onClick={restartAll}>Restart</button>
            </div>
          </div>

          <section className="visual-panel">
            <div className="metrics">
              <div className="metric"><div className="k">Step</div><div className="v">{stepIndex} / {trace.length}</div></div>
              <div className="metric"><div className="k">Hit rate</div><div className="v good">{(hitRate*100).toFixed(1)}%</div></div>
              <div className="metric"><div className="k">Miss rate</div><div className="v bad">{(missRate*100).toFixed(1)}%</div></div>
              <div className="metric"><div className="k">AMAT</div><div className="v">{amat.toFixed(2)} cycles</div></div>
              <div className="spark" title="Green = hit, Red = miss (most recent on right)">
                <svg width="160" height="32" viewBox="0 0 160 32" aria-label="Recent hit/miss sparkline">
                  {history.map((h, i)=>{
                    const workingWidth = 150;
                    const margin = 5;
                    const maxIndex = Math.max(1, history.length - 1);
                    const x = margin + (i / maxIndex) * workingWidth;
                    const y = h ? 10 : 20; 
                    return <circle key={i} cx={x} cy={y} r={3} fill={h? '#10b981':'#ef4444'} opacity="0.9"/>;
                  })}
                </svg>
                <div className="spark-label">Recent hits/misses</div>
              </div>
            </div>

            {addrViz && (
              <div className="address-viz" title="Binary breakdown of the upcoming address">
                <div className="label">Next address: <strong>{nextAddr}</strong></div>
                <div className="bits">
                  <span className="tag">{addrViz.tag}</span>
                  {addrViz.index && <span className="index">{addrViz.index}</span>}
                  {addrViz.offset && <span className="offset">{addrViz.offset}</span>}
                </div>
                <div className="legend-mini"><span className="l tag">Tag</span><span className="l index">Index</span><span className="l offset">Offset</span></div>
              </div>
            )}
            <div className="cache-grid" style={gridStyle}>
              {displayCells.map((c, idx)=> (
                <div 
                    key={idx} 
                    className={`cell ${
                        highlight && highlight.set===c.set && highlight.way===c.way 
                            ? (highlight.hit 
                                ? 'hit' 
                                : highlight.evicted 
                                    ? 'evict' 
                                    : 'miss' 
                              ) 
                            : ''
                    }`} 
                    title={c.line && c.line.valid ? `Valid: ${c.line.valid}\nTag: ${c.line.tag}\nAge: ${globalCounter - (c.line.stamp||0)}` : 'Empty line'}
                >
                  <div className="cell-title">{c.label}</div>
                  <div className="cell-body">{c.line && c.line.valid ? `Tag ${c.line.tag}` : "--"}</div>
                  <div className="heat">
                    {Array.isArray(usage)
                      ? (Array.isArray(usage[0])
                          ? (()=>{ const v = usage[c.set]?.[c.way] || 0; const pct = Math.min(100, v*10); return <div className="bar" style={{width:pct+"%"}}/>; })()
                          : (()=>{ const v = usage[c.set] || 0; const pct = Math.min(100, v*10); return <div className="bar" style={{width:pct+"%"}}/>; })()
                        )
                      : null}
                  </div>
                </div>
              ))}
            </div>

            <div className="visual-footer">
              <div className="stats-mini">Total: <strong>{stats.total}</strong> • Hits: <strong className="good">{stats.hits}</strong> • Misses: <strong className="bad">{stats.misses}</strong></div>
              <div className="visual-actions">
                <button className="btn outline" onClick={exportCSV}>Export CSV</button>
                <button className="btn primary" onClick={screenshot}>Screenshot</button>
              </div>
            </div>

            <div className="legend">
              <span className="legend-item"><span className="badge green" /> Hit</span>
              <span className="legend-item"><span className="badge red" /> Miss</span>
              <span className="legend-item"><span className="badge orange" /> Evicted</span>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}