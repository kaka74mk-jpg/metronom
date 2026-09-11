/* ============================================================
   MK STUDIO — MAIN APPLICATION LOGIC
   ============================================================ */

/* ---------- Core application ---------- */
const SUPABASE_URL="https://ufynbbtrvkdvdcozpzpg.supabase.co";
const SUPABASE_PUBLISHABLE_KEY="sb_publishable_uzXbeTG-OBU2MGZPKLhPLQ_GkH-AG5B";
const SUPABASE_TABLE="mk_studio_data";
const SUPABASE_RECORDINGS_BUCKET="mk-studio-recordings";
const sb=(window.supabase&&SUPABASE_PUBLISHABLE_KEY)?window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}):null;

const DB_KEY="studioMetronome_neon_v7";
let db=loadDB(), currentId=localStorage.getItem("studioMetronomeCurrent")||db.practices[0]?.id;
let bpm=80,targetBpm=120,meterTime="4/4",meterNote="quarter",rhythmPattern=[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],sound="classic",drums="off",special="normal";
let customNotes=JSON.parse(localStorage.getItem("metroCustomNotes")||"[]");
let audioCtx=null,metroRunning=false,sessionRunning=false,sessionStartedAt=0,sessionElapsed=0,nextBeatTime=0,beatIndex=0,schedulerTimer=null,sessionTimerTick=null,chart=null,period="week";
const ACTIVE_SESSION_KEY="mkStudioActiveSession_v1";
let practiceLiveIndicator=null,practiceToastTimer=null;
let tempoModifierTimer=null, tempoAutomationRunning=false;
let mediaRecorder=null,mediaStream=null,recordingChunks=[],recordingStartedAt=0,recordings=[]; let recordingAudioCtx=null,recordingSource=null,recordingProcessor=null,recordingBuffers=[],recordingSampleRate=44100,recordingStopping=false; let calendarCursor=new Date(); calendarCursor.setDate(1);
const noteDefs={
 quarter:{label:"Quarter",symbol:"♩",div:1},half:{label:"Half",symbol:"𝅝",div:2},dottedQuarter:{label:"Dotted Quarter",symbol:"♩.",div:1.5},
 eighth:{label:"Eighth",symbol:"♪",div:.5},sixteenth:{label:"Sixteenth",symbol:"♬",div:.25},triplet:{label:"Triplet",symbol:"♬",div:1/3},dottedEighth:{label:"Dotted Eighth",symbol:"♪.",div:.75},whole:{label:"Whole",symbol:"𝅝",div:4}
};
const soundDefs={classic:"Classic",soft:"Soft",sharp:"Sharp",beep:"Beep",digital:"Digital",wood:"Wood"};
const drumDefs={off:"Off",basic:"Basic Rock",rock:"Rock",disco:"Disco",halftime:"Half Time",shuffle:"Shuffle",jazz:"Jazz",latin:"Latin",funk:"Funk"};
const drumPatterns={
  off:[],
  basic:["K","","","","S","","","","K","","","","S","","",""],
  rock:["K","H","","H","S","H","K","H","K","H","","H","S","H","K","H"],
  disco:["K","H","","H","K","H","","H","K","H","","H","K","H","","H"],
  halftime:["K","","","","","","","","S","","","","","","",""],
  shuffle:["K","G","","G","S","G","K","G","K","G","","G","S","G","K","G"],
  jazz:["R","","H","","R","","H","","R","","H","","R","","H",""],
  latin:["K","","C","","","C","K","","K","","C","","","C","K",""],
  funk:["K","G","","S","","G","K","","K","","G","S","","G","K",""]
};
function getDrumPattern(){return drumPatterns[drums]||null}
const specialDefs={normal:"Normal",trill:"Trill",tremolo2:"Tremolo ×2",tremolo3:"Tremolo ×3",accelerando:"Accel.",ritardando:"Ritard.",marcato:"Marcato",staccato:"Staccato"};

function defaultDB(){return{version:7,practices:[{id:crypto.randomUUID(),name:"My Practice",target:120,sessions:[],settings:{},practiceDays:{},recordings:[]}]}}
function loadDB(){try{let x=JSON.parse(localStorage.getItem(DB_KEY)||"null");return x?.practices?x:defaultDB()}catch{return defaultDB()}}
let syncInFlight=null;
let syncQueued=false;
let cloudLoadInFlight=null;
let localDataRevision=Number(localStorage.getItem("mkStudioLocalRevision")||0);
function markLocalChange(){
  localDataRevision++;
  localStorage.setItem("mkStudioLocalRevision",String(localDataRevision));
  localStorage.setItem("mkStudioLocalDirtyAt",String(Date.now()));
}
function saveDB(skipSync=false){
  localStorage.setItem(DB_KEY,JSON.stringify(db));
  if(!skipSync)markLocalChange();
  renderAll();
  if(!skipSync)debouncedSync();
}
function saveDBFast(){localStorage.setItem(DB_KEY,JSON.stringify(db));markLocalChange();debouncedSync();}
function currentPractice(){let p=db.practices.find(x=>x.id===currentId);if(!p){p=db.practices[0];currentId=p?.id}return p}
function settings(){let p=currentPractice();return p.settings||(p.settings={})}
function saveSetting(k,v){settings()[k]=v;saveDB()}
function allSessions(){return db.practices.flatMap(p=>(p.sessions||[]).map(s=>({...s,practice:p.name,practiceId:p.id})))}
function allDays(){let out=new Set;allSessions().forEach(s=>out.add(localDateKey(s.date)));return out}
function localDateKey(d){let x=new Date(d);return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}`}
function formatMinutes(sec){sec=Number(sec)||0;let h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60);return h?`${h}h ${m}m`:`${m}m`}
function formatDuration(sec){sec=Math.floor(sec||0);return `${String(Math.floor(sec/60)).padStart(2,"0")}:${String(sec%60).padStart(2,"0")}`}
function escapeHTML(s){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}

function loadPracticeSettings(p){let s=p.settings||{};bpm=s.bpm||80;targetBpm=s.target||p.target||120;meterTime=s.meterTime||"4/4";meterNote=s.meterNote||"quarter";rhythmPattern=s.rhythmPattern||[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];sound=s.sound||"classic";drums=s.drums||"off";special=s.special||"normal";metroMuted=!!s.muted;customNotes=Array.isArray(s.customNotes)?s.customNotes:(JSON.parse(localStorage.getItem("metroCustomNotes")||"[]"));localStorage.setItem("metroCustomNotes",JSON.stringify(customNotes));let v=document.getElementById("bpmRange");if(v)v.value=bpm;let t=document.getElementById("targetRange");if(t)t.value=targetBpm;let ms=document.getElementById("meterSelect");if(ms){if([...ms.options].some(o=>o.value===meterTime))ms.value=meterTime;else{meterTime="4/4";ms.value="4/4"}}}
function toggleSidebar(){return false}
function renderPracticeList(){/* Seasons are now selected from the title-bar dropdown. */ renderSeasonDropdown()}
function renderSeasonDropdown(){
  const e=document.getElementById("seasonDropdown"); if(!e)return;
  e.innerHTML="";
  db.practices.forEach(p=>{
    const b=document.createElement("div");
    b.className="season-option "+(p.id===currentId?"active":"");
    b.setAttribute("role","option"); b.setAttribute("aria-selected",p.id===currentId?"true":"false");
    b.innerHTML=`<span class="season-option-icon" style="color:${p.color||"var(--cyan)"}"><i data-lucide="${p.icon||"music-2"}"></i></span><span class="season-option-name">${escapeHTML(p.name)}</span><span class="season-option-actions"><button class="season-edit" type="button" title="Edit season" aria-label="Edit ${escapeHTML(p.name)}"><i data-lucide="pencil"></i></button><button class="season-reset-btn" type="button" title="Reset season" aria-label="Reset ${escapeHTML(p.name)}"><i data-lucide="rotate-ccw"></i></button><button class="season-delete" type="button" title="Delete season" aria-label="Delete ${escapeHTML(p.name)}"><i data-lucide="trash-2"></i></button></span>`;
    b.onclick=(ev)=>{if(ev.target.closest('.season-option-actions'))return;selectSeason(p.id)};
    b.querySelector('.season-edit').onclick=(ev)=>{ev.stopPropagation();selectSeason(p.id);openEditSeason()};
    b.querySelector('.season-reset-btn').onclick=(ev)=>{ev.stopPropagation();resetSeason(p.id)};
    b.querySelector('.season-delete').onclick=(ev)=>{ev.stopPropagation();deleteSeason(p.id)};
    e.appendChild(b);
  });
  lucide.createIcons();
}
function selectSeason(id){
  if(!db.practices.some(x=>x.id===id))return;
  currentId=id; localStorage.setItem("studioMetronomeCurrent",currentId);
  loadPracticeSettings(currentPractice()); closeSeasonDropdown(); renderAll();
}
function toggleSeasonDropdown(e){
  e?.stopPropagation();
  const d=document.getElementById("seasonDropdown"),t=document.getElementById("currentName"); if(!d||!t)return;
  const open=d.classList.toggle("open"); t.setAttribute("aria-expanded",open?"true":"false");
  if(open)renderSeasonDropdown();
}
function closeSeasonDropdown(){const d=document.getElementById("seasonDropdown"),t=document.getElementById("currentName");if(d)d.classList.remove("open");if(t)t.setAttribute("aria-expanded","false")}
function renderHeader(){
  let p=currentPractice();if(!p)return;
  const name=document.querySelector("#currentName .title-season-text");
  if(name)name.textContent=p.name;
  document.getElementById("currentMeta").textContent=`${p.sessions.length} sessions • Target ${p.target} BPM`;
  let ts=document.getElementById("tickerSeason"),tr=document.getElementById("tickerRhythm");
  if(ts)ts.textContent=p.name.toUpperCase();
  if(tr)tr.textContent=`${meterTime} • ${noteDefs[meterNote]?.symbol||customNotes.find(n=>n.id===meterNote)?.symbol||"♩"}`;
  renderSeasonDropdown();
}
function setRangeFill(el,val,color){let min=Number(el.min),max=Number(el.max),pct=((Number(val)-min)/(max-min))*100;el.style.background=`linear-gradient(90deg,${color} 0%,${color} ${pct}%,#1b2538 ${pct}%,#1b2538 100%)`}
function setBpm(v,persist=true){
  bpm=Math.max(20,Math.min(300,Math.round(Number(v))));const r=document.getElementById("bpmRange");if(r)r.value=bpm;const d=document.getElementById("bpmDisplay");if(d)d.textContent=bpm;const vEl=document.getElementById("bpmValue");if(vEl)vEl.textContent=bpm;
  const fv=document.getElementById("focusTempoValue");if(fv)fv.textContent=bpm;const fb=document.getElementById("focusBpm");if(fb)fb.textContent=bpm;if(r)setRangeFill(r,bpm,"#00f5ff");settings().bpm=bpm;updateTarget();
  if(typeof updateTempoDirectionIndicator==="function")updateTempoDirectionIndicator();if(persist&&!realtimeApplying)saveDBFast();
}
function changeBpm(n){setBpm(bpm+n)}
function updateVolumeUI(persist=false){const e=document.getElementById("volume");if(!e)return;const v=Number(e.value)||0,pct=Math.max(0,Math.min(100,v*100));const out=document.getElementById("volumeValue");if(out)out.textContent=Math.round(pct)+"%";e.style.setProperty("--volume-fill",pct+"%");settings().volume=v;if(persist&&!realtimeApplying)saveDBFast()}
function setTarget(v,persist=true){targetBpm=Math.max(20,Math.min(300,Math.round(Number(v)||120)));let p=currentPractice();if(p)p.target=targetBpm;const value=document.getElementById("targetValue");if(value)value.textContent=targetBpm;const range=document.getElementById("targetRange");if(range){range.value=targetBpm;setRangeFill(range,targetBpm,"#b8ff3d")}if(persist&&!realtimeApplying)saveDB()}
function updateTarget(){let p=currentPractice();if(!p)return;targetBpm=p.target||120;const v=document.getElementById("targetValue");if(v)v.textContent=targetBpm;const r=document.getElementById("targetRange");if(r){r.value=targetBpm;setRangeFill(r,targetBpm,"#b8ff3d")}}
function renderVisual(){let n=Math.max(4,getRhythmPattern().length);document.getElementById("leds").innerHTML=Array.from({length:Math.min(n,16)},(_,i)=>`<span class="led ${i===0?"first":""}" id="led-${i}"></span>`).join("")}
function renderMeter(){document.getElementById("currentMeterDisplay").textContent=`${meterTime} • ${noteDefs[meterNote]?.symbol||customNotes.find(n=>n.id===meterNote)?.symbol||"♩"}`;renderNotes();let ms=document.getElementById("meterSelect");if(ms&&[...ms.options].some(o=>o.value===meterTime))ms.value=meterTime}
function renderNotes(){let e=document.getElementById("noteList");e.innerHTML="";Object.entries(noteDefs).forEach(([id,n])=>{let b=document.createElement("button");b.className="note-btn "+(meterNote===id?"active":"");b.innerHTML=`<span class="note-symbol">${n.symbol}</span>${n.label}`;b.onclick=()=>setMeterNote(id);e.appendChild(b)});customNotes.forEach(n=>{let b=document.createElement("button");b.className="note-btn "+(meterNote===n.id?"active":"");b.innerHTML=`<span class="note-symbol">${escapeHTML(n.symbol||"•")}</span>${escapeHTML(n.label)}`;b.onclick=()=>setMeterNote(n.id);e.appendChild(b)})}
function setMeterNote(v){meterNote=v;settings().meterNote=v;saveDB()}
function setMeterFromSelect(v){meterTime=v;settings().meterTime=v;saveDB()}
function applyCustomMeter(){let a=Number(document.getElementById("meterNum").value),b=Number(document.getElementById("meterDen").value);if(!a||!b)return;meterTime=`${a}/${b}`;settings().meterTime=meterTime;saveDB()}
function addCustomNote(){let label=document.getElementById("customNoteName").value.trim();let div=Number(document.getElementById("customNoteDiv").value);if(!label||!div)return;let n={id:"custom_"+crypto.randomUUID(),label,symbol:"•",div};customNotes.push(n);settings().customNotes=customNotes;localStorage.setItem("metroCustomNotes",JSON.stringify(customNotes));meterNote=n.id;settings().meterNote=meterNote;document.getElementById("customNoteName").value="";saveDB()}

function getRhythmPattern(){let active=[];rhythmPattern.forEach((x,i)=>{if(x)active.push(i/16)});return active.length?active:[0]}
function rhythmSymbol(v){return v===2?"♬":v===1?"♪":"·"}
function renderRhythm(){let e=document.getElementById("rhythmGrid");e.innerHTML="";for(let i=0;i<16;i++){let v=Number(rhythmPattern[i]||0),b=document.createElement("button");b.className="step "+(v?"on":"");b.innerHTML=`<span>${rhythmSymbol(v)}</span><small>${i+1}</small>`;b.title=v===0?"Rest":"Click to change note";b.onclick=()=>{rhythmPattern[i]=(v+1)%3;if(i===0&&rhythmPattern[i]===0)rhythmPattern[i]=1;settings().rhythmPattern=rhythmPattern;saveDB()};e.appendChild(b)}}
function loadRhythmPreset(n){let x={quarter:[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],eighth:[1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0],triplet:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,0],sixteenth:[1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0]}[n];rhythmPattern=x;settings().rhythmPattern=x;saveDB()}
function clearRhythm(){rhythmPattern=[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];settings().rhythmPattern=rhythmPattern;saveDB()}

function renderOptions(){
  renderOptionGroup("soundOptions",soundDefs,sound,v=>{sound=v;saveSetting("sound",v)});
  renderOptionGroup("drumOptions",drumDefs,drums,v=>{drums=v;saveSetting("drums",v)});
  renderOptionGroup("specialOptions",specialDefs,special,v=>{
    special=v;
    const isMobile=window.matchMedia?.("(max-width:760px)").matches;
    if(isMobile){
      settings().special=v;
      localStorage.setItem(DB_KEY,JSON.stringify(db));
      markLocalChange();
      debouncedSync();
      if(v==="accelerando"||v==="ritardando"){
        requestAnimationFrame(()=>{showTechniqueTempo(v);syncTechniqueTempoUI()});
      }else{
        stopTempoAutomation();
        hideTechniqueTempo();
      }
      renderOptions();
      return;
    }
    saveSetting("special",v);
    if(v==="accelerando"||v==="ritardando"){updateTempoDirectionIndicator(v==="accelerando"?"up":"down");showTechniqueTempo(v)}
    else{stopTempoAutomation();hideTechniqueTempo()}
  });
  syncTechniqueTempoUI();
}
function renderOptionGroup(id,defs,current,fn){let e=document.getElementById(id);e.innerHTML="";Object.entries(defs).forEach(([k,l])=>{let b=document.createElement("button");b.className="preset "+(k===current?"active":"");b.style.borderColor=k===current?"#00f5ff":"";b.textContent=l;b.onclick=()=>fn(k);e.appendChild(b)})}

function initAudio(){if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==="suspended")audioCtx.resume()}
function playClick(time,type="normal"){
  initAudio();
  const v=metroMuted?0:Math.max(0,Math.min(1,Number(document.getElementById("volume")?.value||.7)));
  if(v<=0)return;
  const accent=type==="accent", secondary=type==="secondary";
  const master=audioCtx.createGain();
  master.gain.setValueAtTime(0.0001,time);
  master.connect(audioCtx.destination);

  const presets={
    classic:{freq:1450,wave:"triangle",attack:.001,decay:accent?.075:.052,level:accent?.78:secondary?.30:.55,harm:1.00,noise:accent?.16:.10},
    soft:{freq:720,wave:"sine",attack:.003,decay:accent?.105:.075,level:accent?.55:secondary?.20:.38,harm:.55,noise:.025},
    sharp:{freq:2450,wave:"square",attack:.0005,decay:accent?.045:.028,level:accent?.72:secondary?.25:.58,harm:1.25,noise:accent?.20:.15},
    beep:{freq:980,wave:"sine",attack:.002,decay:accent?.13:.09,level:accent?.68:secondary?.24:.48,harm:.72,noise:0},
    digital:{freq:1800,wave:"square",attack:.0005,decay:accent?.060:.040,level:accent?.62:secondary?.22:.50,harm:1.45,noise:.055},
    wood:{freq:430,wave:"triangle",attack:.001,decay:accent?.115:.085,level:accent?.82:secondary?.32:.62,harm:.95,noise:accent?.24:.18}
  };
  const q=presets[sound]||presets.classic;
  const level=v*q.level;
  const body=audioCtx.createOscillator(), bg=audioCtx.createGain();
  body.type=q.wave;
  body.frequency.setValueAtTime(q.freq*(accent?1.08:1),time);
  body.frequency.exponentialRampToValueAtTime(q.freq*q.harm,time+q.decay);
  bg.gain.setValueAtTime(.0001,time);
  bg.gain.linearRampToValueAtTime(level,time+q.attack);
  bg.gain.exponentialRampToValueAtTime(.0001,time+q.decay);
  body.connect(bg);bg.connect(master);body.start(time);body.stop(time+q.decay+.015);

  if(sound!=="soft"&&sound!=="beep"){
    const o=audioCtx.createOscillator(),g=audioCtx.createGain();
    o.type=sound==="digital"?"square":"sine";
    o.frequency.setValueAtTime(q.freq*(sound==="wood"?2.15:2.45),time);
    o.frequency.exponentialRampToValueAtTime(q.freq*(sound==="wood"?1.5:1.65),time+Math.min(.035,q.decay));
    g.gain.setValueAtTime(level*(accent?.24:.13),time);
    g.gain.exponentialRampToValueAtTime(.0001,time+Math.min(.035,q.decay));
    o.connect(g);g.connect(master);o.start(time);o.stop(time+.045);
  }

  if(q.noise>0){
    const duration=sound==="wood"?.028:.014;
    const buffer=audioCtx.createBuffer(1,Math.max(1,Math.floor(audioCtx.sampleRate*duration)),audioCtx.sampleRate);
    const data=buffer.getChannelData(0);
    for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*Math.pow(1-i/data.length,2.4);
    const src=audioCtx.createBufferSource(),ng=audioCtx.createGain(),filter=audioCtx.createBiquadFilter();
    filter.type="bandpass";filter.frequency.value=sound==="wood"?1900:4300;filter.Q.value=sound==="wood"?1.4:1.8;
    ng.gain.setValueAtTime(level*q.noise,time);ng.gain.exponentialRampToValueAtTime(.0001,time+duration);
    src.buffer=buffer;src.connect(filter);filter.connect(ng);ng.connect(master);src.start(time);
  }
  master.gain.setValueAtTime(1.18,time);
  master.gain.exponentialRampToValueAtTime(.0001,time+q.decay+.02);
}

function syncTransportCards(){
  const card=document.getElementById("tempoDisplayCard");
  if(card){
    card.classList.toggle("is-running",!!metroRunning);
    card.setAttribute("aria-pressed",metroRunning?"true":"false");
  }
}
function openTargetEditor(){
  const p=currentPractice();
  const current=Number(targetBpm)||Number(p?.target)||120;
  const value=prompt("Target BPM",String(current));
  if(value===null)return;
  const next=Math.max(20,Math.min(300,Math.round(Number(value)||current)));
  setTarget(next);
}
function triggerTransportMagic(id){
  const el=document.getElementById(id); if(!el)return;
  el.classList.remove("mk-magic-burst"); void el.offsetWidth; el.classList.add("mk-magic-burst");
  setTimeout(()=>el.classList.remove("mk-magic-burst"),900);
}
function toggleMetro(){metroRunning?stopMetro():startMetro()}
function startMetro(){initAudio();metroRunning=true;beatIndex=0;nextBeatTime=audioCtx.currentTime+.05;schedulerTimer=setInterval(scheduler,40);triggerTransportMagic("tempoDisplayCard");document.getElementById("metroBtn").innerHTML='<i data-lucide="square"></i><span>Stop Metronome</span>';lucide.createIcons();syncTransportCards();if(!tempoAutomationRunning&&settings().autoTempo?.change)startTempoAutomation()}
function stopMetro(){
  const wasRunning=metroRunning;
  metroRunning=false;clearInterval(schedulerTimer);schedulerTimer=null;
  document.getElementById("metroBtn").innerHTML='<i data-lucide="play"></i><span>Start Metronome</span>';lucide.createIcons();
  if(tempoAutomationRunning)stopTempoAutomation();
  syncTransportCards();
  if(wasRunning&&sessionRunning)stopSession(true,false);
}
function scheduler(){if(!metroRunning)return;while(nextBeatTime<audioCtx.currentTime+.12){scheduleBeat(nextBeatTime);let pulse=getPulseSeconds();nextBeatTime+=pulse;beatIndex++}}
function getPulseSeconds(){let n=noteDefs[meterNote]||customNotes.find(x=>x.id===meterNote);let div=n?.div||1;let den=Number(meterTime.split("/")[1])||4;let quarterSec=60/bpm;return quarterSec*div*(4/den)}
function playNoise(time,duration,vol=.2){let buffer=audioCtx.createBuffer(1,Math.max(1,Math.floor(audioCtx.sampleRate*duration)),audioCtx.sampleRate),data=buffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;let src=audioCtx.createBufferSource(),g=audioCtx.createGain();src.buffer=buffer;g.gain.setValueAtTime(vol*(metroMuted?0:Number(document.getElementById("volume").value)),time);g.gain.exponentialRampToValueAtTime(.001,time+duration);src.connect(g);g.connect(audioCtx.destination);src.start(time)}
function playKick(time){let o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type="sine";o.frequency.setValueAtTime(150,time);o.frequency.exponentialRampToValueAtTime(45,time+.12);g.gain.setValueAtTime(.75*(metroMuted?0:Number(document.getElementById("volume").value)),time);g.gain.exponentialRampToValueAtTime(.001,time+.14);o.connect(g);g.connect(audioCtx.destination);o.start(time);o.stop(time+.14)}
function playSnare(time){playNoise(time,.07,.35);let o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type="square";o.frequency.setValueAtTime(180,time);g.gain.setValueAtTime(.22,time);g.gain.exponentialRampToValueAtTime(.001,time+.06);o.connect(g);g.connect(audioCtx.destination);o.start(time);o.stop(time+.06)}
function playDrum(time,type){if(type==="K")playKick(time);else if(type==="S")playSnare(time);else if(type==="H")playNoise(time,.025,.12);else if(type==="R")playNoise(time,.035,.1);else if(type==="C")playClick(time,"accent");else if(type==="G")playNoise(time,.015,.05)}

function scheduleBeat(t){
  const pat=getRhythmPattern(), pulse=getPulseSeconds(), bar=getBeatsPerBar(), isBarStart=(beatIndex%bar===0), drumPat=getDrumPattern();
  pat.forEach((off,i)=>{
    const et=t+pulse*off;
    let type=isBarStart&&i===0?"accent":"normal";
    if(special.startsWith("tremolo")){
      const mult=Number(special.slice(-1))||2;
      for(let k=0;k<mult;k++) playClick(et+(pulse/16)*(k+1),k===0?type:"secondary");
    } else if(special==="trill"){
      playClick(et,type); playClick(et+pulse/2,"secondary");
    } else {
      if(special==="grace") playClick(Math.max(audioCtx.currentTime,et-.045),"secondary");
      playClick(et,type);
    }
    const delay=Math.max(0,(et-audioCtx.currentTime)*1000);
    setTimeout(()=>highlightBeat(beatIndex*pat.length+i),delay);
  });
  pulseAtAudioTime(t,isBarStart);
  if(drumPat&&drumPat.length){
    const step=pulse/4;
    const beatInBar=beatIndex%bar;
    for(let k=0;k<4;k++){
      const globalStep=beatInBar*4+k;
      const dt=drumPat[globalStep%drumPat.length];
      if(dt) playDrum(t+k*step,dt);
    }
  }
}
function getBeatsPerBar(){let num=Number(meterTime.split("/")[0])||4;let n=noteDefs[meterNote]||customNotes.find(x=>x.id===meterNote);let div=n?.div||1;return Math.max(1,Math.round(num/div))}
const metroLeds=[];
function highlightBeat(i){
  const leds=metroLeds.length?metroLeds:document.querySelectorAll(".led");
  if(!leds.length)return;
  const idx=i%leds.length;
  for(let j=0;j<leds.length;j++)leds[j].classList.toggle("on",j===idx);
}

function toggleSession(){sessionRunning?stopSession(true):startSession()}
function getTodaySeasonSeconds(){const key=localDateKey(new Date()),p=currentPractice();return (p?.sessions||[]).filter(s=>localDateKey(s.date)===key).reduce((a,s)=>a+(Number(s.seconds)||0),0)}
function ensurePracticeLiveUI(){
  if(!practiceLiveIndicator){
    practiceLiveIndicator=document.createElement("div");
    practiceLiveIndicator.className="practice-live-indicator";
    practiceLiveIndicator.innerHTML='<span class="live-dot"></span><span>PRACTICE ACTIVE • CLICK TIMER TO STOP</span>';
    document.body.appendChild(practiceLiveIndicator);
  }
  return practiceLiveIndicator;
}
function showPracticeToast(title,detail,end=false){
  let t=document.getElementById("practiceToast");
  if(!t){t=document.createElement("div");t.id="practiceToast";t.className="practice-toast";document.body.appendChild(t)}
  t.className="practice-toast "+(end?"end ":"")+"show";
  t.innerHTML=`<div class="toast-title">${title}</div><div>${detail||""}</div>`;
  clearTimeout(practiceToastTimer);practiceToastTimer=setTimeout(()=>t.classList.remove("show"),3200);
}
function syncPracticeLiveUI(){
  const ind=ensurePracticeLiveUI();
  ind.classList.toggle("show",!!sessionRunning);
  document.body.classList.toggle("practice-active",!!sessionRunning);
  document.title=sessionRunning?"● PRACTICING • MK Studio":"MK Studio";
}
function persistActiveSession(){
  if(!sessionRunning||!currentId)return;
  localStorage.setItem(ACTIVE_SESSION_KEY,JSON.stringify({practiceId:currentId,startAt:sessionStartedAt,baseElapsed:sessionElapsed,savedAt:Date.now()}));
}
function clearActiveSession(){localStorage.removeItem(ACTIVE_SESSION_KEY)}
function restoreActiveSession(){
  try{
    const a=JSON.parse(localStorage.getItem(ACTIVE_SESSION_KEY)||"null");
    if(!a||a.practiceId!==currentId||!a.startAt)return false;
    sessionStartedAt=Number(a.startAt)||Date.now();
    sessionElapsed=Math.max(0,Number(a.baseElapsed)||0);
    sessionRunning=true;
    syncPracticeLiveUI();
    return true;
  }catch(e){localStorage.removeItem(ACTIVE_SESSION_KEY);return false}
}
function startSession(){
  if(sessionRunning)return;
  sessionRunning=true;sessionStartedAt=Date.now();sessionElapsed=0;
  triggerTransportMagic("practiceTimerCard");
  persistActiveSession();
  document.getElementById("sessionBtn").innerHTML='<i data-lucide="square"></i><span>End Practice</span>';
  lucide.createIcons();syncPracticeLiveUI();
  if(!window.matchMedia?.("(max-width:760px)").matches)showPracticeToast("PRACTICE STARTED","Your practice time is being tracked.");
  updateSessionTimer();
  if(navigator.vibrate)navigator.vibrate(35);
}
function stopSession(save=true,stopMetronome=true){
  if(!sessionRunning)return;
  sessionElapsed=Math.floor((Date.now()-sessionStartedAt)/1000);
  sessionRunning=false;clearActiveSession();
  if(sessionTimerTick){clearTimeout(sessionTimerTick);sessionTimerTick=null}
  if(stopMetronome)stopMetro();
  document.getElementById("sessionBtn").innerHTML='<i data-lucide="timer"></i><span>Start Practice</span>';
  lucide.createIcons();
  if(save&&sessionElapsed>=1)saveSession(sessionElapsed);
  syncPracticeLiveUI();
  if(window.matchMedia?.("(max-width:760px)").matches){
    const card=document.getElementById("practiceTimerCard"),state=document.getElementById("sessionTimerState");
    card?.classList.remove("running","is-running","session-live","mk-magic-burst");
    state?.classList.remove("session-live");
    if(state)state.textContent="Ready";
    document.querySelectorAll(".timer-box.season-running").forEach(x=>x.classList.remove("season-running"));
    document.getElementById("practiceToast")?.classList.remove("show");
    document.getElementById("practiceToast")?.remove();
    practiceLiveIndicator?.classList.remove("show");
    document.body.classList.remove("practice-active");
    document.title="MK Studio";
  }
  if(navigator.vibrate)navigator.vibrate([40,50,80]);
  updateSessionTimer();
}
function getLastSavedSessionSeconds(practice=currentPractice()){
  const sessions=Array.isArray(practice?.sessions)?practice.sessions:[];
  if(!sessions.length)return 0;
  const last=sessions[sessions.length-1];
  return Math.max(0,Number(last?.seconds)||0);
}
function restoreSavedSessionTimer(){
  if(sessionRunning)return;
  sessionElapsed=getLastSavedSessionSeconds();
}
function updateSessionTimer(){
  const e=document.getElementById("sessionTime"),day=document.getElementById("daySessionTime"),card=document.getElementById("practiceTimerCard"),state=document.getElementById("sessionTimerState");
  const current=sessionRunning?Math.floor((Date.now()-sessionStartedAt)/1000):sessionElapsed;
  const todayTotal=getTodaySeasonSeconds()+(sessionRunning?current:0);
  if(e)e.textContent=formatDurationLong(current);
  if(day)day.textContent=formatDurationLong(todayTotal);
  if(card)card.classList.toggle("running",sessionRunning);
  if(state)state.textContent=sessionRunning?"● Recording practice time":"Ready";
  if(!sessionRunning&&window.matchMedia?.("(max-width:760px)").matches){
    card?.classList.remove("running","is-running","session-live","mk-magic-burst");
    state?.classList.remove("session-live");
    document.querySelectorAll(".timer-box.season-running").forEach(x=>x.classList.remove("season-running"));
    document.getElementById("practiceToast")?.classList.remove("show");
    document.getElementById("practiceToast")?.remove();
    practiceLiveIndicator?.classList.remove("show");
    document.body.classList.remove("practice-active");
  }
  syncPracticeLiveUI();
  if(document.getElementById("focusOverlay")?.classList.contains("open")&&typeof updateFocusUI==="function")updateFocusUI();
  if(sessionRunning){clearTimeout(sessionTimerTick);sessionTimerTick=setTimeout(updateSessionTimer,250)}
}
function formatDurationLong(sec){sec=Math.max(0,Math.floor(Number(sec)||0));return `${String(Math.floor(sec/3600)).padStart(2,"0")}:${String(Math.floor((sec%3600)/60)).padStart(2,"0")}:${String(sec%60).padStart(2,"0")}`}
function saveSession(seconds){
  let p=currentPractice();if(!p)return;
  p.sessions=Array.isArray(p.sessions)?p.sessions:[];
  const rec={id:crypto.randomUUID(),date:new Date().toISOString(),seconds:Math.max(0,Math.floor(Number(seconds)||0)),bpm,meter:meterTime,rhythm:meterNote,sound,drums,special,metro:metroRunning};
  p.sessions.push(rec);
  p.practiceDays=p.practiceDays||{};
  p.practiceDays[localDateKey(new Date())]=true;
  localStorage.setItem(DB_KEY,JSON.stringify(db));
  markLocalChange();
  sessionElapsed=rec.seconds;
  renderAll();
  debouncedSync();
}

async function toggleRecording(){
  if(mediaRecorder?.state==="recording" || recordingProcessor || mediaStream || recordingStopping){
    stopRecording();
    return;
  }
  const panel=document.getElementById("panel-record"), tool=[...document.querySelectorAll(".tool")].find(x=>/Recordings/i.test(x.textContent||""));
  document.querySelectorAll(".panel").forEach(x=>x.classList.remove("open"));
  document.querySelectorAll(".tool").forEach(x=>x.classList.remove("active"));
  if(panel){panel.classList.add("open");if(tool)tool.classList.add("active");setTimeout(()=>panel.scrollIntoView({behavior:"smooth",block:"nearest"}),30)}
  await startRecording();
}
async function startRecording(){
  try{
    mediaStream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    recordingBuffers=[];
    recordingStopping=false;
    const AC=window.AudioContext||window.webkitAudioContext;
    if(!AC)throw new Error("Web Audio is not supported by this browser");
    recordingAudioCtx=new AC();
    if(recordingAudioCtx.state==="suspended")await recordingAudioCtx.resume();
    recordingSampleRate=recordingAudioCtx.sampleRate||44100;
    recordingSource=recordingAudioCtx.createMediaStreamSource(mediaStream);
    recordingProcessor=recordingAudioCtx.createScriptProcessor(4096,1,1);
    recordingProcessor.onaudioprocess=e=>{
      if(recordingStopping)return;
      const input=e.inputBuffer.getChannelData(0);
      recordingBuffers.push(new Float32Array(input));
    };
    const silentGain=recordingAudioCtx.createGain();
    silentGain.gain.value=0;
    recordingSource.connect(recordingProcessor);
    recordingProcessor.connect(silentGain);
    silentGain.connect(recordingAudioCtx.destination);
    recordingStartedAt=Date.now();
    updateRecordingUI(true);
    document.getElementById("recordStatus").textContent=metroRunning?"Recording with metronome":"Recording without metronome";
  }catch(e){console.error(e);mediaStream?.getTracks().forEach(t=>t.stop());mediaStream=null;updateRecordingUI(false);alert("Microphone permission is required for recording.\n\n"+(e?.message||""))}
}
function stopRecording(){
  if(recordingStopping)return;
  if(recordingProcessor||mediaStream){
    recordingStopping=true;
    try{recordingProcessor?.disconnect();recordingSource?.disconnect()}catch(e){}
    mediaStream?.getTracks().forEach(t=>t.stop());
    mediaStream=null;
    finishRecording();
  }else if(mediaRecorder?.state==="recording"){mediaRecorder.stop()}
}
function encodeWav(buffers,sampleRate){
  let length=0; for(const b of buffers)length+=b.length;
  const buffer=new ArrayBuffer(44+length*2),view=new DataView(buffer);
  const writeString=(o,str)=>{for(let i=0;i<str.length;i++)view.setUint8(o+i,str.charCodeAt(i))};
  writeString(0,"RIFF"); view.setUint32(4,36+length*2,true); writeString(8,"WAVE");
  writeString(12,"fmt "); view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
  view.setUint32(24,sampleRate,true); view.setUint32(28,sampleRate*2,true); view.setUint16(32,2,true); view.setUint16(34,16,true);
  writeString(36,"data"); view.setUint32(40,length*2,true);
  let offset=44;
  for(const b of buffers){for(let i=0;i<b.length;i++){const sample=Math.max(-1,Math.min(1,b[i]));view.setInt16(offset,sample<0?sample*0x8000:sample*0x7FFF,true);offset+=2}}
  return new Blob([view],{type:"audio/wav"});
}
function encodeMp3(buffers,sampleRate){
  if(!window.lamejs?.Mp3Encoder)throw new Error("MP3 encoder is not available");
  let length=0; for(const b of buffers)length+=b.length;
  const pcm=new Int16Array(length); let pos=0;
  for(const b of buffers){for(let i=0;i<b.length;i++){const sample=Math.max(-1,Math.min(1,b[i]));pcm[pos++]=sample<0?sample*0x8000:sample*0x7FFF}}
  const encoder=new lamejs.Mp3Encoder(1,sampleRate,128),mp3=[];
  const block=1152;
  for(let i=0;i<pcm.length;i+=block){const chunk=pcm.subarray(i,Math.min(i+block,pcm.length));const data=encoder.encodeBuffer(chunk);if(data.length)mp3.push(new Int8Array(data))}
  const end=encoder.flush();if(end.length)mp3.push(new Int8Array(end));
  return new Blob(mp3,{type:"audio/mpeg"});
}
function encodeAudioBufferToMp3(audioBuffer){
  const channel=audioBuffer.getChannelData(0);
  return encodeMp3([channel],audioBuffer.sampleRate||44100);
}
function updateRecordingUI(active){
  const main=document.getElementById("mainRecordBtn"),btn=document.getElementById("recordBtn"),badge=document.getElementById("recordLiveBadge"),metro=document.getElementById("tempoDisplayCard");
  if(metro){
    metro.classList.toggle("is-recording",!!active);
    let dot=metro.querySelector(".mk-recording-dot");
    if(!dot){dot=document.createElement("span");dot.className="mk-recording-dot";dot.setAttribute("aria-hidden","true");metro.appendChild(dot)}
    dot.hidden=!active;
  }
  if(main){main.classList.toggle("recording-active",active);main.innerHTML=active?'<i data-lucide="square"></i><span>Recording…</span>':'<i data-lucide="mic"></i><span>Record</span>'}
  if(btn){btn.classList.toggle("recording-active",active);btn.innerHTML=active?'<i data-lucide="square"></i><span>Recording…</span>':'<i data-lucide="mic"></i><span>Start Recording</span>'}
  if(badge){badge.classList.toggle("live",active);badge.innerHTML=active?'<span></span> RECORDING':'<span></span> READY'}
  lucide.createIcons();
}
async function uploadRecordingBlob(blob,recordingId,practiceId){
  if(!sb)return null;
  const {data:{user}}=await sb.auth.getUser();
  if(!user)return null;
  const ext=blob.type&&blob.type.includes("mpeg")?"mp3":(blob.type&&blob.type.includes("wav")?"wav":(blob.type&&blob.type.includes("mp4")?"m4a":"webm"));
  const path=`${user.id}/${practiceId}/${recordingId}.${ext}`;
  const {error}=await sb.storage.from(SUPABASE_RECORDINGS_BUCKET).upload(path,blob,{contentType:blob.type||"audio/mpeg",upsert:false});
  if(error)throw error;
  return path;
}
async function getRecordingUrl(storagePath){
  if(!sb||!storagePath)throw new Error("Cloud storage is not connected");
  const {data,error}=await sb.storage.from(SUPABASE_RECORDINGS_BUCKET).createSignedUrl(storagePath,3600);
  if(error)throw new Error(`Could not create cloud audio URL: ${error.message||error}`);
  if(!data?.signedUrl)throw new Error("Supabase returned no signed audio URL");
  return data.signedUrl;
}
function recordingWave(){
  const heights=[7,13,18,10,15,21,9,16,12,19,8,14,22,11,17,9,15,20,7,13,18,10,16,8,14,21,11,17,9,15,19,8,13,18,10,16,7,14,20,11,17,9,15,21,8,13,18,10];
  return heights.map(h=>`<i style="height:${h}px"></i>`).join("");
}
function recordingName(r){return `Take ${String(r.takeNumber||1).padStart(2,"0")}`}
async function finishRecording(){
  let blob;
  if(recordingBuffers.length){
    try{blob=encodeMp3(recordingBuffers,recordingSampleRate)}catch(mp3Error){console.warn("MP3 encoding failed, using WAV fallback",mp3Error);blob=encodeWav(recordingBuffers,recordingSampleRate)}
  }else{
    blob=new Blob(recordingChunks,{type:mediaRecorder?.mimeType||"audio/mpeg"});
  }
  const mime=blob.type||"audio/wav";
  const p=currentPractice();if(!p)return;
  p.recordings=p.recordings||[];
  const id=crypto.randomUUID(), takeNumber=p.recordings.length+1;
  const localUrl=URL.createObjectURL(blob);
  const rec={id,takeNumber,date:new Date().toISOString(),duration:Math.floor((Date.now()-recordingStartedAt)/1000),metro:metroRunning,mimeType:mime,size:blob.size,blobUrl:localUrl,uploading:true};
  p.recordings.push(rec); recordings=p.recordings;
  mediaStream?.getTracks().forEach(t=>t.stop()); mediaStream=null; mediaRecorder=null;
  try{recordingProcessor?.disconnect();recordingSource?.disconnect();}catch(e){}
  recordingProcessor=null; recordingSource=null;
  if(recordingAudioCtx){try{recordingAudioCtx.close()}catch(e){} recordingAudioCtx=null}
  recordingBuffers=[]; recordingStopping=false;
  updateRecordingUI(false);
  document.getElementById("recordStatus").textContent="Preparing take…";
  renderRecordings(); saveDB();
  try{
    const storagePath=await uploadRecordingBlob(blob,id,p.id);
    rec.storagePath=storagePath; delete rec.uploading; rec.blobUrl=localUrl; saveDB();
    await syncNow(true);
    document.getElementById("recordStatus").textContent="Take saved to cloud";
  }catch(e){
    console.error("Recording upload failed",e); delete rec.uploading; rec.uploadError=true; saveDB();
    document.getElementById("recordStatus").textContent="Take saved locally";
  }
  renderRecordings();
}
let recordingAudio=null,activeRecordingId=null;
async function ensureRecordingAudio(r){
  if(!r)throw new Error("Recording not found");
  let url=null;
  if(r.storagePath){
    url=await getRecordingUrl(r.storagePath);
    try{
      const response=await fetch(url,{cache:"no-store"});
      if(!response.ok)throw new Error(`Cloud audio download failed (${response.status})`);
      let cloudBlob=await response.blob();
      if(!cloudBlob.size)throw new Error("Cloud audio file is empty");
      if((r.mimeType||cloudBlob.type||"").toLowerCase().includes("wav") && !r._cloudBlobUrl){
        try{
          const AC=window.AudioContext||window.webkitAudioContext;
          if(AC&&window.lamejs?.Mp3Encoder){
            const ctx=new AC();
            const ab=await cloudBlob.arrayBuffer();
            const decoded=await ctx.decodeAudioData(ab.slice(0));
            const mp3Blob=encodeAudioBufferToMp3(decoded);
            await ctx.close();
            cloudBlob=mp3Blob;
          }
        }catch(convertError){console.warn("Legacy WAV to MP3 conversion failed",convertError)}
      }
      if(!r._cloudBlobUrl)r._cloudBlobUrl=URL.createObjectURL(cloudBlob);
      url=r._cloudBlobUrl;
    }catch(downloadError){
      console.warn("Cloud audio fetch failed, trying signed URL directly",downloadError);
    }
  }
  if(!url)url=r.blobUrl;
  if(!url)throw new Error("No audio source is available for this recording");
  if(!recordingAudio)recordingAudio=new Audio();
  recordingAudio.preload="auto";
  if(activeRecordingId!==r.id){
    recordingAudio.pause();
    recordingAudio.removeAttribute("src");
    recordingAudio.load();
    recordingAudio.src=url;
    activeRecordingId=r.id;
  }
  return recordingAudio;
}
async function toggleRecordingPlayback(id){
  const p=currentPractice(),r=(p?.recordings||[]).find(x=>x.id===id);if(!r)return;
  try{
    const a=await ensureRecordingAudio(r);
    if(a.paused){await a.play()}else a.pause();
    activeRecordingId=r.id; renderRecordings();
  }catch(e){
    console.error("Recording playback error:",e);
    const msg=e?.message||"Unknown playback error";
    alert(`This recording could not be played.\n\n${msg}`);
  }
}
function seekRecording(id,v){
  if(!recordingAudio||activeRecordingId!==id||!Number.isFinite(recordingAudio.duration))return;
  recordingAudio.currentTime=(Number(v)/100)*recordingAudio.duration;
}
function seekRecordingBy(id,seconds){
  if(!recordingAudio||activeRecordingId!==id||!Number.isFinite(recordingAudio.duration))return;
  recordingAudio.currentTime=Math.max(0,Math.min(recordingAudio.duration,recordingAudio.currentTime+seconds));
}
function setRecordingSpeed(id,v){
  if(!recordingAudio||activeRecordingId!==id)return;
  recordingAudio.playbackRate=Number(v)||1;
  const el=document.getElementById("speedValue_"+id);if(el)el.textContent=(Number(v)||1).toFixed(2)+"×";
}
function setRecordingVolume(id,v){
  if(!recordingAudio||activeRecordingId!==id)return;
  recordingAudio.volume=Math.max(0,Math.min(1,Number(v)));
  const el=document.getElementById("volumeValue_"+id);if(el)el.textContent=Math.round(recordingAudio.volume*100)+"%";
}
function toggleRecordingLoop(id){
  if(!recordingAudio||activeRecordingId!==id)return;
  recordingAudio.loop=!recordingAudio.loop;
  const b=document.getElementById("loopBtn_"+id);if(b)b.classList.toggle("active",recordingAudio.loop);
}
async function downloadRecording(id){
  const p=currentPractice(),r=(p?.recordings||[]).find(x=>x.id===id);if(!r)return;
  try{
    let blob=null;
    if(r.storagePath){
      const url=await getRecordingUrl(r.storagePath);
      const response=await fetch(url,{cache:"no-store"});
      if(!response.ok)throw new Error("Cloud download failed");
      blob=await response.blob();
    }else if(r.blobUrl){
      const response=await fetch(r.blobUrl);
      blob=await response.blob();
    }
    if(!blob||!blob.size)throw new Error("No audio file available");
    const ext=(r.mimeType||blob.type||"").includes("mpeg")?"mp3":((r.mimeType||blob.type||"").includes("wav")?"wav":"mp3");
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download=`MK-Studio-${String(r.takeNumber||1).padStart(2,"0")}.${ext}`;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){console.error(e);alert("Could not download this recording.\n\n"+(e.message||"Unknown error"))}
}
function renameRecording(id){
  const p=currentPractice(),r=(p?.recordings||[]).find(x=>x.id===id);if(!r)return;
  const current=recordingName(r);
  const name=prompt("Recording name:",current);
  if(name===null)return;
  const clean=name.trim();
  if(!clean)return;
  r.name=clean;saveDB();syncCloudImmediately();
}
async function deleteRecording(id){
  const p=currentPractice();
  if(!p)return;
  const index=(p.recordings||[]).findIndex(r=>r.id===id);
  if(index===-1)return;
  const r=p.recordings[index];
  const name=recordingName(r);
  if(!confirm(`Delete "${name}"?\n\nThis will permanently delete the recording.`))return;

  if(activeRecordingId===id&&recordingAudio){
    try{
      recordingAudio.pause();
      recordingAudio.removeAttribute("src");
      recordingAudio.load();
    }catch(e){}
    activeRecordingId=null;
  }

  if(r.storagePath&&sb){
    try{
      const {data:{user}}=await sb.auth.getUser();
      if(user){
        const {error}=await sb.storage
          .from(SUPABASE_RECORDINGS_BUCKET)
          .remove([r.storagePath]);
        if(error)throw error;
      }
    }catch(e){
      console.error("Cloud recording delete failed:",e);
      alert("The recording could not be deleted from cloud storage.\n\n"+(e?.message||"Unknown error"));
      return;
    }
  }

  if(r.blobUrl){try{URL.revokeObjectURL(r.blobUrl)}catch(e){}}
  if(r._cloudBlobUrl){try{URL.revokeObjectURL(r._cloudBlobUrl)}catch(e){}}

  p.recordings.splice(index,1);
  p.recordings.forEach((rec,i)=>{rec.takeNumber=i+1});
  recordings=p.recordings;

  saveDB();
  renderRecordings();
  const synced=await syncCloudImmediately();
  document.getElementById("recordStatus").textContent=synced?"Recording deleted":"Recording deleted locally";
  renderRecordings();
}
function formatPlayerTime(sec){return formatDuration(Math.max(0,Number(sec)||0))}
function renderRecordings(){
  const p=currentPractice(),e=document.getElementById("recordingsList"),count=document.getElementById("recordingCount");
  if(!e)return;
  const list=(p?.recordings||[]).slice(-12).reverse();
  if(count)count.textContent=list.length;
  e.innerHTML="";
  if(!list.length){e.innerHTML='<div class="record-empty"><i data-lucide="mic-off"></i><div>No takes yet</div><span>Press Record to capture your first practice take.</span></div>';lucide.createIcons();return}
  list.forEach(r=>{
    const playing=activeRecordingId===r.id&&!recordingAudio?.paused;
    const loaded=activeRecordingId===r.id&&recordingAudio;
    const progress=loaded&&Number.isFinite(recordingAudio.duration)&&recordingAudio.duration?((recordingAudio.currentTime/recordingAudio.duration)*100):0;
    const speed=loaded?recordingAudio.playbackRate:1;
    const volume=loaded?recordingAudio.volume:1;
    const loop=loaded&&recordingAudio.loop;
    const row=document.createElement("div");row.className="recording-card"+(playing?" playing":"");
    const cloud=r.storagePath?'<span class="cloud">● Cloud</span>':'<span class="local">● Local</span>';
    const state=r.uploading?'Uploading…':(r.uploadError?'Upload failed':'Saved');
    row.innerHTML=`<button class="record-play" onclick="toggleRecordingPlayback('${r.id}')" title="Play / pause"><i data-lucide="${playing?"pause":"play"}"></i></button>
      <div class="record-main">
        <div class="record-top"><span class="record-name">${escapeHTML(recordingName(r))}${r.metro?" · Metro":""}</span><span class="record-time">${formatDateTime(r.date)}</span></div>
        <div class="record-wave">${recordingWave()}</div>
        <input class="record-progress" type="range" min="0" max="100" value="${progress}" oninput="seekRecording('${r.id}',this.value)">
        <div class="record-meta"><span>${formatPlayerTime(loaded?recordingAudio?.currentTime:r.duration)} / ${formatPlayerTime(loaded&&recordingAudio?.duration?recordingAudio.duration:r.duration)}</span>${cloud}<span>${state}</span></div>
      </div>
      <div class="record-actions">
        <button class="small-btn" onclick="renameRecording('${r.id}')" title="Rename"><i data-lucide="pencil"></i></button>
        <button class="small-btn" onclick="downloadRecording('${r.id}')" title="Download"><i data-lucide="download"></i></button>
        <button class="small-btn" onclick="deleteRecording('${r.id}')" title="Delete"><i data-lucide="trash-2"></i></button>
      </div>
      <div class="record-expand">
        <div class="player-controls">
          <button class="player-btn" onclick="seekRecordingBy('${r.id}',-10)" title="Back 10 seconds"><i data-lucide="rotate-ccw"></i><span>10s</span></button>
          <button class="player-btn" onclick="seekRecordingBy('${r.id}',-5)" title="Back 5 seconds">−5</button>
          <button class="player-btn primary" onclick="toggleRecordingPlayback('${r.id}')" title="Play / pause"><i data-lucide="${playing?"pause":"play"}"></i></button>
          <button class="player-btn" onclick="seekRecordingBy('${r.id}',5)" title="Forward 5 seconds">+5</button>
          <button class="player-btn" onclick="seekRecordingBy('${r.id}',10)" title="Forward 10 seconds"><i data-lucide="rotate-cw"></i><span>10s</span></button>
          <button class="player-btn player-loop ${loop?"active":""}" id="loopBtn_${r.id}" onclick="toggleRecordingLoop('${r.id}')" title="Loop"><i data-lucide="repeat-2"></i></button>
          <label class="player-control-label">Speed <input id="speed_${r.id}" class="player-speed" type="range" min=".5" max="2" step=".05" value="${speed}" oninput="setRecordingSpeed('${r.id}',this.value)"><b id="speedValue_${r.id}">${speed.toFixed(2)}×</b></label>
          <label class="player-control-label">Vol <input id="volume_${r.id}" class="player-volume" type="range" min="0" max="1" step=".01" value="${volume}" oninput="setRecordingVolume('${r.id}',this.value)"><b id="volumeValue_${r.id}">${Math.round(volume*100)}%</b></label>
        </div>
        <div class="player-info"><span>Practice Take · ${formatPlayerTime(r.duration)}</span><span>10s / 5s · Loop · Speed · Volume · Download</span></div>
      </div>`;
    e.appendChild(row);
  });
  lucide.createIcons();
}
if(!window.__mkRecordingAudioBound){
  window.__mkRecordingAudioBound=true;
  document.addEventListener("timeupdate",e=>{
    if(e.target!==recordingAudio)return;
    const id=activeRecordingId;
    const progress=document.querySelector(`.recording-card.playing .record-progress`);
    if(progress&&Number.isFinite(recordingAudio.duration)&&recordingAudio.duration)progress.value=(recordingAudio.currentTime/recordingAudio.duration)*100;
    const meta=document.querySelector(`.recording-card.playing .record-meta span:first-child`);
    if(meta)meta.textContent=`${formatPlayerTime(recordingAudio.currentTime)} / ${formatPlayerTime(recordingAudio.duration)}`;
  });
  document.addEventListener("ended",e=>{
    if(e.target!==recordingAudio)return;
    const id=activeRecordingId;
    if(recordingAudio.loop)return;
    renderRecordings();
  });
}
function formatDateTime(d){return new Date(d).toLocaleString("en-US",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}

function periodSessions(){
  if(period==="calendar")period="month";
  const now=new Date(); let start;
  if(period==="week"){const day=(now.getDay()+6)%7;start=new Date(now);start.setDate(now.getDate()-day);start.setHours(0,0,0,0)}
  else if(period==="month")start=new Date(now.getFullYear(),now.getMonth(),1);
  else start=new Date(now.getFullYear(),0,1);
  return allSessions().filter(s=>{const d=new Date(s.date);return Number.isFinite(d.getTime())&&d>=start});
}
function setPeriod(v,b){
  period=v;const cal=document.getElementById("panel-calendar");
  if(v==="calendar"){if(cal)cal.style.display="block";renderCalendar()}else if(cal)cal.style.display="none";
  document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));if(b)b.classList.add("active");renderOverview();
}
function renderOverview(){
  const ss=periodSessions(),time=ss.reduce((a,s)=>a+(Number(s.seconds)||0),0),days=new Set(ss.map(s=>localDateKey(s.date)));
  document.getElementById("periodSessions").textContent=ss.length;document.getElementById("periodTime").textContent=formatMinutes(time);document.getElementById("periodDays").textContent=days.size;
  const now=new Date();let labels=[],vals=[];
  if(period==="week"){
    const monday=new Date(now),day=(now.getDay()+6)%7;monday.setDate(now.getDate()-day);monday.setHours(0,0,0,0);const map=new Map();
    ss.forEach(s=>{const k=localDateKey(s.date);map.set(k,(map.get(k)||0)+(Number(s.seconds)||0)/60)});
    for(let i=0;i<7;i++){const d=new Date(monday);d.setDate(monday.getDate()+i);labels.push(d.toLocaleDateString("en-US",{weekday:"short"}));vals.push(map.get(localDateKey(d))||0)}
  }else if(period==="month"){
    const last=new Date(now.getFullYear(),now.getMonth()+1,0).getDate(),map=new Map();ss.forEach(s=>{const d=new Date(s.date),k=d.getDate();map.set(k,(map.get(k)||0)+(Number(s.seconds)||0)/60)});
    for(let d=1;d<=last;d++){labels.push(String(d));vals.push(map.get(d)||0)}
  }else{
    const map=new Map();ss.forEach(s=>{const d=new Date(s.date);if(d.getFullYear()===now.getFullYear()){const k=d.getMonth();map.set(k,(map.get(k)||0)+(Number(s.seconds)||0)/60)}});
    for(let m=0;m<12;m++){labels.push(new Date(now.getFullYear(),m,1).toLocaleDateString("en-US",{month:"short"}));vals.push(map.get(m)||0)}
  }
  const canvas=document.getElementById("overviewChart");if(!canvas||typeof Chart==="undefined")return;const c=canvas.getContext("2d");
  if(chart){chart.data.labels=labels;chart.data.datasets[0].data=vals;chart.update("none");return}
  chart=new Chart(c,{type:"line",data:{labels,datasets:[{data:vals,borderColor:"#00f5ff",backgroundColor:"rgba(0,245,255,.08)",fill:true,tension:.25,pointRadius:1.5,pointHitRadius:8}]},options:{responsive:true,maintainAspectRatio:false,animation:false,normalized:true,plugins:{legend:{display:false}},interaction:{mode:"index",intersect:false},scales:{x:{grid:{color:"rgba(255,255,255,.03)"},ticks:{color:"#66728c",font:{size:7},autoSkip:true,maxTicksLimit:period==="month"?10:12}},y:{beginAtZero:true,grid:{color:"rgba(255,255,255,.03)"},ticks:{color:"#66728c",font:{size:7}}}}}});
}
function currentStats(){let s=currentPractice()?.sessions||[],bp=s.map(x=>Number(x.bpm)).filter(Boolean),total=s.reduce((a,x)=>a+(x.seconds||0),0);return{best:bp.length?Math.max(...bp):null,last:s.at(-1)?.bpm||null,avg:bp.length?Math.round(bp.reduce((a,b)=>a+b,0)/bp.length):null,total,longest:s.length?Math.max(...s.map(x=>x.seconds||0)):0}}
function calcStreak(sessions){let set=new Set(sessions.map(s=>localDateKey(s.date))),d=new Date(),n=0;while(set.has(localDateKey(d))){n++;d.setDate(d.getDate()-1)}return n}
function renderStats(){let s=currentStats(),days=allDays();document.getElementById("statBest").textContent=s.best||"—";document.getElementById("statLast").textContent=s.last||"—";document.getElementById("statAvg").textContent=s.avg||"—";document.getElementById("statSessions").textContent=currentPractice()?.sessions.length||0;document.getElementById("statTime").textContent=formatMinutes(s.total);document.getElementById("statStreak").textContent=calcStreak(currentPractice()?.sessions||[]);let a=allSessions(),bp=a.map(x=>Number(x.bpm)).filter(Boolean),t=a.reduce((x,s)=>x+(s.seconds||0),0);document.getElementById("allSessions").textContent=a.length;document.getElementById("allTime").textContent=formatMinutes(t);document.getElementById("allDays").textContent=days.size;document.getElementById("allBest").textContent=bp.length?Math.max(...bp):"—";document.getElementById("allAvg").textContent=bp.length?Math.round(bp.reduce((x,y)=>x+y,0)/bp.length):"—";document.getElementById("allStreak").textContent=calcStreak(a)}
function renderHistory(){let e=document.getElementById("historyList"),s=currentPractice()?.sessions||[];if(!s.length){e.innerHTML='<div class="notice">No sessions recorded yet.</div>';return}e.innerHTML='<div class="history-row"><div>Date</div><div>BPM</div><div>Time</div><div>Meter</div></div>';[...s].reverse().slice(0,25).forEach(x=>{let r=document.createElement("div");r.className="history-row";r.innerHTML=`<div>${formatDateTime(x.date)}</div><div>${x.bpm}</div><div>${formatDuration(x.seconds)}</div><div>${x.meter||"4/4"}</div>`;e.appendChild(r)})}
function changeCalendarMonth(delta){calendarCursor.setMonth(calendarCursor.getMonth()+delta);renderCalendar()}
function renderCalendar(){const y=calendarCursor.getFullYear(),m=calendarCursor.getMonth(),names=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];document.getElementById("calMonth").textContent=new Date(y,m,1).toLocaleDateString("en-US",{month:"long",year:"numeric"});document.getElementById("calendarWeekdays").innerHTML=names.map(x=>`<div>${x}</div>`).join("");const first=new Date(y,m,1).getDay(),last=new Date(y,m+1,0).getDate(),sessions=allSessions().filter(s=>{let d=new Date(s.date);return d.getFullYear()===y&&d.getMonth()===m}),byDay={};sessions.forEach(s=>{let d=new Date(s.date).getDate();(byDay[d]??=[]).push(s)});let html="";for(let i=0;i<first;i++)html+='<div class="calendar-cell empty"></div>';for(let d=1;d<=last;d++){let a=byDay[d]||[],t=new Date(),today=t.getFullYear()===y&&t.getMonth()===m&&t.getDate()===d,mins=Math.round(a.reduce((x,s)=>x+(s.seconds||0),0)/60);html+=`<div class="calendar-cell ${a.length?"practiced":""} ${today?"today":""}"><span class="num">${d}</span>${a.length?'<span class="check">✓</span>':""}${mins?`<span class="mins">${mins}m</span>`:""}</div>`}document.getElementById("calendarGrid").innerHTML=html;document.getElementById("calMonthSessions").textContent=sessions.length;document.getElementById("calMonthTime").textContent=formatMinutes(sessions.reduce((a,x)=>a+(x.seconds||0),0));document.getElementById("calMonthDays").textContent=new Set(sessions.map(s=>localDateKey(s.date))).size}

function toggleSection(id){
  const card=document.getElementById(id); if(!card)return;
  const collapsed=card.classList.toggle("collapsed");
  const btn=card.querySelector(".section-collapse");
  if(btn)btn.setAttribute("aria-expanded",collapsed?"false":"true");
  localStorage.setItem("mkStudioCollapse_"+id,collapsed?"1":"0");
}
function restoreSectionState(){
  ["practiceOverview","historyCard","statsCard"].forEach(id=>{
    const card=document.getElementById(id); if(!card)return;
    const saved=localStorage.getItem("mkStudioCollapse_"+id);
    const collapsed=saved===null ? true : saved==="1";
    card.classList.toggle("collapsed",collapsed);
    const btn=card.querySelector(".section-collapse");
    if(btn)btn.setAttribute("aria-expanded",collapsed?"false":"true");
  });
}
let __mkBeatNodes=null;
function pulseMetroCard(accent=false){
  if(!metroRunning)return;
  const cls=accent?"beat-accent":"beat-pulse";
  if(!__mkBeatNodes||!__mkBeatNodes.length){__mkBeatNodes=document.querySelectorAll(".tempo-display-card,.metro-visual,.practice-timer-card")}
  const nodes=__mkBeatNodes;
  nodes.forEach(n=>{n.classList.remove("mk-beat-sync");n.classList.add("mk-beat-sync")});
  clearTimeout(window.__metroPulseClear);
  window.__metroPulseClear=setTimeout(()=>nodes.forEach(n=>n.classList.remove("mk-beat-sync")),110);
  const card=document.querySelector(".tempo-display-card");
  if(card){card.classList.remove("beat-pulse","beat-accent");card.classList.add(cls);clearTimeout(window.__metroPulseCardClear);window.__metroPulseCardClear=setTimeout(()=>card.classList.remove("beat-pulse","beat-accent"),130)}
}
function pulseAtAudioTime(time,accent=false){
  if(!audioCtx)return;
  const delay=Math.max(0,(time-audioCtx.currentTime)*1000);
  setTimeout(()=>{if(metroRunning)pulseMetroCard(accent)},delay);
}

function toggleDashboardMenu(){
  const m=document.getElementById("dashboardMenu"); if(!m)return;
  m.classList.toggle("open");
  if(m.classList.contains("open"))restoreSectionState();
}
let metroMuted=false;
function toggleMute(){
  metroMuted=!metroMuted;
  const b=document.getElementById("muteBtn");
  if(b){b.classList.toggle("active",metroMuted);b.innerHTML=metroMuted?'<i data-lucide="volume-x"></i><span>Muted</span>':'<i data-lucide="volume-2"></i><span>Mute</span>';lucide.createIcons()}
  settings().muted=metroMuted;saveDB();
}
function renderAll(){let p=currentPractice();if(p)loadPracticeSettings(p);renderPracticeList();renderHeader();setBpm(bpm,false);updateVolumeUI(false);updateTarget();renderVisual();metroLeds.length=0;document.querySelectorAll(".led").forEach(x=>metroLeds.push(x));renderMeter();renderRhythm();renderOptions();renderStats();renderHistory();renderOverview();renderCalendar();renderRecordings();updateSessionTimer();const mb=document.getElementById("muteBtn");if(mb){mb.classList.toggle("active",metroMuted);mb.innerHTML=metroMuted?'<i data-lucide="volume-x"></i><span>Muted</span>':'<i data-lucide="volume-2"></i><span>Mute</span>'}lucide.createIcons()}
function togglePanel(name,btn){let p=document.getElementById("panel-"+name),open=p.classList.contains("open");document.querySelectorAll(".panel").forEach(x=>x.classList.remove("open"));document.querySelectorAll(".tool").forEach(x=>x.classList.remove("active"));if(!open){p.classList.add("open");btn.classList.add("active")}}

function openNew(){document.getElementById("practiceModal").classList.add("open");setTimeout(()=>document.getElementById("newName").focus(),80)}
function closeModal(){document.getElementById("practiceModal").classList.remove("open")}
function createPractice(){let name=document.getElementById("newName").value.trim(),target=Number(document.getElementById("newTarget").value)||120,color=document.getElementById("newColor")?.value||"#00f5ff",icon=document.getElementById("newIcon")?.value||"music-2";if(!name)return;let p={id:crypto.randomUUID(),name,target,color,icon,sessions:[],settings:{},practiceDays:{},recordings:[]};db.practices.push(p);currentId=p.id;localStorage.setItem("studioMetronomeCurrent",currentId);closeModal();document.getElementById("newName").value="";saveDB()}
async function deleteSeason(id){let p=db.practices.find(x=>x.id===id);if(!p)return;if(!confirm(`Delete season "${p.name}"? This will permanently remove its sessions, recordings, settings and statistics.`))return;const wasCurrent=id===currentId;db.practices=db.practices.filter(x=>x.id!==id);if(!db.practices.length){db=defaultDB()}if(wasCurrent||!db.practices.some(x=>x.id===currentId)){currentId=db.practices[0].id;localStorage.setItem("studioMetronomeCurrent",currentId)}loadPracticeSettings(currentPractice());saveDB(true);try{await syncCloudImmediately()}catch{}renderAll()}
function renameCurrent(){openEditSeason()}
async function deleteCurrentSeason(){
  const p=currentPractice();
  if(!p)return;
  closeEditSeason();
  await deleteSeason(p.id);
}
function clearCurrentHistory(){let p=currentPractice();if(!p?.sessions.length||!confirm("Clear this Season history?"))return;p.sessions=[];p.practiceDays={};saveDB()}
function resetSeason(id=currentId){let p=db.practices.find(x=>x.id===id);if(!p)return;if(!confirm(`Reset "${p.name}"? Sessions, recordings and settings will be cleared.`))return;p.sessions=[];p.practiceDays={};p.recordings=[];p.settings={};p.target=120;if(id===currentId)loadPracticeSettings(p);saveDB()}
async function resetAll(){
  if(!confirm("Reset all MK Studio data? This will permanently clear all seasons, sessions, recordings, settings and cloud data for this account. This cannot be undone.")) return;
  try{
    stopMetro();
    if(mediaRecorder?.state === "recording") mediaRecorder.stop();
    if(mediaStream){ mediaStream.getTracks().forEach(t=>t.stop()); mediaStream=null; }
    db=defaultDB();
    currentId=db.practices[0]?.id;
    localStorage.setItem(DB_KEY,JSON.stringify(db));
    if(currentId)localStorage.setItem("studioMetronomeCurrent",currentId);
    localStorage.removeItem("mkStudioLocalDirtyAt");
    if(sb){
      const {data:{user}}=await sb.auth.getUser();
      if(user){
        const payload={user_id:user.id,data:db,updated_at:new Date().toISOString()};
        const {error}=await sb.from(SUPABASE_TABLE).upsert(payload,{onConflict:"user_id"});
        if(error) throw error;
      }
    }
    loadPracticeSettings(currentPractice());
    renderAll();
    setSync("Synced","All local and cloud data was reset.");
  }catch(e){
    console.error("Reset failed",e);
    localStorage.setItem("mkStudioLocalDirtyAt",String(Date.now()));
    alert("Cloud reset could not be completed. Your local reset was not discarded; existing cloud data was kept from being silently reloaded.");
    setSync("Local","Reset is local until cloud sync succeeds.");
  }
}
function openProfile(){let a=allSessions(),bp=a.map(s=>Number(s.bpm)).filter(Boolean),t=a.reduce((x,s)=>x+s.seconds,0);document.getElementById("profileEmail").textContent="Loading…";document.getElementById("profileSessions").textContent=a.length;document.getElementById("profileTime").textContent=formatMinutes(t);document.getElementById("profileSeasons").textContent=db.practices.length;document.getElementById("profileDays").textContent=allDays().size;document.getElementById("profileBest").textContent=bp.length?Math.max(...bp):"—";document.getElementById("profileModal").classList.add("open");loadUserEmail()}
function closeProfile(){document.getElementById("profileModal").classList.remove("open")}
function updateTempoDirectionIndicator(force){const el=document.getElementById("tempoDirectionIndicator"),arrow=document.getElementById("tempoArrow"),text=document.getElementById("tempoDirectionText");if(!el||!arrow||!text)return;let dir=0;if(tempoAutomationRunning){if(special==="accelerando")dir=1;else if(special==="ritardando")dir=-1}else if(force==="up"||force==="down")dir=force==="up"?1:-1;el.classList.remove("up","down","steady");if(dir>0){el.classList.add("up");arrow.textContent="↑";text.textContent="ACCELERATING"}else if(dir<0){el.classList.add("down");arrow.textContent="↓";text.textContent="RITARDANDO"}else{el.classList.add("steady");arrow.textContent="•";text.textContent="STEADY"}}
function techniqueTempoDirection(){
  return special==="ritardando" ? -1 : 1;
}
function showTechniqueTempo(kind){
  const box=document.getElementById("techniqueTempoBox");
  if(!box)return;
  box.style.display="block";
  const title=document.getElementById("techniqueTempoTitle");
  const direction=document.getElementById("techniqueTempoDirection");
  if(title)title.textContent=kind==="accelerando"?"Accelerando Tempo":"Ritardando Tempo";
  if(direction)direction.textContent=kind==="accelerando"?"Gradually increasing BPM":"Gradually decreasing BPM";
  const s=settings().autoTempo||{};
  const interval=Math.max(1,Number(s.interval)||5);
  const step=Math.max(1,Math.abs(Number(s.step??s.change))||1);
  const i=document.getElementById("techniqueTempoInterval");
  const st=document.getElementById("techniqueTempoStep");
  if(i)i.value=interval;
  if(st)st.value=step;
  syncTechniqueTempoUI();
}
function hideTechniqueTempo(){
  const box=document.getElementById("techniqueTempoBox");
  if(box)box.style.display="none";
}
function syncTechniqueTempoUI(){
  updateTempoDirectionIndicator();
  const box=document.getElementById("techniqueTempoBox");
  if(!box)return;
  const active=special==="accelerando"||special==="ritardando";
  if(!active){box.style.display="none";return}
  const dir=techniqueTempoDirection();
  const interval=Math.max(1,Number(document.getElementById("techniqueTempoInterval")?.value)||5);
  const step=Math.max(1,Math.abs(Number(document.getElementById("techniqueTempoStep")?.value)||1));
  const badge=document.getElementById("techniqueTempoBadge");
  const btn=document.getElementById("techniqueTempoBtn");
  const status=document.getElementById("techniqueTempoStatus");
  if(badge){badge.textContent=tempoAutomationRunning?"ACTIVE":"READY";badge.classList.toggle("active",tempoAutomationRunning)}
  if(btn){btn.textContent=tempoAutomationRunning?"■ Stop":"▶ Start";btn.classList.toggle("active",tempoAutomationRunning)}
  if(status)status.textContent=tempoAutomationRunning
    ? `Running: ${dir>0?"+":"−"}${step} BPM every ${interval}s.`
    : `Ready: ${dir>0?"+":"−"}${step} BPM every ${interval}s.`;
}
function stopTempoAutomation(){
  clearInterval(tempoModifierTimer);
  tempoModifierTimer=null;
  tempoAutomationRunning=false;
  syncTechniqueTempoUI();
}
function startTempoAutomation(){
  if(!(special==="accelerando"||special==="ritardando"))return false;
  const interval=Math.max(1,Number(document.getElementById("techniqueTempoInterval")?.value)||5);
  const step=Math.max(1,Math.abs(Number(document.getElementById("techniqueTempoStep")?.value)||1));
  const change=techniqueTempoDirection()*step;
  settings().autoTempo={interval,step,change,source:"technique"};
  clearInterval(tempoModifierTimer);
  tempoAutomationRunning=true;
  if(!metroRunning)startMetro();
  tempoModifierTimer=setInterval(()=>{
    if(!metroRunning)return;
    setBpm(bpm+change,false);
    saveDB();
  },interval*1000);
  saveDB();
  syncTechniqueTempoUI();
  return true;
}
function toggleTechniqueTempo(){
  if(tempoAutomationRunning)stopTempoAutomation();
  else startTempoAutomation();
}
function applyAutoTempo(){
  return startTempoAutomation();
}
function openSettings(){document.getElementById("settingsModal").classList.add("open");loadReminderUI()}
function closeSettings(){document.getElementById("settingsModal").classList.remove("open")}
function openBackup(){document.getElementById("backupModal").classList.add("open")}
function closeBackup(){document.getElementById("backupModal").classList.remove("open")}
function exportData(){let a=document.createElement("a"),u=URL.createObjectURL(new Blob([JSON.stringify(db,null,2)],{type:"application/json"}));a.href=u;a.download="studio-metronome-backup.json";a.click();URL.revokeObjectURL(u)}
function importData(e){let f=e.target.files[0];if(!f)return;let r=new FileReader();r.onload=()=>{try{let x=JSON.parse(r.result);if(!x||!Array.isArray(x.practices)||!x.practices.length)throw 0;x.version=Number(x.version)||7;x.practices=x.practices.map(p=>({...p,sessions:Array.isArray(p.sessions)?p.sessions:[],recordings:Array.isArray(p.recordings)?p.recordings:[],settings:p.settings&&typeof p.settings==="object"?p.settings:{},practiceDays:p.practiceDays&&typeof p.practiceDays==="object"?p.practiceDays:{}}));db=x;currentId=db.practices[0].id;localStorage.setItem("studioMetronomeCurrent",currentId);closeBackup();saveDB();alert("Backup imported and queued for cloud sync.")}catch{alert("Invalid backup file.")}finally{e.target.value=""}};r.readAsText(f)}

function openAuth(){document.getElementById("authModal").classList.add("open");document.getElementById("authEmail").focus()}
function closeAuth(){document.getElementById("authModal").classList.remove("open")}
function authMsg(t){const e=document.getElementById("authStatus");if(e)e.textContent=t}
async function signIn(){if(!sb)return authMsg("Supabase is unavailable.");const email=document.getElementById("authEmail").value.trim(),password=document.getElementById("authPassword").value;if(!email||!password)return authMsg("Enter your email and password.");authMsg("Signing in…");const {error}=await sb.auth.signInWithPassword({email,password});if(error)return authMsg(error.message);authMsg("Signed in. Loading your cloud data…");await loadCloudData();closeAuth();await loadUserEmail();}
async function signUp(){if(!sb)return authMsg("Supabase is unavailable.");const email=document.getElementById("authEmail").value.trim(),password=document.getElementById("authPassword").value;if(!email||password.length<6)return authMsg("Use a valid email and a password of at least 6 characters.");authMsg("Creating account…");const {data,error}=await sb.auth.signUp({email,password});if(error)return authMsg(error.message);if(data.session){await loadCloudData();closeAuth()}else authMsg("Account created. Check your email if confirmation is enabled.");}
async function signOut(){if(sb)await sb.auth.signOut();document.getElementById("authActionBtn").textContent="Sign In";loadUserEmail();setSync("Local","Signed out; local data remains available.")}
async function loadUserEmail(){if(!sb){document.getElementById("profileEmail").textContent="Local mode";return}try{let {data}=await sb.auth.getUser();const email=data?.user?.email;document.getElementById("profileEmail").textContent=email||"Not signed in";const b=document.getElementById("authActionBtn");if(b){b.textContent=email?"Sign Out":"Sign In";b.onclick=email?signOut:openAuth}}catch{document.getElementById("profileEmail").textContent="Not signed in"}}
let syncTimer=null;function debouncedSync(){clearTimeout(syncTimer);syncTimer=setTimeout(()=>syncNow(false),180)}
async function getCloudSnapshot(user){
  if(!sb||!user)return null;
  const {data,error}=await sb.from(SUPABASE_TABLE).select("data,updated_at").eq("user_id",user.id).maybeSingle();
  if(error)throw error;
  return data||null;
}
function applyRemoteSnapshot(remote,source="Realtime"){
  if(!remote?.data?.practices||realtimeApplying)return false;
  const remoteUpdatedAt=remote.updated_at||"";
  if(remoteUpdatedAt&&realtimeLastUpdatedAt&&new Date(remoteUpdatedAt)<=new Date(realtimeLastUpdatedAt))return false;
  const localDirtyAt=Number(localStorage.getItem("mkStudioLocalDirtyAt")||0);
  if(localDirtyAt && remoteUpdatedAt && new Date(remoteUpdatedAt).getTime() < localDirtyAt){
    setSync("Local changes","Your newer local changes are being synced…");
    debouncedSync();
    return false;
  }
  if(localDirtyAt && !remoteUpdatedAt){
    setSync("Local changes","Your latest local changes are being synced…");
    debouncedSync();
    return false;
  }
  try{
    realtimeApplying=true;
    db=remote.data;
    currentId=localStorage.getItem("studioMetronomeCurrent");
    if(!currentId||!db.practices.some(p=>p.id===currentId))currentId=db.practices[0]?.id;
    if(currentId)localStorage.setItem("studioMetronomeCurrent",currentId);
    localStorage.setItem(DB_KEY,JSON.stringify(db));
    loadPracticeSettings(currentPractice());
    restoreSavedSessionTimer();
    renderAll();
    restoreSectionState();
    realtimeLastUpdatedAt=remoteUpdatedAt||realtimeLastUpdatedAt;
    setSync(source,"Updated from another device.");
    return true;
  }finally{realtimeApplying=false}
}
async function loadCloudData(){
  if(!sb)return;
  if(cloudLoadInFlight)return cloudLoadInFlight;
  cloudLoadInFlight=(async()=>{
    try{
      const {data:{user}}=await sb.auth.getUser();
      if(!user)return;

      const revisionAtStart=Number(localStorage.getItem("mkStudioLocalRevision")||0);
      const dirtyAtStart=Number(localStorage.getItem("mkStudioLocalDirtyAt")||0);
      const remote=await getCloudSnapshot(user);

      const revisionNow=Number(localStorage.getItem("mkStudioLocalRevision")||0);
      const dirtyNow=Number(localStorage.getItem("mkStudioLocalDirtyAt")||0);
      if(dirtyNow || revisionNow!==revisionAtStart || dirtyAtStart){
        await syncNow(true);
        return;
      }

      if(remote?.data?.practices){
        db=remote.data;
        currentId=localStorage.getItem("studioMetronomeCurrent");
        if(!currentId||!db.practices.some(p=>p.id===currentId))currentId=db.practices[0]?.id;
        if(currentId)localStorage.setItem("studioMetronomeCurrent",currentId);
        localStorage.setItem(DB_KEY,JSON.stringify(db));
        realtimeLastUpdatedAt=remote.updated_at||"";
        loadPracticeSettings(currentPractice());
        restoreSavedSessionTimer();
        renderAll();
        restoreSectionState();
        setSync("Synced","Cloud data loaded.");
      }else{
        await syncNow(true);
      }
    }catch(e){
      console.error("Cloud load failed",e);
      setSync("Local","Cloud load failed; local data preserved.");
    }finally{
      cloudLoadInFlight=null;
    }
  })();
  return cloudLoadInFlight;
}
async function syncCloudImmediately(){
  if(!sb)return false;
  return await syncNow(true);
}

async function syncNow(silent=false){
  if(!sb){setSync("Local","Supabase client is unavailable.");return false}

  if(syncInFlight){
    syncQueued=true;
    try{await syncInFlight}catch{}
    if(syncQueued){
      syncQueued=false;
      return await syncNow(silent);
    }
    return true;
  }

  syncInFlight=(async()=>{
    try{
      const {data:{user}}=await sb.auth.getUser();
      if(!user){setSync("Local","Not signed in; data is local.");return false}
      if(!silent)setSync("Syncing…","Saving MK Studio data to Supabase");

      const revisionAtStart=Number(localStorage.getItem("mkStudioLocalRevision")||0);
      const dirtyAtStart=Number(localStorage.getItem("mkStudioLocalDirtyAt")||0);
      const snapshot=JSON.parse(JSON.stringify(db));
      const updatedAt=new Date().toISOString();
      const payload={user_id:user.id,data:snapshot,updated_at:updatedAt};
      const {error}=await sb.from(SUPABASE_TABLE).upsert(payload,{onConflict:"user_id"});
      if(error)throw error;

      const revisionNow=Number(localStorage.getItem("mkStudioLocalRevision")||0);
      const dirtyNow=Number(localStorage.getItem("mkStudioLocalDirtyAt")||0);
      const stillCurrent=revisionNow===revisionAtStart && dirtyNow===dirtyAtStart;

      if(stillCurrent){
        realtimeLastUpdatedAt=updatedAt;
        if(realtimeChannel){
          try{await realtimeChannel.send({type:"broadcast",event:"mk_state",payload:{user_id:user.id,data:snapshot,updated_at:updatedAt}})}catch(e){console.warn("Realtime broadcast failed",e)}
        }
        localStorage.removeItem("mkStudioLocalDirtyAt");
        setSync("Synced","Supabase sync is active.");
        return true;
      }

      syncQueued=true;
      setSync("Syncing…","A newer local change is being uploaded…");
      return true;
    }catch(e){
      console.error("Sync failed",e);
      setSync("Local","Sync failed; local data was preserved.");
      return false;
    }finally{
      syncInFlight=null;
    }
  })();

  try{return await syncInFlight}
  finally{
    if(syncQueued){
      syncQueued=false;
      setTimeout(()=>syncNow(true),0);
    }
  }
}

function setSync(a,b){
  const st=document.getElementById("syncStatus"),detail=document.getElementById("syncDetail"),last=document.getElementById("syncLast"),mode=document.getElementById("syncMode"),cloud=document.getElementById("syncChipCloud"),rt=document.getElementById("syncChipRealtime"),card=document.querySelector(".sync-card");
  if(st)st.textContent=a;if(detail)detail.textContent=b;
  if(last&&/synced|realtime/i.test(String(a)))last.textContent="Updated "+new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
  if(mode)mode.textContent=/realtime/i.test(String(a))?"REALTIME CLOUD":/synced|syncing/i.test(String(a))?"CLOUD SYNC":"LOCAL STORAGE";
  if(cloud)cloud.innerHTML=`Cloud <b>${/synced|realtime|syncing/i.test(String(a))?"ON":"OFF"}</b>`;
  if(rt)rt.innerHTML=`Realtime <b>${/realtime/i.test(String(a))?"ON":"OFF"}</b>`;
  if(card){card.classList.remove("sync-live","sync-working","sync-offline");if(/realtime|synced/i.test(String(a)))card.classList.add("sync-live");else if(/syncing/i.test(String(a)))card.classList.add("sync-working");else card.classList.add("sync-offline")}
}

/* ---------- GitHub app update manager ---------- */
const MK_APP_VERSION=(document.querySelector('meta[name="mk-app-version"]')?.content||"2026.09.07.3").trim();
let mkRemoteAppVersion="",mkUpdateCheckInFlight=null;
function compareAppVersions(a,b){const pa=String(a||"").replace(/^v/i,"").split(/[.+-]/).map(x=>parseInt(x,10)||0),pb=String(b||"").replace(/^v/i,"").split(/[.+-]/).map(x=>parseInt(x,10)||0);for(let i=0;i<Math.max(pa.length,pb.length);i++){const d=(pa[i]||0)-(pb[i]||0);if(d)return d}return 0}
function setAppUpdateUI(state,detail,remote=""){const box=document.getElementById("appUpdateBox"),btn=document.getElementById("appUpdateBtn"),label=document.getElementById("appVersionLabel"),msg=document.getElementById("appUpdateDetail");if(label)label.textContent=`v${MK_APP_VERSION}${remote&&remote!==MK_APP_VERSION?` → v${remote}`:""}`;if(msg)msg.textContent=detail||"";if(btn){btn.classList.toggle("ready",state==="available");btn.style.display=state==="available"||state==="error"?"inline-flex":"none";btn.innerHTML=state==="available"?'<i data-lucide="download"></i><span>Update now</span>':'<i data-lucide="refresh-cw"></i><span>Check again</span>';btn.onclick=state==="available"?applyAppUpdate:()=>checkForAppUpdate(true);btn.disabled=false}if(box)box.classList.toggle("update-found",state==="available");try{lucide.createIcons()}catch{}}
async function fetchRemoteAppVersion(){const res=await fetch(`./version.json?mk_update_check=${Date.now()}`,{cache:"no-store",headers:{"Cache-Control":"no-cache"}});if(!res.ok)throw new Error(`HTTP ${res.status}`);const data=await res.json();return String(data?.version||"").trim()}
async function checkForAppUpdate(showMessage=false){if(mkUpdateCheckInFlight)return mkUpdateCheckInFlight;mkUpdateCheckInFlight=(async()=>{const btn=document.getElementById("appUpdateBtn");if(btn){btn.disabled=true;btn.innerHTML='<i data-lucide="loader-circle"></i><span>Checking…</span>';try{lucide.createIcons()}catch{}}try{const remote=await fetchRemoteAppVersion();if(!remote)throw new Error("Missing version");mkRemoteAppVersion=remote;if(compareAppVersions(remote,MK_APP_VERSION)>0){setAppUpdateUI("available",`A newer MK Studio build is live on GitHub (v${remote}). Update this device now.`,remote);return true}setAppUpdateUI("current",`This device is up to date. Live version: v${remote}.`,remote);return false}catch(e){console.warn("App update check failed",e);setAppUpdateUI("error",showMessage?"Could not check GitHub right now. Your data and sync are still available.":"GitHub update check unavailable.");return false}finally{mkUpdateCheckInFlight=null}})();return mkUpdateCheckInFlight}
function applyAppUpdate(){try{sessionStorage.setItem("mkStudioUpdateRequested","1")}catch{}location.replace(`./?mk_update=${Date.now()}`)}

document.addEventListener("keydown",e=>{if(["INPUT","SELECT","TEXTAREA"].includes(e.target.tagName))return;if(e.code==="Space"){e.preventDefault();toggleMetro()}if(e.key==="ArrowUp")changeBpm(1);if(e.key==="ArrowDown")changeBpm(-1);if(e.key.toLowerCase()==="r")toggleRecording()});
document.addEventListener("visibilitychange",()=>{
  if(!document.hidden&&audioCtx?.state==="suspended")audioCtx.resume();
  if(sessionRunning)persistActiveSession();
});
window.addEventListener("pagehide",()=>{if(sessionRunning)persistActiveSession()});

let realtimeChannel=null;
let realtimeUserId=null;
let realtimeApplying=false;
let realtimeLastUpdatedAt="";
let realtimeRetryTimer=null;
let cloudPollTimer=null;
function startCloudPolling(user){
  if(!sb||!user)return;
  if(cloudPollTimer)clearInterval(cloudPollTimer);
  cloudPollTimer=setInterval(async()=>{
    if(document.hidden||realtimeApplying)return;
    try{
      if(localStorage.getItem("mkStudioLocalDirtyAt"))return;
      const remote=await getCloudSnapshot(user);
      if(remote?.data?.practices)applyRemoteSnapshot(remote,"Cloud sync");
    }catch(e){console.warn("Cloud fallback check failed",e)}
  },5000);
}
function stopCloudPolling(){
  if(cloudPollTimer){clearInterval(cloudPollTimer);cloudPollTimer=null}
}
function startRealtimeSync(user){
  if(!sb||!user)return;
  if(realtimeRetryTimer){clearTimeout(realtimeRetryTimer);realtimeRetryTimer=null}
  if(realtimeChannel)sb.removeChannel(realtimeChannel);
  realtimeUserId=user.id;
  realtimeChannel=sb.channel("mk-studio-realtime-"+user.id)
    .on("broadcast",{event:"mk_state"},({payload})=>{
      if(!payload||payload.user_id!==user.id)return;
      applyRemoteSnapshot({data:payload.data,updated_at:payload.updated_at},"Realtime");
    })
    .on("postgres_changes",{event:"*",schema:"public",table:SUPABASE_TABLE,filter:"user_id=eq."+user.id},payload=>{
      if(payload?.eventType==="DELETE")return;
      applyRemoteSnapshot(payload?.new,"Realtime");
    })
    .subscribe(status=>{
      if(status==="SUBSCRIBED")setSync("Realtime","Live Supabase sync is connected.");
      else if(status==="CHANNEL_ERROR"||status==="TIMED_OUT"){
        setSync("Local","Realtime reconnecting; fallback cloud sync is active.");
        if(realtimeUserId===user.id&&!realtimeRetryTimer){
          realtimeRetryTimer=setTimeout(()=>{realtimeRetryTimer=null;startRealtimeSync(user)},4000);
        }
      }
    });
  startCloudPolling(user);
}
function stopRealtimeSync(){
  if(realtimeRetryTimer){clearTimeout(realtimeRetryTimer);realtimeRetryTimer=null}
  if(sb&&realtimeChannel){sb.removeChannel(realtimeChannel);realtimeChannel=null}
  stopCloudPolling();
  realtimeUserId=null;
}
loadPracticeSettings(currentPractice());renderAll();restoreSectionState();restoreActiveSession();restoreSavedSessionTimer();updateSessionTimer();try{loadReminderUI();schedulePracticeReminders()}catch{}
if(sb){
  sb.auth.onAuthStateChange(async (event,session)=>{
    await loadUserEmail();
    if(session && (event==="SIGNED_IN"||event==="INITIAL_SESSION")){
      await loadCloudData();
      startRealtimeSync(session.user);
    }
    if(!session)stopRealtimeSync();
  });
  sb.auth.getSession().then(async ({data})=>{
    const session=data?.session;
    if(session){
      await loadCloudData();
      startRealtimeSync(session.user);
    }
  }).catch(()=>{});
}
let at=settings().autoTempo;
if((special==="accelerando"||special==="ritardando")&&at){
  const i=document.getElementById("techniqueTempoInterval");
  const st=document.getElementById("techniqueTempoStep");
  if(i)i.value=Math.max(1,Number(at.interval)||5);
  if(st)st.value=Math.max(1,Math.abs(Number(at.step??at.change))||1);
}
syncTechniqueTempoUI();
updateTempoDirectionIndicator();
loadUserEmail();

/* ---------- Pro additions: tap tempo + focus mode ---------- */
let mkTapTimes=[];

function openProPanel(id){
  const e=document.getElementById(id); if(e)e.classList.add("open");
}
function closeProPanel(id){
  const e=document.getElementById(id); if(e)e.classList.remove("open");
}
function tapTempo(){
  const now=performance.now();
  mkTapTimes=mkTapTimes.filter(t=>now-t<2500);
  mkTapTimes.push(now);
  if(mkTapTimes.length>1){
    const gaps=[];
    for(let i=1;i<mkTapTimes.length;i++)gaps.push(mkTapTimes[i]-mkTapTimes[i-1]);
    const avg=gaps.reduce((a,b)=>a+b,0)/gaps.length;
    const value=Math.max(20,Math.min(300,Math.round(60000/avg)));
    const el=document.getElementById("tapTempoValue");
    if(el)el.textContent=value+" BPM";
  }
  if(mkTapTimes.length>=8)mkTapTimes=mkTapTimes.slice(-4);
}

function toggleFocusMode(){
  const overlay=document.getElementById("focusOverlay"); if(!overlay)return;
  const opening=!overlay.classList.contains("open");
  overlay.classList.toggle("open",opening);
  overlay.setAttribute("aria-hidden",opening?"false":"true");
  if(opening){
    updateFocusUI();
  }
}
function updateFocusUI(){
  const bpmEl=document.getElementById("focusBpm");
  const seasonEl=document.getElementById("focusSeason");
  const tempoEl=document.getElementById("focusTempoInfo");
  const timerEl=document.getElementById("focusTimerInfo");
  const dayTimerEl=document.getElementById("focusDayTimerInfo");
  const btn=document.getElementById("focusPracticeBtn");
  const seasonBtn=document.getElementById("focusSeasonBtn");
  const tempoValue=document.getElementById("focusTempoValue");
  if(bpmEl)bpmEl.textContent=String(bpm);
  if(seasonEl){
    try{seasonEl.textContent=(typeof currentPractice==="function"&&currentPractice()?.name)?currentPractice().name.toUpperCase():"MK STUDIO"}catch(e){}
  }
  if(tempoEl)tempoEl.textContent=metroRunning?"RUNNING":"READY";
  try{
    const secs=(typeof sessionRunning!=="undefined"&&sessionRunning&&typeof sessionStartedAt!=="undefined"&&sessionStartedAt)?Math.max(0,Math.floor((Date.now()-sessionStartedAt)/1000)):(typeof sessionElapsed!=="undefined"?Math.max(0,sessionElapsed):0);
    if(timerEl)timerEl.textContent=(typeof formatDurationLong==="function")?formatDurationLong(secs):new Date(secs*1000).toISOString().slice(11,19);
    if(dayTimerEl){const saved=(typeof getTodaySeasonSeconds==="function"?Math.max(0,getTodaySeasonSeconds()):0);const total=saved+(sessionRunning?secs:0);dayTimerEl.textContent=(typeof formatDurationLong==="function")?formatDurationLong(total):new Date(total*1000).toISOString().slice(11,19)}
  }catch(e){}
  if(tempoValue)tempoValue.textContent=String(bpm);
  if(btn)btn.textContent=metroRunning?"■ Stop Metronome":"▶ Start Metronome";
  if(seasonBtn)seasonBtn.textContent=sessionRunning?"■ Stop Season":"▶ Start Season";
}
function toggleSeasonFromFocus(){
  try{toggleSession()}catch(e){}
  updateFocusUI();
}
function togglePracticeFromFocus(){
  try{
    if(typeof metroRunning!=="undefined"&&metroRunning)stopMetro();
    else startMetro();
  }catch(e){}
  updateFocusUI();
}

document.addEventListener("keydown",(e)=>{
  if(e.key!=="Enter"&&e.key!==" ")return;
  const el=e.target;
  if(el?.id==="tempoDisplayCard"||el?.classList?.contains("season-toggle")){
    e.preventDefault();
    if(el.id==="tempoDisplayCard")toggleMetro();
    else toggleSession();
  }
});
syncTransportCards();

window.addEventListener("DOMContentLoaded",()=>{
  document.querySelectorAll(".panel").forEach(x=>x.classList.remove("open"));
  document.querySelectorAll(".tool").forEach(x=>x.classList.remove("active"));
  const dm=document.getElementById("dashboardMenu");if(dm)dm.classList.remove("open");
  restoreSectionState();
  lucide.createIcons();
});

/* ---------- Reminder features (edit season + reminders) ---------- */
let reminderTimers=[];
function openEditSeason(){
  const p=currentPractice();if(!p)return;
  document.getElementById("editSeasonName").value=p.name||"";
  document.getElementById("editSeasonColor").value=p.color||"#00f5ff";
  document.getElementById("editSeasonIcon").value=p.icon||"music-2";
  document.getElementById("editSeasonModal").classList.add("open");
  setTimeout(()=>document.getElementById("editSeasonName").focus(),60);
}
function closeEditSeason(){document.getElementById("editSeasonModal").classList.remove("open")}
function saveSeasonEdits(){
  const p=currentPractice();if(!p)return;
  const name=document.getElementById("editSeasonName").value.trim();
  if(!name)return;
  p.name=name;p.color=document.getElementById("editSeasonColor").value||"#00f5ff";p.icon=document.getElementById("editSeasonIcon").value||"music-2";
  closeEditSeason();saveDB();
}
function loadReminderUI(){
  const s=settings(),r=s.reminders||{enabled:false,times:["09:00","15:00","20:00"]};
  const en=document.getElementById("reminderEnabled");if(en)en.checked=!!r.enabled;
  ["1","2","3"].forEach((n,i)=>{const el=document.getElementById("reminderTime"+n);if(el)el.value=r.times?.[i]||["09:00","15:00","20:00"][i]});
  const st=document.getElementById("reminderStatus");
  if(st)st.textContent=("Notification" in window)?(Notification.permission==="granted"?"Notifications are enabled.":"Enable notifications to receive reminders while MK Studio is running."):"This browser does not support notifications.";
}
async function requestReminderPermission(){
  if(!("Notification" in window)){alert("This browser does not support notifications.");return}
  const permission=await Notification.requestPermission();
  loadReminderUI();schedulePracticeReminders();
  if(permission==="granted")new Notification("MK Studio",{body:"Practice reminders are now enabled."});
}
function saveReminderSettings(){
  settings().reminders={enabled:!!document.getElementById("reminderEnabled")?.checked,times:[1,2,3].map(n=>document.getElementById("reminderTime"+n)?.value||"09:00")};
  saveDB();loadReminderUI();schedulePracticeReminders();
}
function schedulePracticeReminders(){
  reminderTimers.forEach(clearTimeout);reminderTimers=[];
  const r=settings().reminders;if(!r?.enabled||!("Notification" in window)||Notification.permission!=="granted")return;
  const times=r.times||["09:00","15:00","20:00"],now=new Date();
  times.forEach(time=>{
    const [hh,mm]=String(time).split(":").map(Number);let next=new Date();next.setHours(hh||0,mm||0,0,0);
    if(next<=now)next.setDate(next.getDate()+1);
    const delay=next-now;
    const timer=setTimeout(()=>{
      const p=currentPractice();
      new Notification("MK Studio • Practice Reminder",{body:p?`Time to practice ${p.name}.`:"Time for a practice session.",icon:"./icons/icon-192.png",tag:"mk-studio-practice"});
      schedulePracticeReminders();
    },delay);
    reminderTimers.push(timer);
  });
}

/* ---------- v3 interaction: season color + sync animation ---------- */
(function(){
  function seasonColor(){
    const p=typeof currentPractice==="function"?currentPractice():null;
    return p?.color || "#00f5ff";
  }

  function applySeasonColor(){
    const c=seasonColor();
    document.documentElement.style.setProperty("--season-color",c);
    const card=document.querySelector(".metro-card");
    if(card)card.style.setProperty("--season-color",c);
  }

  function openMeterEditor(){
    const panel=document.getElementById("panel-meter");
    const btn=[...document.querySelectorAll(".tool")].find(x=>/Meter/i.test(x.textContent||""));
    if(panel){
      document.querySelectorAll(".panel").forEach(x=>x.classList.remove("open"));
      document.querySelectorAll(".tool").forEach(x=>x.classList.remove("active"));
      panel.classList.add("open");
      if(btn)btn.classList.add("active");
      panel.scrollIntoView({behavior:"smooth",block:"nearest"});
    }
  }

  document.addEventListener("click",function(e){
    const ticker=e.target.closest("#tickerSeason,#tickerRhythm,.market-below-tempo");
    if(ticker){e.preventDefault();openMeterEditor();return}
    if(!e.target.closest(".title-season-wrap"))closeSeasonDropdown();
  });

  const originalDebouncedSync=window.debouncedSync;
  if(typeof originalDebouncedSync==="function"){
    window.debouncedSync=function(){
      clearTimeout(window.__mkFastSyncTimer);
      window.__mkFastSyncTimer=setTimeout(function(){
        if(typeof syncNow==="function")syncNow();
      },900);
    };
  }

  const originalSetSync=window.setSync;
  if(typeof originalSetSync==="function"){
    window.setSync=function(a,b){
      originalSetSync(a,b);
      const el=document.getElementById("syncStatus");
      if(!el)return;
      el.classList.remove("sync-live","sync-working","sync-offline");
      if(/realtime|synced/i.test(String(a)))el.classList.add("sync-live");
      else if(/syncing/i.test(String(a)))el.classList.add("sync-working");
      else if(/local|failed|offline/i.test(String(a)))el.classList.add("sync-offline");
    };
  }

  const oldRenderAll=window.renderAll;
  if(typeof oldRenderAll==="function"){
    window.renderAll=function(){
      const r=oldRenderAll.apply(this,arguments);
      applySeasonColor();
      return r;
    };
  }

  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",applySeasonColor,{once:true});
  }else applySeasonColor();
})();
/* ---------- Mobile Pro UI: bottom nav + sheets ---------- */
(function(){
  const mobile=()=>window.matchMedia('(max-width:760px)').matches;
  const backdrop=document.getElementById('mkMobileBackdrop');
  const nav=document.getElementById('mkMobileNav');
  const categoryMap={
    rhythm:['meter','rhythm'],
    sound:['sound','drums'],
    technique:['special'],
    review:['record','calendar']
  };
  function closeSheet(){
    document.querySelectorAll('.metro-card>.panel.open').forEach(p=>p.classList.remove('open'));
    document.querySelectorAll('.tool.active').forEach(b=>b.classList.remove('active'));
    if(backdrop)backdrop.classList.remove('open');
    document.body.classList.remove('mk-mobile-sheet-open');
  }
  function openPanel(name){
    closeReview();
    const panel=document.getElementById('panel-'+name);
    const btn=[...document.querySelectorAll('.tool')].find(x=>new RegExp('^\\s*'+name+'\\s*$','i').test((x.textContent||'').trim()));
    if(!panel)return;
    document.querySelectorAll('.metro-card>.panel.open').forEach(p=>p.classList.remove('open'));
    document.querySelectorAll('.tool.active').forEach(b=>b.classList.remove('active'));
    panel.classList.add('open'); if(btn)btn.classList.add('active');
    if(backdrop)backdrop.classList.add('open');
    document.body.classList.add('mk-mobile-sheet-open');
    if(typeof lucide!=='undefined')lucide.createIcons();
  }
  function openReview(){ if(typeof window.mkOpenReviewV7==='function')window.mkOpenReviewV7(); }
  function closeReview(){ if(typeof window.mkCloseReviewV7==='function')window.mkCloseReviewV7(); }
  let toolsSheet=null;
  function setupToolsSheet(){
    if(toolsSheet)return;
    toolsSheet=document.createElement('div');toolsSheet.id='mkToolsSheet';toolsSheet.className='mk-tools-sheet';
    toolsSheet.innerHTML='<div class="mk-tools-sheet-box"><div class="mk-tools-handle"></div><div class="mk-tools-title">Tools</div><div class="mk-tools-grid"></div></div>';
    document.body.appendChild(toolsSheet);
    const defs=[['rhythm','music-2','Rhythm'],['sound','audio-lines','Sound'],['technique','sparkles','Technique'],['review','library','Review']];
    toolsSheet.querySelector('.mk-tools-grid').innerHTML=defs.map(x=>`<button data-cat="${x[0]}"><i data-lucide="${x[1]}"></i><span>${x[2]}</span></button>`).join('');
    toolsSheet.querySelectorAll('[data-cat]').forEach(b=>b.addEventListener('click',()=>{closeTools();openCategory(b.dataset.cat)}));
  }
  function openTools(){if(!mobile())return;closeReview();setupToolsSheet();toolsSheet.classList.add('open');if(backdrop)backdrop.classList.add('open');document.body.classList.add('mk-mobile-sheet-open');try{lucide.createIcons()}catch{}}
  function closeTools(){if(toolsSheet)toolsSheet.classList.remove('open');if(backdrop)backdrop.classList.remove('open');document.body.classList.remove('mk-mobile-sheet-open')}
  function openCategory(cat){
    if(!mobile())return;
    if(cat==='review'){openReview();return;}
    closeReview();
    const names=categoryMap[cat]||[];
    if(names.length===1){openPanel(names[0]);return;}
    const labels={meter:'Meter',rhythm:'Rhythm',sound:'Sound',drums:'Drums',special:'Techniques',record:'Recordings',calendar:'Calendar'};
    let chooser=document.getElementById('mkCategoryChooser');
    if(!chooser){
      chooser=document.createElement('div'); chooser.id='mkCategoryChooser'; chooser.className='mk-mobile-category-sheet';
      chooser.innerHTML='<div class="mk-category-sheet-handle"></div><div class="mk-category-sheet-title"></div><div class="mk-category-sheet-list"></div>';
      document.body.appendChild(chooser);
    }
    chooser.querySelector('.mk-category-sheet-title').textContent=cat==='rhythm'?'Rhythm tools':'Review tools';
    chooser.querySelector('.mk-category-sheet-list').innerHTML=names.map(n=>'<button type="button" data-panel="'+n+'"><span>'+labels[n]+'</span><i data-lucide="chevron-right"></i></button>').join('');
    chooser.classList.add('open');
    if(backdrop)backdrop.classList.add('open'); document.body.classList.add('mk-mobile-sheet-open');
    chooser.querySelectorAll('[data-panel]').forEach(b=>b.addEventListener('click',()=>{chooser.classList.remove('open');openPanel(b.dataset.panel)}));
    if(typeof lucide!=='undefined')lucide.createIcons();
  }
  function closeCategoryChooser(){
    const c=document.getElementById('mkCategoryChooser'); if(c)c.classList.remove('open');
  }
  if(backdrop)backdrop.addEventListener('click',()=>{closeCategoryChooser();closeSheet();closeDashboard();closeReview();closeTools();});
  document.querySelectorAll('.mk-mobile-category').forEach(b=>b.addEventListener('click',()=>openCategory(b.dataset.category)));
  function closeDashboard(){
    const d=document.getElementById('dashboardMenu'); if(d)d.classList.remove('open');
    document.body.classList.remove('mk-mobile-sheet-open'); if(backdrop)backdrop.classList.remove('open');
  }
  nav?.addEventListener('click',e=>{
    const b=e.target.closest('button[data-nav]'); if(!b)return;
    document.querySelectorAll('.mk-mobile-nav button').forEach(x=>x.classList.remove('active')); b.classList.add('active');
    closeReview();
    const type=b.dataset.nav;
    if(type==='practice'){closeCategoryChooser();closeSheet();window.scrollTo({top:0,behavior:'smooth'});return;}
    if(type==='focus'){closeCategoryChooser();closeSheet();if(typeof toggleFocusMode==='function'&&!document.getElementById('focusOverlay')?.classList.contains('open'))toggleFocusMode();return;}
    if(type==='tools'){closeCategoryChooser();closeSheet();openTools();return;}
    if(type==='settings'){closeCategoryChooser();closeSheet();if(typeof openSettings==='function')openSettings();return;}
  });
  document.addEventListener('click',e=>{
    if(!mobile())return;
    const tool=e.target.closest('.tool');
    if(tool){setTimeout(()=>{const open=document.querySelector('.metro-card>.panel.open');if(open){backdrop?.classList.add('open');document.body.classList.add('mk-mobile-sheet-open')}},0);}
    const close=e.target.closest('.modal-close'); if(close)setTimeout(()=>document.body.classList.remove('mk-mobile-sheet-open'),0);
  },true);
  const oldToggleDashboard=window.toggleDashboardMenu;
  window.toggleDashboardMenu=function(){
    if(!mobile()){if(typeof oldToggleDashboard==='function')oldToggleDashboard();return;}
    const d=document.getElementById('dashboardMenu'); if(!d)return;
    const opening=!d.classList.contains('open'); d.classList.toggle('open',opening);
    if(opening){backdrop?.classList.add('open');document.body.classList.add('mk-mobile-sheet-open')}
    else closeDashboard();
  };
  const oldOpenMeter=window.openMeterEditor;
  window.openMeterEditor=function(){if(mobile())openPanel('meter');else if(typeof oldOpenMeter==='function')oldOpenMeter()};
  const style=document.createElement('style'); style.textContent=`
    @media(max-width:760px){
      .mk-mobile-category-sheet{position:fixed;left:8px;right:8px;bottom:calc(64px + env(safe-area-inset-bottom));z-index:9996;padding:15px 14px 14px;border:1px solid rgba(255,255,255,.11);border-radius:20px 20px 16px 16px;background:linear-gradient(180deg,#101725,#080d15);box-shadow:0 24px 80px rgba(0,0,0,.62);transform:translateY(120%);opacity:0;pointer-events:none;transition:transform .2s ease,opacity .2s ease}
      .mk-mobile-category-sheet.open{transform:translateY(0);opacity:1;pointer-events:auto}
      .mk-category-sheet-handle{width:38px;height:4px;border-radius:99px;background:#3a465d;margin:-3px auto 12px}
      .mk-category-sheet-title{font-size:13px;font-weight:900;color:#f1f6ff;margin-bottom:9px}
      .mk-category-sheet-list{display:grid;gap:6px}
      .mk-category-sheet-list button{min-height:46px;border:1px solid rgba(255,255,255,.08);background:#0d1521;color:#dfe9f5;border-radius:12px;padding:0 12px;display:flex;align-items:center;justify-content:space-between;font:inherit;font-size:10px;font-weight:850}
      .mk-category-sheet-list button i{width:16px;color:var(--cyan)}
    }
  `; document.head.appendChild(style);
  document.addEventListener('click',e=>{
    if(!mobile())return;
    const modal=e.target.closest('.modal.open');
    if(modal && e.target===modal){modal.classList.remove('open');document.body.classList.remove('mk-mobile-sheet-open');return;}
    const openSheet=document.querySelector('.metro-card>.panel.open');
    if(openSheet && !e.target.closest('.metro-card>.panel.open') && !e.target.closest('.mk-mobile-category') && !e.target.closest('.tool'))closeSheet();
  });
  let dragStartY=0,dragging=false;
  document.addEventListener('touchstart',e=>{
    if(!mobile())return; const t=e.target.closest('.panel.open,.modal-box,.dashboard-menu.open .period-card,.mk-review-modal-box,.mk-tools-sheet-box');
    if(!t)return; const r=t.getBoundingClientRect(); if(e.touches[0].clientY-r.top<55){dragStartY=e.touches[0].clientY;dragging=true;}
  },{passive:true});
  document.addEventListener('touchmove',e=>{if(!dragging)return;const dy=e.touches[0].clientY-dragStartY;if(dy>18)e.target.closest('.panel.open,.modal-box,.dashboard-menu.open .period-card,.mk-review-modal-box')?.style.setProperty('transform',`translateY(${Math.min(dy,120)}px)`);},{passive:true});
  document.addEventListener('touchend',e=>{if(!dragging)return;dragging=false;const dy=e.changedTouches[0].clientY-dragStartY;const el=e.target.closest('.panel.open,.modal-box,.dashboard-menu.open .period-card,.mk-review-modal-box,.mk-tools-sheet-box');if(el)el.style.removeProperty('transform');if(dy>70){if(el?.classList.contains('mk-review-modal-box'))closeReview();else if(el?.classList.contains('mk-tools-sheet-box'))closeTools();else if(el?.closest('.modal')){const m=el.closest('.modal');m.classList.remove('open');document.body.classList.remove('mk-mobile-sheet-open');}else if(el?.closest('.dashboard-menu'))closeDashboard();else closeSheet();}},{passive:true});
  document.addEventListener('DOMContentLoaded',()=>{if(typeof lucide!=='undefined')lucide.createIcons();if(mobile()){setupToolsSheet();}});
})();

/* ---------- Mobile: exclusive surfaces, rich categories, home tempo orb ---------- */
(function(){
  const mobile=()=>window.matchMedia('(max-width:760px)').matches;
  const backdrop=()=>document.getElementById('mkMobileBackdrop');
  const bodyClose=()=>document.body.classList.remove('mk-mobile-sheet-open');
  function closeEverything(except){
    if(!mobile())return;
    const rs=document.getElementById('mkReviewModal');
    if(rs&&rs!==except&&rs.classList.contains('open')&&typeof window.mkCloseReviewV7==='function')window.mkCloseReviewV7();
    document.querySelectorAll('.mk-tools-sheet.open,.mk-review-modal.open,.mk-mobile-category-sheet.open').forEach(x=>{if(x!==except)x.classList.remove('open')});
    document.querySelectorAll('.metro-card>.panel.open').forEach(x=>x.classList.remove('open'));
    document.querySelectorAll('.tool.active').forEach(x=>x.classList.remove('active'));
    const d=document.getElementById('dashboardMenu'); if(d)d.classList.remove('open');
    document.querySelectorAll('.modal.open').forEach(x=>{if(x!==except)x.classList.remove('open')});
    const f=document.getElementById('focusOverlay'); if(f && f!==except && f.classList.contains('open')){f.classList.remove('open');f.setAttribute('aria-hidden','true')}
    bodyClose(); const b=backdrop(); if(b)b.classList.remove('open');
  }
  window.mkCloseMobileSurfaces=function(except){closeEverything(except)};

  function wrap(name){
    const old=window[name]; if(typeof old!=='function'||old.__mkWrapped3)return;
    const w=function(){if(mobile())closeEverything();return old.apply(this,arguments)}; w.__mkWrapped3=true; window[name]=w;
  }
  ['openSettings','openProfile','openNew','openAuth','openBackup','openPractice','openDashboardMenu'].forEach(wrap);

  const oldToggle=window.togglePanel;
  if(typeof oldToggle==='function'&&!oldToggle.__mkWrapped3){
    const w=function(name,btn){if(mobile())closeEverything();return oldToggle.apply(this,arguments)};w.__mkWrapped3=true;window.togglePanel=w;
  }
  const oldFocus=window.toggleFocusMode;
  if(typeof oldFocus==='function'&&!oldFocus.__mkWrapped3){
    const w=function(){
      if(mobile()){
        const f=document.getElementById('focusOverlay');
        if(f && !f.classList.contains('open'))closeEverything(f);
      }
      const r=oldFocus.apply(this,arguments); setTimeout(bindFocusTransport,0); return r;
    };w.__mkWrapped3=true;window.toggleFocusMode=w;
  }

  function pulseFocus(){
    const main=document.querySelector('#focusOverlay .focus-main'); if(!main)return;
    main.classList.remove('mk-transport-pulse'); void main.offsetWidth; main.classList.add('mk-transport-pulse');
    clearTimeout(window.__mkFocusPulse);window.__mkFocusPulse=setTimeout(()=>main.classList.remove('mk-transport-pulse'),720);
  }
  function bindFocusTransport(){
    const overlay=document.getElementById('focusOverlay');if(!overlay)return;
    const main=overlay.querySelector('.focus-main');
    if(main&&!main.__mkBound){main.__mkBound=true;main.addEventListener('click',()=>{toggleMetro();pulseFocus();updateFocusUI()})}
    overlay.querySelectorAll('.focus-timer').forEach(card=>{
      if(card.__mkBound)return;card.__mkBound=true;card.setAttribute('role','button');card.setAttribute('tabindex','0');
      card.addEventListener('click',()=>{toggleSession();updateFocusUI()});
      card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggleSession();updateFocusUI()}});
    });
  }
  window.mkPulseFocus= pulseFocus;
  document.addEventListener('DOMContentLoaded',bindFocusTransport);
  document.addEventListener('click',e=>{
    if(!mobile())return;
    const tool=e.target.closest('.mk-tools-grid button[data-cat]');
    if(tool){closeEverything();return;}
    const cat=e.target.closest('.mk-mobile-category');
    if(cat){closeEverything();return;}
  },true);

  const originalStart=window.startMetro,originalStop=window.stopMetro,originalSession=window.toggleSession;
  if(typeof originalStart==='function'&&!originalStart.__mkFocusVisual3){
    window.startMetro=function(){const r=originalStart.apply(this,arguments);setTimeout(()=>{updateFocusUI();pulseFocus();},20);return r};window.startMetro.__mkFocusVisual3=true;
  }
  if(typeof originalStop==='function'&&!originalStop.__mkFocusVisual3){window.stopMetro=function(){const r=originalStop.apply(this,arguments);setTimeout(updateFocusUI,20);return r};window.stopMetro.__mkFocusVisual3=true}
  if(typeof originalSession==='function'&&!originalSession.__mkFocusVisual3){window.toggleSession=function(){const r=originalSession.apply(this,arguments);setTimeout(updateFocusUI,20);return r};window.toggleSession.__mkFocusVisual3=true}
})();

/* ---------- MK v14: single modal close ---------- */
(function(){
function mkCloseAll(){
 document.querySelectorAll('.modal.open,.mk-review-modal.open,.metro-card>.panel.open,.mk-tools-sheet.open').forEach(x=>x.classList.remove('open'));
 const f=document.getElementById('focusOverlay'); if(f){f.classList.remove('open');f.setAttribute('aria-hidden','true')}
}
window.mkCloseAllSurfaces=mkCloseAll;

window.addEventListener('DOMContentLoaded',()=>{
 const sync=document.querySelector('.sync-card');
 const home=document.querySelector('.home')||document.querySelector('main');
 if(sync && home && !home.contains(sync)) home.appendChild(sync);
});

window.openRecordFixed=function(){
 mkCloseAll();
 const p=document.getElementById('panel-record');
 if(p){p.classList.add('open');p.style.display='block';try{renderRecordings&&renderRecordings()}catch(e){} return;}
 if(typeof openRecord==='function' && openRecord!==window.openRecordFixed) return openRecord();
};
window.openRecord=window.openRecordFixed;

window.mkOpenReviewV14=function(){
 mkCloseAll();
 let r=document.getElementById('mkReviewV14');
 if(!r){
  r=document.createElement('div');r.id='mkReviewV14';r.className='modal open';document.body.appendChild(r);
 }
 r.innerHTML=`<div class="modal-box"><div class="modal-head"><div class="modal-title">Review</div><button class="modal-close" id="rvClose">×</button></div><div class="modal-actions" id="rvMenu">
 <button class="small-btn" data-rv="calendar">Calendar</button>
 <button class="small-btn" data-rv="state">Current Season State</button>
 <button class="small-btn" data-rv="history">Current Season History</button>
 <button class="small-btn" data-rv="all">All Seasons Stats</button>
 </div><div id="rvBody"></div></div>`;
 r.querySelector('#rvClose').onclick=()=>r.classList.remove('open');
 r.querySelectorAll('[data-rv]').forEach(b=>b.onclick=()=>{
  const body=r.querySelector('#rvBody'); body.innerHTML='';
  let id=b.dataset.rv==='calendar'?'panel-calendar':b.dataset.rv==='history'?'historyCard':b.dataset.rv==='state'?'statsCard':'allSeasonsCard';
  const el=document.getElementById(id);
  if(el){body.appendChild(el);el.style.display='block';el.classList.add('open');}
  try{renderCalendar&&renderCalendar()}catch(e){}
  try{renderHistory&&renderHistory()}catch(e){}
  try{renderStats&&renderStats()}catch(e){}
  try{renderOverview&&renderOverview()}catch(e){}
 });
 r.classList.add('open');
};
window.mkOpenReviewV7=window.mkOpenReviewV14;
window.openReview=window.mkOpenReviewV14;

const old=window.openCategory;
if(old) window.openCategory=function(cat){
 if(cat==='review') return mkOpenReviewV14();
 if(cat==='record') return openRecordFixed();
 return old.apply(this,arguments);
};
})();

/* ---------- Mobile round 4: rich category actions + home tempo orb ---------- */
(function(){
  const mobile=()=>window.matchMedia('(max-width:760px)').matches;
  const backdrop=()=>document.getElementById('mkMobileBackdrop');
  const closeToolsSheet=()=>{const x=document.getElementById('mkToolsSheet');if(x)x.classList.remove('open')};

  document.addEventListener('DOMContentLoaded',()=>{
    const toolsNav=document.querySelector('.mk-mobile-nav button[data-nav="tools"]');
    if(toolsNav)toolsNav.remove();
    closeToolsSheet();
    if(typeof lucide!=='undefined')lucide.createIcons();
  });

  const categoryData={
    rhythm:[['meter','music-2','Meter','Time signature & note values'],['rhythm','grid-2x2','Rhythm','Build and edit rhythm patterns']],
    sound:[['sound','audio-lines','Sound','Metronome sound & voice'],['drums','drum','Drums','Practice drum patterns']],
    technique:[['special','sparkles','Techniques','Special practice techniques']],
    review:[['record','mic','Record','Open recording studio']]
  };
  function closeAllSurfaces(){
    if(typeof window.mkCloseReviewV7==='function')window.mkCloseReviewV7();
    document.querySelectorAll('.mk-tools-sheet.open,.mk-mobile-category-sheet.open,.metro-card>.panel.open,.dashboard-menu.open').forEach(x=>x.classList.remove('open'));
    document.querySelectorAll('.modal.open').forEach(x=>x.classList.remove('open'));
    const f=document.getElementById('focusOverlay');if(f&&f.classList.contains('open')){f.classList.remove('open');f.setAttribute('aria-hidden','true')}
    document.querySelectorAll('.tool.active').forEach(x=>x.classList.remove('active'));
    backdrop()?.classList.remove('open');document.body.classList.remove('mk-mobile-sheet-open');
  }
  function restoreReviewPanels(){
    const root=document.querySelector('.metro-card');
    if(!root)return;
    ['panel-record','panel-calendar'].forEach(id=>{
      const el=document.getElementById(id); if(!el)return;
      el.classList.remove('open');
      el.style.removeProperty('display');el.style.removeProperty('visibility');el.style.removeProperty('opacity');
      const target=el.dataset.mkReviewParent==='metro-card'?root:null;
      if(target && el.parentElement!==target){
        const nextId=el.dataset.mkReviewNext;
        const next=nextId?document.getElementById(nextId):null;
        if(next&&next.parentElement===target)target.insertBefore(el,next);else target.appendChild(el);
      }
    });
  }
  function openRichCategory(cat){
    if(!mobile())return;
    closeAllSurfaces();
    restoreReviewPanels();
    if(cat==='review'){
      if(typeof window.mkOpenReviewV7==='function'){window.mkOpenReviewV7();return;}
      return;
    }
    let sheet=document.getElementById('mkCategoryChooser');
    if(!sheet){sheet=document.createElement('div');sheet.id='mkCategoryChooser';sheet.className='mk-mobile-category-sheet';document.body.appendChild(sheet)}
    const names={rhythm:'Rhythm',sound:'Sound',technique:'Technique',review:'Record'};
    const subs={rhythm:'Choose a rhythm workspace',sound:'Choose a sound workspace',technique:'Choose a technique',review:'Review your practice'};
    const items=categoryData[cat]||[];
    sheet.innerHTML='<div class="mk-category-sheet-handle"></div><div class="mk-category-sheet-title">'+names[cat]+'</div><div class="mk-category-sheet-subtitle">'+subs[cat]+'</div><div class="mk-category-sheet-list">'+items.map(x=>'<button type="button" data-panel="'+x[0]+'"><span class="mk-cat-action-icon"><i data-lucide="'+x[1]+'"></i></span><span class="mk-cat-action-copy"><b>'+x[2]+'</b><small>'+x[3]+'</small></span><i data-lucide="chevron-right"></i></button>').join('')+'</div>';
    sheet.classList.add('open');backdrop()?.classList.add('open');document.body.classList.add('mk-mobile-sheet-open');
    sheet.querySelectorAll('[data-panel]').forEach(b=>b.addEventListener('click',()=>{
      const name=b.dataset.panel; sheet.classList.remove('open');
      document.querySelectorAll('.metro-card>.panel.open').forEach(x=>x.classList.remove('open'));
      document.querySelectorAll('.tool.active').forEach(x=>x.classList.remove('active'));
      const panel=document.getElementById('panel-'+name);
      if(panel){panel.classList.add('open'); const btn=[...document.querySelectorAll('.tool')].find(x=>(x.textContent||'').trim().toLowerCase()===name.toLowerCase()); if(btn)btn.classList.add('active'); backdrop()?.classList.add('open'); document.body.classList.add('mk-mobile-sheet-open'); try{lucide.createIcons()}catch{}}
    }));
    if(typeof lucide!=='undefined')lucide.createIcons();
  }
  window.addEventListener('resize',()=>{if(!mobile())restoreReviewPanels()},{passive:true});
  document.addEventListener('click',e=>{const c=e.target.closest('.mk-mobile-category');if(c&&mobile()){e.preventDefault();e.stopImmediatePropagation();openRichCategory(c.dataset.category)}},true);

  function updateHomeTempo(){
    const card=document.getElementById('tempoDisplayCard');if(!card)return;
    const btn=document.getElementById('metroBtn');
    const running=!!(btn && /stop/i.test(btn.textContent||''));
    card.classList.toggle('mk-home-running',running);
  }
  function pulseHomeTempo(){
    const card=document.getElementById('tempoDisplayCard');if(!card||!mobile())return;
    card.classList.remove('mk-home-pulse');void card.offsetWidth;card.classList.add('mk-home-pulse');
    clearTimeout(window.__mkHomePulse);window.__mkHomePulse=setTimeout(()=>card.classList.remove('mk-home-pulse'),760);
  }
  const oldStart=window.startMetro,oldStop=window.stopMetro;
  if(typeof oldStart==='function'&&!oldStart.__mkHome4){window.startMetro=function(){const r=oldStart.apply(this,arguments);setTimeout(()=>{updateHomeTempo();pulseHomeTempo()},20);return r};window.startMetro.__mkHome4=true}
  if(typeof oldStop==='function'&&!oldStop.__mkHome4){window.stopMetro=function(){const r=oldStop.apply(this,arguments);setTimeout(updateHomeTempo,20);return r};window.stopMetro.__mkHome4=true}
  const oldToggle=window.toggleMetro;
  if(typeof oldToggle==='function'&&!oldToggle.__mkHome4){window.toggleMetro=function(){const r=oldToggle.apply(this,arguments);setTimeout(()=>{updateHomeTempo();if(window.metroRunning)pulseHomeTempo()},20);return r};window.toggleMetro.__mkHome4=true}
  document.addEventListener('DOMContentLoaded',()=>{
    const card=document.getElementById('tempoDisplayCard');
    if(card){card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();window.toggleMetro?.()}});updateHomeTempo()}
    if(typeof lucide!=='undefined')lucide.createIcons();
  });
  window.mkPulseHomeTempo=pulseHomeTempo;
})();

/* ---------- Mobile final fix: sheets + Focus card events ---------- */
(function(){
  const isMobile=()=>window.matchMedia("(max-width:760px)").matches;let host=null,placeholder=null,current=null;
  function ensureHost(){if(host)return host;host=document.createElement("div");host.id="mkMobilePanelHost";host.className="mk-mobile-panel-sheet";document.body.appendChild(host);return host}
  function close(){if(!current)return;const panel=document.getElementById("panel-"+current);if(panel&&placeholder&&placeholder.parentNode){panel.classList.remove("open");placeholder.parentNode.insertBefore(panel,placeholder.nextSibling)}if(host)host.innerHTML="";current=null;placeholder=null}
  function open(name){if(!isMobile())return false;const panel=document.getElementById("panel-"+name);if(!panel)return false;close();const h=ensureHost();current=name;placeholder=document.createComment("mk-mobile-panel-placeholder");panel.parentNode.insertBefore(placeholder,panel);h.appendChild(panel);panel.classList.add("open");document.querySelectorAll(".tool.active").forEach(x=>x.classList.remove("active"));const btn=[...document.querySelectorAll(".tool")].find(x=>(x.textContent||"").trim().toLowerCase()===name.toLowerCase());if(btn)btn.classList.add("active");document.getElementById("mkMobileBackdrop")?.classList.add("open");document.body.classList.add("mk-mobile-sheet-open");try{lucide.createIcons()}catch{}return true}
  window.mkOpenPanelMobileFixed=open;window.mkClosePanelMobileFixed=close;
  document.addEventListener("click",e=>{if(!isMobile())return;const b=e.target.closest("[data-final-panel],[data-panel]");const name=b?.dataset?.finalPanel||b?.dataset?.panel;if(!name||name==="record"||name==="calendar")return;e.preventDefault();e.stopImmediatePropagation();document.getElementById("mkCategoryChooser")?.classList.remove("open");open(name)},true);
  document.getElementById("mkMobileBackdrop")?.addEventListener("click",close);
  const observer=new MutationObserver(()=>{if(!isMobile())return;const p=document.querySelector(".metro-card>.panel.open");if(p){const n=p.id.replace(/^panel-/i,"");if(n)open(n)}});observer.observe(document.body,{subtree:true,attributes:true,attributeFilter:["class"]});
  window.addEventListener("resize",()=>{if(!isMobile())close()},{passive:true});
})();

/* ---------- MK v7: definitive mobile Review + dashboard ---------- */
(function(){
  const isMobile=()=>window.matchMedia('(max-width:760px)').matches;
  let moved=[];
  let lockY=0;
  function lock(){if(!isMobile()||document.body.dataset.mkV7Lock==='1')return;lockY=window.scrollY||0;document.body.dataset.mkV7Lock='1';document.body.style.position='fixed';document.body.style.top=(-lockY)+'px';document.body.style.left='0';document.body.style.right='0';document.body.style.width='100%';document.body.style.overflow='hidden';}
  function unlock(){if(document.body.dataset.mkV7Lock!=='1')return;delete document.body.dataset.mkV7Lock;['position','top','left','right','width','overflow'].forEach(p=>document.body.style.removeProperty(p));requestAnimationFrame(()=>window.scrollTo(0,lockY));}
  function ensureReview(){
    let rs=document.getElementById('mkReviewModal');
    if(!rs){rs=document.createElement('div');rs.id='mkReviewModal';document.body.appendChild(rs)}
    rs.className='mk-review-modal';
    rs.innerHTML='<div class="mk-review-modal-box"><div class="mk-review-modal-handle"></div><div class="mk-review-modal-head"><div class="mk-review-modal-title">Review</div><button type="button" class="mk-review-modal-close" aria-label="Close">&times;</button></div><div class="mk-review-modal-content"></div></div>';
    rs.querySelector('.mk-review-modal-close').addEventListener('click',()=>closeReview());
    return rs;
  }
  function restoreReviewNodes(){
    [...moved].reverse().forEach(item=>{
      try{
        if(item.placeholder?.parentNode) item.placeholder.parentNode.insertBefore(item.el,item.placeholder.nextSibling);
        item.placeholder?.remove();
      }catch(e){console.warn('restore review node',e)}
    });
    moved=[];

    const root=document.querySelector('.metro-card');
    if(root){
      ['practiceOverview','statsCard','historyCard','panel-record','panel-calendar'].forEach(id=>{
        const el=document.getElementById(id);
        if(!el || !el.dataset.mkReviewParent)return;
        const parentId=el.dataset.mkReviewParent;
        const parent=parentId==='metro-card'?root:document.getElementById(parentId);
        if(!parent)return;
        const nextId=el.dataset.mkReviewNext;
        const next=nextId?document.getElementById(nextId):null;
        try{
          if(next && next.parentElement===parent) parent.insertBefore(el,next);
          else parent.appendChild(el);
        }catch(e){console.warn('restore legacy review node',id,e)}
        el.classList.remove('open');
        el.classList.remove('collapsed');
        ['display','visibility','opacity','transform','position','inset','left','right','top','bottom','z-index'].forEach(prop=>el.style.removeProperty(prop));
        delete el.dataset.mkReviewParent;
        delete el.dataset.mkReviewNext;
      });
    }
  }
  function closeReview(){
    const rs=document.getElementById('mkReviewModal');
    restoreReviewNodes();
    if(rs)rs.classList.remove('open');
    document.body.classList.remove('mk-mobile-sheet-open');
    document.getElementById('mkMobileBackdrop')?.classList.remove('open');
    unlock();
  }
  function openReview(){
    if(!isMobile())return;
    closeReview();
    const fresh=ensureReview(), box=fresh.querySelector('.mk-review-modal-content');
    ['practiceOverview','statsCard','historyCard','panel-record','panel-calendar'].forEach(id=>{
      const el=document.getElementById(id); if(!el||el.parentNode===box)return;
      const ph=document.createComment('mk-review-v7-'+id); el.parentNode.insertBefore(ph,el); moved.push({el,placeholder:ph}); box.appendChild(el);
      el.classList.remove('collapsed');el.classList.add('open');el.style.setProperty('display','block','important');el.style.setProperty('visibility','visible','important');el.style.setProperty('opacity','1','important');
    });
    fresh.classList.add('open');
    document.getElementById('mkMobileBackdrop')?.classList.remove('open');
    document.body.classList.add('mk-mobile-sheet-open');lock();
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      try{typeof renderRecordings==='function'&&renderRecordings()}catch(e){console.warn(e)}
      try{typeof renderCalendar==='function'&&renderCalendar()}catch(e){console.warn(e)}
      try{typeof renderStats==='function'&&renderStats()}catch(e){console.warn(e)}
      try{typeof renderHistory==='function'&&renderHistory()}catch(e){console.warn(e)}
      try{typeof renderAll==='function'&&renderAll;window.lucide&&lucide.createIcons()}catch(e){}
    }));
  }
  window.mkOpenReviewV7=openReview;window.mkCloseReviewV7=closeReview;window.openReview=openReview;
  function openDashboard(){
    if(!isMobile()){try{return window.toggleDashboardMenuOriginalV7?.()}catch(e){return}};
    closeReview();
    const d=document.getElementById('dashboardMenu'),card=document.getElementById('allSeasonsCard');if(!d||!card)return;
    card.classList.remove('collapsed');card.querySelector('.section-body')?.style.setProperty('display','block','important');
    d.classList.add('open');document.getElementById('mkMobileBackdrop')?.classList.remove('open');document.body.classList.add('mk-mobile-sheet-open');lock();
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      try{if(chart){chart.destroy();chart=null}}catch(e){}
      try{typeof renderOverview==='function'&&renderOverview()}catch(e){console.error('mobile dashboard',e)}
      try{if(chart)chart.resize()}catch(e){}
      try{window.lucide&&lucide.createIcons()}catch(e){}
    }));
  }
  function closeDashboard(){document.getElementById('dashboardMenu')?.classList.remove('open');document.body.classList.remove('mk-mobile-sheet-open');unlock()}
  window.toggleDashboardMenuOriginalV7=window.toggleDashboardMenu;
  window.mkOpenDashboardV7=openDashboard;window.mkCloseDashboardV7=closeDashboard;
  window.toggleDashboardMenu=function(){if(isMobile())openDashboard();else window.toggleDashboardMenuOriginalV7?.()};
  document.addEventListener('click',function(e){
    if(!isMobile())return;
    const r=e.target.closest('[data-category="review"],.mk-mobile-category[data-category="review"],.mk-review-final-trigger');
    if(r){e.preventDefault();e.stopImmediatePropagation();openReview();return}
    const db=e.target.closest('.dashboard-menu-btn');
    if(db){e.preventDefault();e.stopImmediatePropagation();openDashboard();return}
    const rs=document.getElementById('mkReviewModal');if(rs?.classList.contains('open')&&e.target===rs){e.preventDefault();closeReview();return}
    const d=document.getElementById('dashboardMenu');if(d?.classList.contains('open')&&e.target===d){e.preventDefault();closeDashboard();return}
  },true);
  document.addEventListener('touchmove',function(e){
    if(!isMobile()||document.body.dataset.mkV7Lock!=='1')return;
    const allowed=e.target.closest('#mkReviewModal .mk-review-modal-box,#dashboardMenu #allSeasonsCard');
    if(!allowed)e.preventDefault();
  },{passive:false});
})();

/* ---------- Ultimate scroll recovery ---------- */
(function(){
  function cleanup(){
    if(!matchMedia('(max-width:700px)').matches)return;
    const rs=document.getElementById('mkReviewModal');
    const openSheets=[...document.querySelectorAll('.mk-tools-sheet.open,.mk-mobile-category-sheet.open,.mk-mobile-panel-sheet,.metro-card>.panel.open,.dashboard-menu.open,.modal.open,#focusOverlay.open')]
      .filter(x=>{const c=getComputedStyle(x),r=x.getBoundingClientRect();return c.display!=='none'&&c.visibility!=='hidden'&&c.opacity!=='0'&&c.pointerEvents!=='none'&&r.width>0&&r.height>0;});
    const reviewOpen=rs && rs.classList.contains('open') && getComputedStyle(rs).opacity!=='0' && getComputedStyle(rs).pointerEvents!=='none';
    if(!reviewOpen && !openSheets.length){
      const b=document.body;
      b.classList.remove('mk-mobile-sheet-open','mk-mobile-locked','mk-mobile-final-lock');
      delete b.dataset.mkV8Lock;delete b.dataset.mkV7Lock;delete b.dataset.mkHardLocked;delete b.dataset.mkFinalLock;
      ['position','top','left','right','width','overflow'].forEach(p=>b.style.removeProperty(p));
      document.documentElement.classList.remove('mk-mobile-locked');
      document.documentElement.style.removeProperty('overflow');
    }
  }
  document.addEventListener('click',()=>requestAnimationFrame(cleanup),{passive:true});
  window.addEventListener('resize',cleanup,{passive:true});
  window.addEventListener('pageshow',cleanup,{passive:true});
  window.addEventListener('visibilitychange',cleanup,{passive:true});
})();
/* ---------- MK v10 UI refinements: Review navigator, Recording modal ---------- */
(function(){
  const mobile=()=>window.matchMedia('(max-width:760px)').matches;
  let reviewMoved=[], recordMoved=null;

  function bodyUnlock(){
    document.body.classList.remove('mk-mobile-sheet-open','mk-mobile-locked','mk-mobile-final-lock');
    ['position','top','left','right','width','overflow'].forEach(k=>document.body.style.removeProperty(k));
    document.documentElement.style.removeProperty('overflow');
  }

  function closeLegacySurfaces(){
    try{window.mkCloseReviewV7?.()}catch(e){}
    try{window.mkCloseDashboardV7?.()}catch(e){}
    document.querySelectorAll('.mk-tools-sheet.open,.mk-review-modal.open,.mk-mobile-category-sheet.open,.dashboard-menu.open,.metro-card>.panel.open').forEach(x=>x.classList.remove('open'));
    document.querySelectorAll('.modal.open').forEach(x=>x.classList.remove('open'));
    const f=document.getElementById('focusOverlay');
    if(f){f.classList.remove('open');f.setAttribute('aria-hidden','true')}
    document.querySelectorAll('.tool.active').forEach(x=>x.classList.remove('active'));
    document.getElementById('mkMobileBackdrop')?.classList.remove('open');
    bodyUnlock();
  }

  function createOverlay(id, title){
    let o=document.getElementById(id);
    if(!o){
      o=document.createElement('div'); o.id=id; o.className='mk-v10-overlay';
      o.innerHTML='<div class="mk-v10-box" role="dialog" aria-modal="true"><div class="mk-v10-head"><div class="mk-v10-title"></div><button class="mk-v10-close" type="button" aria-label="Close">×</button></div><div class="mk-v10-body"></div></div>';
      document.body.appendChild(o);
      o.querySelector('.mk-v10-title').textContent=title;
      o.querySelector('.mk-v10-close').addEventListener('click',()=>id==='mkV10Review'?closeReviewV10():closeRecordV10());
      o.addEventListener('click',e=>{if(e.target===o)(id==='mkV10Review'?closeReviewV10():closeRecordV10())});
    }
    return o;
  }

  function restoreReview(){
    [...reviewMoved].reverse().forEach(({el,ph})=>{
      try{if(ph?.parentNode)ph.parentNode.insertBefore(el,ph.nextSibling); ph?.remove()}catch(e){}
    });
    reviewMoved=[];
  }

  function closeReviewV10(){
    const o=document.getElementById('mkV10Review');
    restoreReview();
    if(o)o.classList.remove('open');
    bodyUnlock();
  }

  function openReviewV10(){
    closeLegacyExcept('review');
    const o=createOverlay('mkV10Review','Review');
    const body=o.querySelector('.mk-v10-body');
    restoreReview();
    body.innerHTML=`
      <div class="mk-review-options">
        <button class="mk-review-option" data-view="history"><div class="left"><div class="ico"><i data-lucide="history"></i></div><div><b>Current Season History</b><span>View recent practice sessions</span></div></div><i data-lucide="chevron-right"></i></button>
        <button class="mk-review-option" data-view="state"><div class="left"><div class="ico"><i data-lucide="chart-no-axes-combined"></i></div><div><b>Current Season State</b><span>View current season statistics</span></div></div><i data-lucide="chevron-right"></i></button>
        <button class="mk-review-option" data-view="calendar"><div class="left"><div class="ico"><i data-lucide="calendar-days"></i></div><div><b>Calendar</b><span>View practice calendar and monthly summary</span></div></div><i data-lucide="chevron-right"></i></button>
      </div>
      <div class="mk-review-view" data-view-content="history"></div>
      <div class="mk-review-view" data-view-content="state"></div>
      <div class="mk-review-view" data-view-content="calendar"></div>`;
    const sources={history:'historyCard',state:'statsCard',calendar:'panel-calendar'};
    Object.entries(sources).forEach(([key,id])=>{
      const el=document.getElementById(id); if(!el)return;
      const ph=document.createComment('mk-v10-review-'+id);
      el.parentNode.insertBefore(ph,el);
      reviewMoved.push({el,ph});
      const target=body.querySelector('[data-view-content="'+key+'"]');
      target.appendChild(el);
      el.classList.remove('collapsed','open');
      el.style.removeProperty('display');
      el.style.removeProperty('visibility');
      el.style.removeProperty('opacity');
    });
    const state=document.getElementById('statsCard');
    const stateTitle=state?.querySelector('.section-collapse b'); if(stateTitle)stateTitle.textContent='Current Season State';

    const show=(key)=>{
      body.querySelector('.mk-review-options').style.display='none';
      body.querySelectorAll('.mk-review-view').forEach(v=>v.classList.toggle('open',v.dataset.viewContent===key));
      body.querySelectorAll('.mk-review-option').forEach(b=>b.classList.remove('active'));
      const head=document.createElement('div'); head.className='mk-v10-head';
      const title={history:'Current Season History',state:'Current Season State',calendar:'Calendar'}[key];
      head.innerHTML='<button class="mk-review-back">‹ Review</button><div class="mk-v10-title">'+title+'</div><span style="width:36px"></span>';
      const view=body.querySelector('[data-view-content="'+key+'"]');
      view.insertBefore(head,view.firstChild);
      head.querySelector('.mk-review-back').onclick=()=>{head.remove();view.classList.remove('open');body.querySelector('.mk-review-options').style.display='grid';};
      try{if(key==='history')renderHistory(); if(key==='state')renderStats(); if(key==='calendar')renderCalendar(); lucide.createIcons()}catch(e){}
    };
    body.querySelectorAll('.mk-review-option').forEach(b=>b.addEventListener('click',()=>show(b.dataset.view)));
    o.classList.add('open');
    document.body.classList.add('mk-mobile-sheet-open');
    try{lucide.createIcons();renderHistory();renderStats();renderCalendar()}catch(e){}
  }

  function restoreRecord(){
    if(!recordMoved)return;
    try{if(recordMoved.ph?.parentNode)recordMoved.ph.parentNode.insertBefore(recordMoved.el,recordMoved.ph.nextSibling);recordMoved.ph?.remove()}catch(e){}
    recordMoved=null;
  }
  function closeRecordV10(){
    const o=document.getElementById('mkV10Record');
    restoreRecord();
    if(o)o.classList.remove('open');
    bodyUnlock();
  }
  function openRecordV10(){
    closeLegacyExcept('record');
    const o=createOverlay('mkV10Record','Recording Studio');
    const body=o.querySelector('.mk-v10-body');
    restoreRecord();
    const el=document.getElementById('panel-record');
    if(!el)return;
    const ph=document.createComment('mk-v10-record');
    el.parentNode.insertBefore(ph,el); recordMoved={el,ph};
    body.appendChild(el);
    el.style.removeProperty('display'); el.style.removeProperty('visibility'); el.style.removeProperty('opacity');
    try{renderRecordings();lucide.createIcons()}catch(e){}
    o.classList.add('open');
    document.body.classList.add('mk-mobile-sheet-open');
  }

  function closeLegacyExcept(which){
    if(which!=='review')closeReviewV10();
    if(which!=='record')closeRecordV10();
    document.querySelectorAll('.mk-tools-sheet.open,.mk-mobile-category-sheet.open,.dashboard-menu.open,.metro-card>.panel.open').forEach(x=>x.classList.remove('open'));
    document.querySelectorAll('.modal.open').forEach(x=>x.classList.remove('open'));
    const f=document.getElementById('focusOverlay');
    if(f && which!=='focus'){f.classList.remove('open');f.setAttribute('aria-hidden','true')}
    document.getElementById('mkMobileBackdrop')?.classList.remove('open');
    document.querySelectorAll('.tool.active').forEach(x=>x.classList.remove('active'));
    bodyUnlock();
  }

  function setup(){
    const profile=document.getElementById('profileModal'), settings=document.getElementById('settingsModal');
    const reminder=settings?.querySelector('.reminder-box');
    if(profile && reminder){
      const actions=profile.querySelector('.modal-actions');
      if(actions)profile.querySelector('.modal-box').insertBefore(reminder,actions);
      else profile.querySelector('.modal-box').appendChild(reminder);
    }
    settings?.querySelector('.notice')?.remove();

    const mainRec=document.getElementById('mainRecordBtn');
    if(mainRec){
      mainRec.onclick=null;
      mainRec.setAttribute('onclick','openRecordingStudio()');
    }
    document.querySelectorAll('.tools .tool').forEach(b=>{
      const t=(b.textContent||'').trim();
      if(/^Recordings$/i.test(t)||/^Calendar$/i.test(t))b.remove();
    });

    ['openProfile','openSettings','openBackup','openAuth'].forEach(name=>{
      const old=window[name];
      if(typeof old==='function' && !old.__mkV10){
        const w=function(){closeLegacyExcept('normal');return old.apply(this,arguments)};
        w.__mkV10=true; window[name]=w;
      }
    });

    window.openRecordingStudio=openRecordV10;
    window.mkOpenReviewV10=openReviewV10;
    window.mkCloseReviewV10=closeReviewV10;
    window.mkCloseRecordingV10=closeRecordV10;

    document.addEventListener('click',e=>{
      if(!mobile())return;
      const r=e.target.closest('[data-category="review"],.mk-review-final-trigger');
      if(r){e.preventDefault();e.stopImmediatePropagation();openReviewV10();return}
    },true);

    document.addEventListener('click',e=>{
      if(e.target===document.getElementById('mkV10Review'))closeReviewV10();
      if(e.target===document.getElementById('mkV10Record'))closeRecordV10();
    });

    document.querySelectorAll('.modal').forEach(m=>m.addEventListener('click',e=>{
      if(e.target===m){m.classList.remove('open');bodyUnlock()}
    }));
    try{lucide.createIcons()}catch(e){}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})();

/* ---------- MK v10 focus exclusivity ---------- */
(function(){
  const oldFocus=window.toggleFocusMode;
  if(typeof oldFocus==='function'&&!oldFocus.__mkV10){
    const w=function(){
      try{window.mkCloseReviewV10?.();window.mkCloseRecordingV10?.()}catch(e){}
      return oldFocus.apply(this,arguments);
    };
    w.__mkV10=true;window.toggleFocusMode=w;
  }
  const oldUpdate=window.updateFocusUI;
  if(typeof oldUpdate==='function'&&!oldUpdate.__mkV10Fx){
    const w=function(){
      const r=oldUpdate.apply(this,arguments);
      const main=document.querySelector('#focusOverlay .focus-main');
      if(main){
        const running=!!window.metroRunning;
        main.classList.toggle('focus-running',running);
        if(running){
          main.classList.remove('focus-beat-hit');void main.offsetWidth;main.classList.add('focus-beat-hit');
          clearTimeout(window.__mkFocusBeatHit);window.__mkFocusBeatHit=setTimeout(()=>main.classList.remove('focus-beat-hit'),180);
        }
      }
      return r;
    };
    w.__mkV10Fx=true;window.updateFocusUI=w;
  }
})();

/* ---------- MK v11 UI refinements: bottom nav / review / focus ---------- */
(function(){
  const mobile=()=>matchMedia('(max-width:760px)').matches;
  const qs=s=>document.querySelector(s);
  function unlock(){
    document.body.classList.remove('mk-mobile-sheet-open','mk-mobile-locked','mk-mobile-final-lock');
    ['position','top','left','right','width','overflow'].forEach(k=>document.body.style.removeProperty(k));
    document.documentElement.style.removeProperty('overflow');
  }
  function closeEverySurface(except){
    if(except!=='record')try{window.mkCloseRecordingV10?.()}catch{}
    if(except!=='review')try{window.mkCloseReviewV10?.()}catch{}
    try{window.mkCloseReviewV7?.()}catch{}
    document.querySelectorAll('.mk-tools-sheet.open,.mk-review-modal.open,.mk-mobile-category-sheet.open,.dashboard-menu.open,.metro-card>.panel.open').forEach(x=>x.classList.remove('open'));
    document.querySelectorAll('.modal.open').forEach(x=>{if(except!=='review'||x.id!=='settingsModal')x.classList.remove('open')});
    const f=qs('#focusOverlay');
    if(f&&except!=='focus'){f.classList.remove('open');f.setAttribute('aria-hidden','true')}
    document.querySelectorAll('.tool.active').forEach(x=>x.classList.remove('active'));
    qs('#mkMobileBackdrop')?.classList.remove('open');
    if(except!=='review'&&qs('#settingsModal'))qs('#settingsModal').classList.remove('open');
    unlock();
  }

  let moved=[];
  function restoreReviewNodes(){
    moved.reverse().forEach(({el,ph})=>{try{if(ph.parentNode)ph.parentNode.insertBefore(el,ph.nextSibling);ph.remove()}catch{}}); moved=[];
  }
  function moveReviewNode(id,target){
    const el=document.getElementById(id); if(!el||!target)return;
    const ph=document.createComment('mk-v11-'+id); el.parentNode.insertBefore(ph,el); moved.push({el,ph}); target.appendChild(el);
    el.classList.remove('open','collapsed');el.style.removeProperty('display');el.style.removeProperty('visibility');el.style.removeProperty('opacity');
  }
  function openReview(){
    if(!mobile())return;
    closeEverySurface('review');
    const m=document.getElementById('settingsModal'); if(!m)return;
    restoreReviewNodes();
    const box=m.querySelector('.modal-box');
    box.innerHTML='<div class="modal-head"><div class="modal-title">Review</div><button class="modal-close" type="button" aria-label="Close">×</button></div><div id="mkSettingsReviewBody"></div>';
    const body=box.querySelector('#mkSettingsReviewBody');
    body.innerHTML='<div class="mk-v11-review-options">'+
      '<button class="mk-v11-review-option" data-view="calendar"><div class="left"><div class="ico"><i data-lucide="calendar-days"></i></div><div><b>Calendar</b><span>Practice calendar and monthly summary</span></div></div><i data-lucide="chevron-right"></i></button>'+
      '<button class="mk-v11-review-option" data-view="state"><div class="left"><div class="ico"><i data-lucide="chart-no-axes-combined"></i></div><div><b>Current Season State</b><span>Current season statistics</span></div></div><i data-lucide="chevron-right"></i></button>'+
      '<button class="mk-v11-review-option" data-view="history"><div class="left"><div class="ico"><i data-lucide="history"></i></div><div><b>Current Season History</b><span>Recent practice sessions</span></div></div><i data-lucide="chevron-right"></i></button>'+
      '</div><div class="mk-v11-review-view" data-content="calendar"></div><div class="mk-v11-review-view" data-content="state"></div><div class="mk-v11-review-view" data-content="history"></div>';
    moveReviewNode('panel-calendar',body.querySelector('[data-content="calendar"]'));
    moveReviewNode('statsCard',body.querySelector('[data-content="state"]'));
    moveReviewNode('historyCard',body.querySelector('[data-content="history"]'));
    const st=document.getElementById('statsCard')?.querySelector('.section-collapse b'); if(st)st.textContent='Current Season State';
    const show=key=>{
      body.querySelector('.mk-v11-review-options').style.display='none';
      body.querySelectorAll('.mk-v11-review-view').forEach(v=>v.classList.toggle('open',v.dataset.content===key));
      const view=body.querySelector('[data-content="'+key+'"]');
      const head=document.createElement('div');head.className='mk-v11-review-head';
      head.innerHTML='<button class="mk-v11-review-back">‹ Review</button><b>'+({calendar:'Calendar',state:'Current Season State',history:'Current Season History'}[key])+'</b><span style="width:36px"></span>';
      view.prepend(head);
      head.querySelector('button').onclick=()=>{head.remove();view.classList.remove('open');body.querySelector('.mk-v11-review-options').style.display='grid'};
      try{if(key==='calendar')window.renderCalendar?.();if(key==='state')window.renderStats?.();if(key==='history')window.renderHistory?.();window.lucide?.createIcons()}catch{}
    };
    body.querySelectorAll('.mk-v11-review-option').forEach(b=>b.onclick=()=>show(b.dataset.view));
    box.querySelector('.modal-close').onclick=closeReview;
    m.onclick=e=>{if(e.target===m)closeReview()};
    m.classList.add('open');m.setAttribute('aria-hidden','false');document.body.classList.add('mk-mobile-sheet-open');
    try{window.lucide?.createIcons()}catch{}
  }
  function closeReview(){
    const m=document.getElementById('settingsModal'); if(!m)return;
    restoreReviewNodes();m.classList.remove('open');m.setAttribute('aria-hidden','true');unlock();
  }
  function openRecord(){
    if(!mobile())return;
    closeEverySurface('record');
    if(typeof window.openRecordingStudio==='function')window.openRecordingStudio();
  }

  function moveSyncToProfile(){
    const card=document.querySelector('main .sync-card');
    const profile=document.getElementById('profileModal');
    if(card&&profile){
      const actions=profile.querySelector('.modal-actions');
      if(actions)actions.parentNode.insertBefore(card,actions); else profile.querySelector('.modal-box')?.appendChild(card);
      card.dataset.mkProfileMoved='1';
      card.style.removeProperty('display');
    }
  }

  function setup(){
    moveSyncToProfile();
    const settings=document.getElementById('settingsModal');
    const oldOpenSettings=window.openSettings;
    window.openSettings=function(){if(mobile()){openReview();return;}return oldOpenSettings?.apply(this,arguments)};
    const oldOpenProfile=window.openProfile;
    if(typeof oldOpenProfile==='function'&&!oldOpenProfile.__mkV11){window.openProfile=function(){closeEverySurface('profile');return oldOpenProfile.apply(this,arguments)};window.openProfile.__mkV11=true}
    const oldOpenBackup=window.openBackup;
    if(typeof oldOpenBackup==='function'&&!oldOpenBackup.__mkV11){window.openBackup=function(){closeEverySurface('backup');return oldOpenBackup.apply(this,arguments)};window.openBackup.__mkV11=true}
    const oldOpenAuth=window.openAuth;
    if(typeof oldOpenAuth==='function'&&!oldOpenAuth.__mkV11){window.openAuth=function(){closeEverySurface('auth');return oldOpenAuth.apply(this,arguments)};window.openAuth.__mkV11=true}

    const nav=document.getElementById('mkMobileNav');
    nav?.addEventListener('click',e=>{
      const b=e.target.closest('button[data-nav]');if(!b||!mobile())return;
      const type=b.dataset.nav;
      if(type==='review'){e.preventDefault();e.stopImmediatePropagation();openReview();return}
      if(type==='focus'){e.preventDefault();e.stopImmediatePropagation();closeEverySurface('focus');window.toggleFocusMode?.();return}
      if(type==='practice'){closeEverySurface('home');window.scrollTo({top:0,behavior:'smooth'});return}
    },true);

    document.addEventListener('click',e=>{
      if(!mobile())return;
      const r=e.target.closest('.mk-record-final-trigger,[data-category="record"]');
      if(r){e.preventDefault();e.stopImmediatePropagation();openRecord()}
    },true);

    document.addEventListener('click',e=>{
      if(!mobile())return;
      if(e.target.closest('#focusOverlay .focus-close'))setTimeout(()=>closeEverySurface('none'),0);
    },true);
    try{window.lucide?.createIcons()}catch{}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});else setup();
})();

/* ---------- MK v12: record studio single route + review items ---------- */
(function(){
 function openRecord(){
   if(typeof window.openPanel==='function'){window.openPanel('record');return;}
   const p=document.getElementById('panel-record'); if(p)p.classList.add('open');
 }
 const old=window.openCategory;
 window.openCategory=function(cat){
   if(cat==='record'){openRecord();return;}
   return old?old.apply(this,arguments):undefined;
 };
 window.mkOpenReviewItem=function(type){
   const map={calendar:'panel-calendar',state:'statsCard',history:'historyCard'};
   const el=document.getElementById(map[type]);
   if(!el)return;
   document.querySelectorAll('#mkReviewModal .mk-review-view').forEach(x=>x.style.display='none');
   el.style.display='block';
 };
 document.addEventListener('click',function(e){
   const b=e.target.closest('[data-review-item]');
   if(b) window.mkOpenReviewItem(b.dataset.reviewItem);
 });
 document.addEventListener('DOMContentLoaded',()=>{
   const c=document.querySelector('#focusOverlay .focus-controls');
   if(c && !c.querySelector('.focus-record-btn')){
    const b=document.createElement('button'); b.className='focus-record-btn'; b.innerHTML='<i data-lucide="mic"></i><span>Record</span>'; b.onclick=openRecord; c.prepend(b);
   }
   const modal=document.getElementById('mkReviewModal');
   if(modal){
    modal.querySelectorAll('[data-content]').forEach(x=>x.dataset.reviewItem=x.dataset.content);
   }
   try{lucide.createIcons()}catch(e){}
 });
})();

/* ---------- MK v13 fixes ---------- */
(function(){
  function onlyOne(id){
    document.querySelectorAll('.modal.open,.panel.open,#focusOverlay.open,.mk-tools-sheet.open,.mk-review-modal.open').forEach(x=>{
      if(x.id!==id)x.classList.remove('open');
    });
  }
  function openRecordFixed(){
    onlyOne('panel-record');
    const p=document.getElementById('panel-record');
    if(p){
      document.querySelectorAll('.panel').forEach(x=>x.classList.remove('open'));
      p.classList.add('open');
      p.scrollIntoView({behavior:'smooth',block:'center'});
      const b=[...document.querySelectorAll('.tool')].find(x=>/Recordings|Record/i.test(x.textContent||''));
      b?.classList.add('active');
    }
  }
  window.openRecordFixed=openRecordFixed;
  document.addEventListener('click',e=>{
    const r=e.target.closest('[data-category="record"],.mk-record-final-trigger');
    if(r){e.preventDefault();e.stopImmediatePropagation();openRecordFixed();}
  },true);
  function cleanFocus(){document.querySelectorAll('#focusOverlay .focus-record-btn').forEach(x=>x.remove())}
  function fixReview(){
    const modal=document.getElementById('settingsModal');
    if(!modal)return;
    modal.querySelectorAll('.mk-v11-review-option').forEach(btn=>{
      btn.onclick=()=>{
        const key=btn.dataset.view;
        const map={calendar:'panel-calendar',state:'statsCard',history:'historyCard'};
        const el=document.getElementById(map[key]);
        if(!el)return;
        modal.querySelectorAll('.mk-v11-review-view').forEach(v=>v.classList.remove('open'));
        const host=modal.querySelector('[data-content="'+key+'"]');
        if(host){host.classList.add('open');host.style.display='block';}
        el.style.display='block';
        if(key==='calendar'&&window.renderCalendar)window.renderCalendar();
        if(key==='state'&&window.renderStats)window.renderStats();
        if(key==='history'&&window.renderHistory)window.renderHistory();
      };
    });
  }
  function restoreSync(){
    const card=document.querySelector('.sync-card');
    const main=document.querySelector('main');
    if(card&&main&&!main.contains(card))main.appendChild(card);
  }
  document.addEventListener('DOMContentLoaded',()=>{
    cleanFocus();restoreSync();fixReview();
    const old=window.openRecord;
    window.openRecord=openRecordFixed;
    const obs=new MutationObserver(()=>{cleanFocus();fixReview();});
    obs.observe(document.body,{subtree:true,childList:true});
  });
})();

/* ---------- Focus Mode: real events on cards ---------- */
(function(){
  function bindFocusCards(){
    const main=document.querySelector("#focusOverlay .focus-main");
    const timers=document.querySelectorAll("#focusOverlay .focus-timer");
    if(main && !main.dataset.bound){
      main.dataset.bound="1";
      main.addEventListener("click",function(e){
        e.preventDefault();
        e.stopPropagation();
        if(typeof togglePracticeFromFocus==="function") togglePracticeFromFocus();
      });
      main.addEventListener("keydown",function(e){
        if(e.key==="Enter" || e.key===" "){
          e.preventDefault();
          if(typeof togglePracticeFromFocus==="function") togglePracticeFromFocus();
        }
      });
    }
    timers.forEach(function(t){
      if(t.dataset.bound)return;
      t.dataset.bound="1";
      t.addEventListener("click",function(e){
        e.preventDefault();
        e.stopPropagation();
        if(typeof toggleSeasonFromFocus==="function") toggleSeasonFromFocus();
      });
      t.addEventListener("keydown",function(e){
        if(e.key==="Enter" || e.key===" "){
          e.preventDefault();
          if(typeof toggleSeasonFromFocus==="function") toggleSeasonFromFocus();
        }
      });
    });
  }
  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",bindFocusCards);
  }else{
    bindFocusCards();
  }
  setTimeout(bindFocusCards,1000);
})();

/* ---------- Focus v3: final controller ---------- */
(function(){
  function closeCompetingSurfaces(except){
    try{ if(typeof closeEverySurface==='function') closeEverySurface(except); }catch(e){}
    document.querySelectorAll('.mk-review-modal.open,.mk-pro-panel.open,.mk-tools-sheet.open,.mk-mobile-category-sheet.open,.dashboard-menu.open,.metro-card>.panel.open').forEach(function(x){x.classList.remove('open')});
    document.querySelectorAll('.modal.open').forEach(function(x){if(x.id!=='profileModal'||except!=='profile')x.classList.remove('open')});
    if(except!=='focus'){
      var f=document.getElementById('focusOverlay');
      if(f){f.classList.remove('open');f.setAttribute('aria-hidden','true')}
    }
  }

  window.mkCleanFocusToggle=function(){
    var overlay=document.getElementById('focusOverlay');
    if(!overlay)return;
    var opening=!overlay.classList.contains('open');
    if(opening)closeCompetingSurfaces('focus');
    overlay.classList.toggle('open',opening);
    overlay.setAttribute('aria-hidden',opening?'false':'true');
    if(opening){
      try{updateFocusUI()}catch(e){}
      try{lucide.createIcons()}catch(e){}
    }
  };

  var install=function(){
    window.toggleFocusMode=window.mkCleanFocusToggle;
    var p=document.getElementById('profileModal');
    if(p && !p.__mkCleanProfile){
      p.__mkCleanProfile=true;
      p.addEventListener('click',function(e){if(e.target===p){try{closeProfile()}catch(x){p.classList.remove('open')}}});
    }
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();