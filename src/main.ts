import './style.css';
import {defaults, FIELDS, LABELS, SOUNDS, makeUnits, parseDocx, validateDataset, fingerprint, segmentsFor, type Dataset, type Settings} from './model';
import {Player} from './player';
import {BrowserSpeaker, readPack,storePack,restorePack,type StoredAudioPack, type AudioPack} from './audio';
import * as storage from './storage';
import {configurePlayback} from './foreground-audio';
import {BackgroundMusic} from './background-music';

const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const base=import.meta.env.BASE_URL;
let data:Dataset|undefined,settings:Settings={...defaults},voicePack:AudioPack|undefined,sessionPack:AudioPack|undefined;
let customMusic:Blob|undefined,customURL='',musicKey='',pendingData:Dataset|undefined,pendingPack:AudioPack|undefined;
let favoritesOnly=false,previewing=false,sessionURL='',wake:WakeLockSentinel|undefined,mode:'interactive'|'session'='interactive',storageFailed=false;
let wakePending=false;
let wakeRetryAt=0;
let sessionText=new Map<string,string>();
let importing=false;
const speaker=new BrowserSpeaker(),music=new BackgroundMusic(),session=new Audio();
const player=new Player([],settings,speaker,refreshPlayer);
let saving:ReturnType<typeof setTimeout>|undefined;
const app=$('app');
app.innerHTML=`
<header class="topbar"><a class="brand" href="./" aria-label="Theatre home"><span class="brand-mark">◒</span><span>THEATRE<span class="brand-sub">OF THE MIND</span></span></a><span class="privacy"><i></i> A private space</span></header>
<main>
  <section class="intro"><span class="eyebrow">A LITTLE STILLNESS. A CLEARER PICTURE.</span><h1>Become familiar<br>with your <em>future self.</em></h1><p>Your words. Your pace. A quiet place to rehearse who you want to be.</p></section>
  <div id="notice" role="status" class="notice" hidden></div>
  <section id="welcome" class="welcome panel"><div class="welcome-symbol">✧</div><h2>Bring your practice with you.</h2><p>Import your Word document to begin. Its words stay in this browser, on this device.</p><button class="primary import-trigger">Import your practice <span>↗</span></button><p class="fine">Four-column DOCX · Theatre JSON · Prepared audio packs</p><button id="demo" class="text-button">Explore with a short sample</button></section>
  <section id="workspace" hidden>
    <div id="interactive-view">
      <div class="practice-layout">
        <section class="player-panel panel"><div class="player-top"><span id="section-caption" class="eyebrow"></span><span id="position" class="pill"></span><button id="focus" class="text-button" aria-pressed="false">Focus</button></div><div class="progress"><div id="progress-fill"></div></div><div id="scene-content"></div><div id="player-status" role="status" class="player-status"></div><div id="countdown" hidden></div><div class="player-controls"><button id="previous" class="secondary" aria-label="Previous unit">←<span>Previous</span></button><button id="play" class="primary play">Play</button><button id="next" class="secondary" aria-label="Next unit">→<span>Next</span></button></div><button id="repeat" class="text-button">↻ Repeat this unit</button><p id="engine-label" class="fine"></p><div id="session-view" hidden><p class="fine">Playback continues when you lock your screen.</p><div id="session-audio-host"></div><p id="session-caption" role="status"></p><details><summary>Audio details</summary><p id="session-details"></p><button id="export-audio" class="secondary">Export audio</button></details></div></section>
        <aside class="settings-panel panel"><div class="panel-heading"><h2>Your rhythm</h2><span class="small-star">✧</span></div><label>Practice section<select id="section"></select></label><label>Start at scene<select id="scene"></select></label><div class="two-columns"><label>Read a<select id="size"><option value="sentence">Sentence</option><option value="cell">Cell / column</option><option value="scene">Complete scene</option><option value="section">Whole section</option></select></label><label>Within<select id="range"><option value="scene">This scene</option><option value="section">This section</option><option value="all">All sections</option></select></label></div><label class="check"><input id="affirmations" type="checkbox">Affirmations only</label><fieldset><legend>After each unit</legend><div class="segmented"><button id="manual-mode">Wait for Next</button><button id="timed-mode">Timed pause</button></div></fieldset><label class="range-label">Visualization pause <output id="gap-value"></output><input id="gap" type="range" min="10" max="60" step="5"></label><label class="range-label">Speech rate <output id="rate-value"></output><input id="rate" type="range" min="0.8" max="1.5" step="0.05"></label><label>Read each unit<select id="repeats"><option value="1">Once</option><option value="2">Twice</option><option value="3">Three times</option><option value="custom">Custom…</option></select></label><label id="custom-repeats-wrap" hidden>Number of readings<input id="custom-repeats" type="number" min="1" max="20" value="4"></label><label class="check"><input id="loop" type="checkbox">Loop playback</label><details><summary>Voice & volume</summary><label>Local system voice<select id="voice"></select></label><p class="fine">Only voices reported as local are used. Imported neural clips take priority.</p><label class="range-label">Narration <output id="voiceVolume-value"></output><input id="voiceVolume" type="range" min="0" max="1" step="0.05"></label></details></aside>
      </div>
      <section class="sound-panel panel"><div class="panel-heading"><div><span class="eyebrow">MAKE ROOM FOR STILLNESS</span><h2>A softer background</h2></div><button id="favorites" class="text-button">♡ Favorites</button></div><p class="muted">Twelve original soundscapes. Nature textures are synthesized, not field recordings.</p><div id="sounds" class="sound-grid"></div><div class="sound-footer"><button id="preview-sound" class="secondary">Preview sound</button><label class="range-label">Background volume <output id="musicVolume-value"></output><input id="musicVolume" type="range" min="0" max="0.6" step="0.02"></label><button id="custom-music" class="text-button">Import my own audio ↗</button></div></section>
    </div>

    <section class="library-panel panel"><div><span class="eyebrow">YOUR PRACTICE, KEPT CLOSE</span><h2 id="document-title"></h2><p id="document-count" class="muted"></p></div><div class="library-actions"><button class="import-trigger secondary">Import document / audio pack</button><button id="export-data" class="secondary">Back up document</button><button id="prepare" class="secondary">Prepare natural audio ↗</button><button id="guidance" class="text-button">Practice instructions</button></div></section>
  </section>
  <footer><span>NO ACCOUNTS. NO TRACKING. JUST YOU.</span><div><button id="help" class="text-button">Setup & privacy</button><button id="delete" class="text-button">Delete local data</button></div></footer>
</main><input type="file" id="import-file" accept=".docx,.json,.zip" hidden><input type="file" id="music-file" accept="audio/*" hidden>
<dialog id="dialog"><div id="dialog-content"></div><button id="close-dialog" class="secondary">Close</button></dialog>`;
configurePlayback();
session.controls=true;session.preload='metadata';session.setAttribute('aria-label','Prepared meditation session');$('session-audio-host').append(session);

function notice(text:string){$('notice').textContent=text;$('notice').hidden=!text;}
function modal(html:string){$('dialog-content').innerHTML=html;const d=$<HTMLDialogElement>('dialog');if(!d.open)d.showModal();}
function download(blob:Blob,name:string){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60_000);}
function jsonDownload(value:unknown,name:string){download(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}),name);}
async function persist(entries:[string,unknown][]){try{await storage.setMany(entries);storageFailed=false;}catch{storageFailed=true;notice('Storage is unavailable or full. Your current practice works temporarily; export a backup before closing this page.');}}
function saveSettings(){clearTimeout(saving);saving=setTimeout(()=>void persist([['settings',settings]]),200);}
function stopAll(){player.stop();session.pause();music.pause();previewing=false;$('preview-sound').textContent='Preview sound';}
function selectedSection(){return data?.sections.find(s=>s.id===settings.section)||data?.sections[0];}
function normalizeSelection(){if(!data)return;const sec=selectedSection()!;settings.section=sec.id;if(!sec.scenes.some(s=>s.id===settings.scene))settings.scene=sec.scenes[0].id;}
function rebuild(anchor?:string){contentKey='';player.setUnits(data?makeUnits(data,settings):[],anchor);saveSettings();}
function option(value:string,label:string){return `<option value="${esc(value)}">${esc(label)}</option>`;}
function renderSelectors(){if(!data)return;normalizeSelection();$<HTMLSelectElement>('section').innerHTML=data.sections.map(s=>option(s.id,s.title)).join('');$<HTMLSelectElement>('section').value=settings.section;const sec=selectedSection()!;$<HTMLSelectElement>('scene').innerHTML=sec.scenes.map(s=>option(s.id,`${s.number}. ${s.line.slice(0,65)}${s.line.length>65?'…':''}`)).join('');$<HTMLSelectElement>('scene').value=settings.scene;}
function render(){
  $('welcome').hidden=!!data;$('workspace').hidden=!data;
  if(data){renderSelectors();$('document-title').textContent=data.title;$('document-count').textContent=`${data.sections.length} sections · ${data.sections.reduce((n,s)=>n+s.scenes.length,0)} scenes · stored on this device`;}
  for(const id of ['size','range','gap','rate','voiceVolume','musicVolume']as const)($<HTMLInputElement>(id)).value=String(settings[id]);
  for(const id of ['affirmations','loop']as const)$<HTMLInputElement>(id).checked=settings[id];
  $<HTMLSelectElement>('repeats').value=settings.repeats<=3?String(settings.repeats):'custom';$('custom-repeats-wrap').hidden=settings.repeats<=3;$<HTMLInputElement>('custom-repeats').value=String(settings.repeats);
  $('manual-mode').classList.toggle('selected',settings.mode==='manual');$('timed-mode').classList.toggle('selected',settings.mode==='timed');
  if(sessionPack)$<HTMLInputElement>('loop').checked=session.loop;
  updateValues();renderSounds();renderVoices();renderSession();refreshPlayer();
}
function updateValues(){for(const id of ['gap','rate','voiceVolume','musicVolume']as const)$(id+'-value').textContent=id==='gap'?`${settings[id]} sec`:id==='rate'?`${settings[id].toFixed(2)}×`:`${Math.round(settings[id]*100)}%`;}
function renderVoices(){const voices='speechSynthesis'in window?speechSynthesis.getVoices().filter(v=>v.localService&&v.lang.startsWith('en')):[];$<HTMLSelectElement>('voice').innerHTML=voices.length?voices.map(v=>option(v.voiceURI,`${v.name} · ${v.lang}`)).join(''):option('','No local English voices found');if(voices.some(v=>v.voiceURI===settings.voice))$<HTMLSelectElement>('voice').value=settings.voice;}
let contentKey='';
function refreshPlayer(){
  if(!$('scene-content'))return;
  const u=player.unit;const segment=player.segment;const key=`${u?.id}/${segment?.id}/${data?.title}`;
  if(contentKey!==key){contentKey=key;
    if(u&&data){const sec=data.sections.find(s=>s.id===u.segments[0].sectionId)!;$('section-caption').textContent=sec.title;
      const container=$('scene-content');container.innerHTML=u.segments.map((s,i)=>`<div class="reading-segment ${i===player.part?'active':''}" data-segment="${esc(s.id)}">${i===0||s.field!==u.segments[i-1].field?`<span class="eyebrow field-label">${LABELS[s.field]}</span>`:''}<p>${esc(s.text)}</p></div>`).join('');
      const active=container.querySelector<HTMLElement>('.active');if(active){container.scrollTop+=active.getBoundingClientRect().top-container.getBoundingClientRect().top;}
    }else $('scene-content').innerHTML='<p class="muted">Select a practice to begin.</p>';
  }
  $('position').textContent=`${player.units.length?player.index+1:0} / ${player.units.length}`;
  $('progress-fill').style.width=`${player.units.length?(player.index+1)/player.units.length*100:0}%`;
  const labels={ready:'Take a breath. Begin when you’re ready.',speaking:`Listening · reading ${player.repeat+1} of ${settings.repeats}`,visualizing:'Hold the picture. Let the feeling follow.',paused:'Paused. Your place is saved.',waiting:'Stay with the picture. Tap Next when you’re ready.',completed:'Practice complete. Carry this feeling with you.',error:player.message};
  $('player-status').textContent=sessionPack?(session.ended?'Practice complete.':session.paused?'Ready when you are.':'Listening. You can lock your screen.') :labels[player.phase];$('countdown').hidden=player.phase!=='visualizing';$('countdown').textContent=`${Math.ceil(player.remaining)}s`;
  $('play').textContent=sessionPack?(session.paused?'▶ Play':'Ⅱ Pause'):player.active?'Ⅱ Pause':player.phase==='paused'?'▶ Resume':player.phase==='error'?'↻ Retry':'▶ Play';
  $<HTMLButtonElement>('previous').disabled=player.index===0;$<HTMLButtonElement>('next').disabled=player.index>=player.units.length-1;$<HTMLButtonElement>('play').disabled=!player.unit&&!sessionPack;
  if(sessionPack){$<HTMLButtonElement>('previous').disabled=false;$<HTMLButtonElement>('next').disabled=false;}
  const neural=segment&&speaker.pack?.manifest.clips?.[segment.id];$('engine-label').textContent=sessionPack?'Continuous audio · screen-off playback is automatic':neural?`Local neural audio · ${speaker.pack!.manifest.voice}`:'On-device system speech · import a voice pack for neural narration';
  const shouldPlay=mode==='interactive'&&(player.active||player.phase==='waiting');
  if(!previewing){if(shouldPlay)void startMusic();else queueMicrotask(()=>{if(!previewing&&(mode!=='interactive'||(!player.active&&player.phase!=='waiting')))music.pause();maybeUpdate();});}
  music.volume=settings.musicVolume;
  if(player.active&&document.visibilityState==='visible')void acquireWake();else{wakeRetryAt=0;if(wake){void wake.release();wake=undefined;}}
  if('mediaSession'in navigator&&mode==='interactive')navigator.mediaSession.playbackState=player.active?'playing':'paused';
  maybeUpdate();
}
async function acquireWake(){if(wake||wakePending||Date.now()<wakeRetryAt||!('wakeLock'in navigator))return;wakePending=true;wakeRetryAt=Date.now()+30_000;try{const lock=await navigator.wakeLock.request('screen');if(!player.active||document.hidden){void lock.release();return;}wake=lock;lock.addEventListener('release',()=>{if(wake===lock)wake=undefined;});}catch{/* Wake lock is optional; retry at most every 30 seconds. */}finally{wakePending=false;}}
function renderSounds(){const sounds=[['off','Quiet','Silence'],...SOUNDS,...(customMusic?[['custom','Your audio','On this device']]:[])];$('sounds').innerHTML=sounds.filter(s=>!favoritesOnly||settings.favorites.includes(s[0])).map(([id,title,group])=>`<div class="sound-card ${settings.background===id?'chosen':''}"><button class="sound-choice" data-sound="${id}" aria-pressed="${settings.background===id}"><span class="sound-symbol">${group==='Ambient'?'◌':group==='Noise'?'≋':group==='Silence'?'—':'⌁'}</span><strong>${title}</strong><small>${group}</small></button><button class="favorite" data-favorite="${id}" aria-label="${settings.favorites.includes(id)?'Remove':'Add'} ${title} ${settings.favorites.includes(id)?'from':'to'} favorites">${settings.favorites.includes(id)?'♥':'♡'}</button></div>`).join('')||'<p class="muted">Tap a heart to save a sound here.</p>';$('favorites').textContent=favoritesOnly?'Show all sounds':'♡ Favorites';}
async function startMusic(){
  if(settings.background==='off'){music.pause();return;}
  if(musicKey!==settings.background){musicKey=settings.background;music.src=musicKey==='custom'?customURL:`${base}audio/${musicKey}.wav`;music.volume=settings.musicVolume;}
  if(music.paused)try{await music.play(settings.musicVolume);}catch{previewing=false;$('preview-sound').textContent='Preview sound';notice('Background audio could not start. Tap Preview sound to retry.');}
}
function setMode(next:typeof mode){mode=next;setupMedia();refreshPlayer();}
function playPractice(){
  if(sessionPack){
    // Start the continuous track inside the Play gesture, before iOS suspends
    // the page. Switching tracks after visibilitychange would be too late.
    if(mode!=='session')setMode('session');
    configurePlayback();
    if(session.error)session.load();
    void session.play().catch(error=>{
      const reason=error instanceof DOMException?error.name:'PlaybackError';
      notice(`Audio could not start (${reason}). Try the audio player’s Play control below.`);
    });
  }else player.play();
}
function renderSession(){
  const m=sessionPack?.manifest;$('session-details').textContent=m?`${m.voice} · ${Math.round(m.duration!/60)} minutes · prepared at ${m.rate}×`:'Import a prepared session once to listen with your screen off.';
  $<HTMLButtonElement>('export-audio').disabled=!m;
  $('session-view').hidden=!m;
  session.hidden=!m;
}
function mountSession(){session.pause();if(sessionURL)URL.revokeObjectURL(sessionURL);sessionURL='';session.removeAttribute('src');sessionText.clear();if(sessionPack){sessionText=new Map(segmentsFor(sessionPack.data).map(s=>[s.id,s.text]));sessionURL=URL.createObjectURL(sessionPack.files[sessionPack.manifest.audioFile||'session.m4a']);session.src=sessionURL;session.loop=!!sessionPack.manifest.settings?.loop;$<HTMLInputElement>('loop').checked=session.loop;}renderSession();}
function setupMedia(){if(!('mediaSession'in navigator))return;const media=navigator.mediaSession;media.metadata=new MediaMetadata({title:'Theatre of the Mind',artist:'Private practice',album:'On this device'});
  const actions:Partial<Record<MediaSessionAction,MediaSessionActionHandler>>={play:()=>playPractice(),pause:()=>mode==='session'?session.pause():player.pause(),seekbackward:d=>{if(mode==='session')session.currentTime=Math.max(0,session.currentTime-(d.seekOffset||15));},seekforward:d=>{if(mode==='session')session.currentTime=Math.min(session.duration||0,session.currentTime+(d.seekOffset||15));},seekto:d=>{if(mode==='session'&&d.seekTime!==undefined)session.currentTime=d.seekTime;}};
  for(const [action,fn]of Object.entries(actions))try{media.setActionHandler(action as MediaSessionAction,fn!)}catch{/* Platform dependent. */}
}
async function applyImport(){
  if(!pendingData||importing)return;importing=true;const confirm=$<HTMLButtonElement>('confirm-import');if(confirm){confirm.disabled=true;confirm.textContent='Saving on this device…';}
  try{
  stopAll();const replacement=await fingerprint(pendingData)!==(data?await fingerprint(data):'');data=pendingData;
  if(replacement){voicePack=undefined;sessionPack=undefined;mode='interactive';settings.section='';settings.scene='';}
  if(pendingPack?.manifest.kind==='voice')voicePack=pendingPack;
  if(pendingPack?.manifest.kind==='session')sessionPack=pendingPack;
  speaker.pack=voicePack;normalizeSelection();contentKey='';rebuild();mountSession();render();
  const [storedVoice,storedSession]=await Promise.all([storePack(voicePack),storePack(sessionPack)]);
  await persist([['data',data],['settings',settings],['voicePack',storedVoice],['sessionPack',storedSession]]);
  pendingData=undefined;pendingPack=undefined;$<HTMLDialogElement>('dialog').close();
  if(sessionPack)setMode('session');if(!storageFailed)notice('Imported privately on this device. Export a backup before clearing browser data.');
  }finally{importing=false;if(confirm){confirm.disabled=false;confirm.textContent='Use this practice';}}
}
async function importFile(file:File){
  if(importing){notice('Please wait for the current import to finish saving.');return;}
  stopAll();
  if(file.size>600_000_000)throw Error('Choose a file smaller than 600 MB.');
  const bytes=new Uint8Array(await file.arrayBuffer());pendingPack=undefined;
  if(/\.zip$/i.test(file.name)){pendingPack=await readPack(bytes);pendingData=pendingPack.data;}else if(/\.docx$/i.test(file.name)){if(file.size>20_000_000)throw Error('Choose a DOCX smaller than 20 MB.');pendingData=parseDocx(bytes);}else{pendingData=validateDataset(JSON.parse(new TextDecoder().decode(bytes)));}
  const d=pendingData;const different=data&&await fingerprint(data)!==await fingerprint(d);
  modal(`<span class="eyebrow">IMPORT PREVIEW</span><h2>${esc(d.title)}</h2><p>${d.sections.length} sections · ${d.sections.reduce((n,s)=>n+s.scenes.length,0)} scenes${pendingPack?` · ${pendingPack.manifest.kind==='voice'?'neural voice pack':'prepared session'}`:''}</p><ul>${d.sections.map(s=>`<li>${esc(s.title)} (${s.scenes.length})</li>`).join('')}</ul><p>${different?'This replaces your current document and removes audio packs that belong to it. Export a backup first if needed.':'Everything stays in this browser. No document upload occurs.'}</p><button class="primary" id="confirm-import">Use this practice</button>`);$('confirm-import').onclick=()=>void applyImport().catch(e=>notice(e.message));
}
function prepareDialog(){
  modal(`<span class="eyebrow">NATURAL AUDIO, WITHOUT A SUBSCRIPTION</span><h2>Prepare once. Settle in anywhere.</h2><p>Your Mac creates neural narration locally with Kokoro. Export your current practice choices, then run the preparation tool described in the setup guide.</p><label>Neural voice<select id="neural-voice">${[['af_heart','Heart · American female'],['af_bella','Bella · American female'],['af_nicole','Nicole · American female'],['af_sarah','Sarah · American female'],['am_michael','Michael · American male'],['am_puck','Puck · American male'],['bf_emma','Emma · British female'],['bf_isabella','Isabella · British female'],['bm_george','George · British male'],['bm_fable','Fable · British male']].map(v=>option(v[0],v[1])).join('')}</select></label><p>Recipe: ${player.units.length} ${esc(settings.size)} units · ${settings.repeats} reading(s) each · ${settings.gap}s gaps · ${esc(settings.background)} background.</p><p class="fine">Prepared sessions always advance automatically. Music, pauses, speed, and repeats are fixed in the exported audio. Change the recipe and regenerate to adjust them.${settings.background==='custom'?' Pass your original music file to the Mac tool with --music.':''}</p><button id="export-recipe" class="primary">Export private recipe</button><p><a href="${base}SETUP.html" target="_blank" rel="noopener">Open the setup guide ↗</a></p>`);
  $<HTMLSelectElement>('neural-voice').value=settings.neuralVoice;$('export-recipe').onclick=async()=>{settings.neuralVoice=$<HTMLSelectElement>('neural-voice').value;saveSettings();jsonDownload({version:1,kind:'recipe',fingerprint:await fingerprint(data!),data,settings:{...settings,mode:'timed'}},'practice.recipe.json');};
}
document.querySelectorAll('.import-trigger').forEach(b=>b.addEventListener('click',()=>{$<HTMLInputElement>('import-file').value='';$<HTMLInputElement>('import-file').click();}));
$('import-file').onchange=()=>{const f=$<HTMLInputElement>('import-file').files?.[0];if(f)void importFile(f).catch(e=>{pendingData=undefined;pendingPack=undefined;notice(`Import failed: ${e.message}`)});};
$('close-dialog').onclick=()=>$<HTMLDialogElement>('dialog').close();
$('play').onclick=()=>{if(sessionPack){if(session.paused)playPractice();else session.pause();}else if(player.active)player.pause();else playPractice();};
function sessionUnitStart(delta:number){
  const timings=sessionPack?.manifest.timings||[];
  const starts=timings.filter((t,i)=>!i||t.unitId!==timings[i-1].unitId);
  let index=0;for(let i=0;i<starts.length;i++){if(starts[i].start<=session.currentTime+.05)index=i;}
  const target=starts[Math.max(0,Math.min(starts.length-1,index+delta))];
  if(target)session.currentTime=target.start;
  refreshPlayer();
}
$('previous').onclick=()=>sessionPack?sessionUnitStart(-1):player.navigate(-1);
$('next').onclick=()=>sessionPack?sessionUnitStart(1):player.navigate(1);
$('repeat').onclick=()=>{if(sessionPack){sessionUnitStart(0);playPractice();}else player.repeatNow();};
$('focus').onclick=()=>{const focused=document.body.classList.toggle('focus-mode');$('focus').textContent=focused?'Exit focus':'Focus';$('focus').setAttribute('aria-pressed',String(focused));if(focused)window.scrollTo({top:0,behavior:'instant'});};
for(const id of ['size','range','affirmations']as const)$(id).onchange=()=>{const anchor=player.segment?.id;if(id==='affirmations')settings.affirmations=$<HTMLInputElement>(id).checked;else (settings as unknown as Record<string,unknown>)[id]=$<HTMLSelectElement>(id).value;rebuild(anchor);render();};
$('section').onchange=()=>{settings.section=$<HTMLSelectElement>('section').value;settings.scene='';normalizeSelection();const anchor=segmentsFor(data!).find(s=>s.sectionId===settings.section)?.id;rebuild(anchor);render();};
$('scene').onchange=()=>{settings.scene=$<HTMLSelectElement>('scene').value;const anchor=segmentsFor(data!).find(s=>s.sceneId===settings.scene)?.id;rebuild(anchor);render();};
for(const m of ['manual','timed']as const)$(m+'-mode').onclick=()=>{player.pause();settings.mode=m;rebuild(player.segment?.id);render();};
for(const id of ['gap','rate','voiceVolume','musicVolume']as const)$(id).oninput=()=>{settings[id]=Number($<HTMLInputElement>(id).value);updateValues();saveSettings();music.volume=settings.musicVolume;};
$('voice').onchange=()=>{settings.voice=$<HTMLSelectElement>('voice').value;saveSettings();};
$('repeats').onchange=()=>{const val=$<HTMLSelectElement>('repeats').value;settings.repeats=val==='custom'?4:Number(val);saveSettings();render();};
$('custom-repeats').onchange=()=>{settings.repeats=Math.max(1,Math.min(20,Math.round(Number($<HTMLInputElement>('custom-repeats').value)||1)));saveSettings();render();};
for(const id of ['loop']as const)$(id).onchange=()=>{settings[id]=$<HTMLInputElement>(id).checked;session.loop=settings.loop;saveSettings();refreshPlayer();};
$('sounds').onclick=e=>{const el=(e.target as HTMLElement);const sound=el.closest<HTMLButtonElement>('[data-sound]');const fav=el.closest<HTMLButtonElement>('[data-favorite]');if(sound){settings.background=sound.dataset.sound!;music.pause();saveSettings();renderSounds();if(previewing||player.active||player.phase==='waiting')void startMusic();}if(fav){const id=fav.dataset.favorite!;settings.favorites=settings.favorites.includes(id)?settings.favorites.filter(v=>v!==id):[...settings.favorites,id];saveSettings();renderSounds();}};
$('favorites').onclick=()=>{favoritesOnly=!favoritesOnly;renderSounds();};$('preview-sound').onclick=()=>{if(!session.paused)session.pause();previewing=!previewing;if(previewing)void startMusic();else music.pause();$('preview-sound').textContent=previewing?'Stop preview':'Preview sound';};
$('custom-music').onclick=()=>$<HTMLInputElement>('music-file').click();$('music-file').onchange=async()=>{const f=$<HTMLInputElement>('music-file').files?.[0];if(!f)return;if(f.size>100_000_000){notice('Choose an audio file smaller than 100 MB.');return;}customMusic=f;if(customURL)URL.revokeObjectURL(customURL);customURL=URL.createObjectURL(f);musicKey='';settings.background='custom';await persist([['customMusic',f],['settings',settings]]);renderSounds();};
$('export-audio').onclick=()=>{if(sessionPack)download(sessionPack.files[sessionPack.manifest.audioFile||'session.m4a'],sessionPack.manifest.audioFile==='session.wav'?'theatre-session.wav':'theatre-session.m4a');};
session.onplay=()=>{previewing=false;$('preview-sound').textContent='Preview sound';player.stop();music.pause();refreshPlayer();if('mediaSession'in navigator)navigator.mediaSession.playbackState='playing';};session.onpause=()=>{refreshPlayer();if('mediaSession'in navigator)navigator.mediaSession.playbackState='paused';maybeUpdate();};
session.ontimeupdate=()=>{
  const t=sessionPack?.manifest.timings?.find(t=>session.currentTime>=t.start&&session.currentTime<t.end);
  $('session-caption').textContent=t?sessionText.get(t.segmentId)||'':'A little space to visualize.';
  if(t){const index=player.units.findIndex(u=>u.segments.some(s=>s.id===t.segmentId));if(index>=0){player.index=index;player.part=player.units[index].segments.findIndex(s=>s.id===t.segmentId);}}
  refreshPlayer();
};
session.onended=()=>refreshPlayer();
session.onerror=()=>{if(sessionPack)notice('Prepared audio could not load. Reimport the pack or export the audio for another local player.');};
$('export-data').onclick=()=>data&&jsonDownload(data,'practice.dataset.json');$('prepare').onclick=prepareDialog;
$('guidance').onclick=()=>modal(`<h2>Practice instructions</h2>${data?.guidance.map(t=>`<p>${esc(t)}</p>`).join('')||'<p>Select a scene, listen, and leave yourself time to visualize.</p>'}`);
$('help').onclick=()=>modal(`<h2>Your private practice</h2><p>Documents, audio, and settings stay in this browser’s local storage. Clearing browser data removes them. Use Back up document and keep your original audio packs.</p><p>Local system voices are filtered using the browser’s local-service flag. Neural narration is generated on your Mac. The app makes no document uploads and includes no analytics.</p><p>The host receives ordinary requests for app files; no personal practice data is included. The app does not protect data from someone with access to your unlocked device.</p><p>Install on iPhone: open the HTTPS site in Safari → Share → Add to Home Screen. Import files through the iPhone Files picker.</p><p>Play automatically uses your imported prepared session for screen-off listening. Without a prepared session, interactive speech pauses when hidden.</p><a href="${base}SETUP.html" target="_blank" rel="noopener">Full setup & preparation guide ↗</a>`);
$('delete').onclick=()=>{modal('<h2>Delete local data?</h2><p>This removes this browser’s practice, audio packs, imported music, and preferences. It does not delete files saved in Files or on your Mac.</p><button id="confirm-delete" class="danger">Delete everything on this device</button>');$('confirm-delete').onclick=async()=>{try{stopAll();clearTimeout(saving);await storage.clear();location.reload();}catch{notice('Storage could not be cleared. Use your browser’s website-data settings.');}};};
$('demo').onclick=()=>{pendingData={version:1,title:'A moment of presence',guidance:['A short, fictional sample. Import your own document when you are ready.'],sections:[{id:'section-1',title:'Presence & intention',scenes:[{id:'scene-1',number:1,line:'I give this moment my full attention.',scenario:'A quiet morning. There is a little space before the day begins.',reaction:'See yourself set the phone down. Let your shoulders soften and take one unhurried breath.',pivot:'Feel the ease of being here, with nothing else to do just yet.'},{id:'scene-2',number:2,line:'I begin with one small, deliberate action.',scenario:'Something meaningful is waiting for your attention.',reaction:'See yourself take the first simple step. There is no need to rush.',pivot:'Feel the quiet satisfaction of having begun.'}]}]};void applyImport();};
document.addEventListener('visibilitychange',()=>{if(document.hidden&&mode==='interactive'&&(player.active||previewing||!music.paused)){player.pause();music.pause();previewing=false;$('preview-sound').textContent='Preview sound';notice(sessionPack?'Tap Play to continue with your prepared session.':'Import a prepared session once to enable screen-off listening automatically.');}else if(!document.hidden)refreshPlayer();});
window.addEventListener('pagehide',()=>{if(mode==='interactive'){player.pause();music.pause();}});
if('speechSynthesis'in window)speechSynthesis.addEventListener('voiceschanged',renderVoices);
let sw:ServiceWorkerRegistration|undefined,reloadPending=false;
function maybeUpdate(){
  if(importing||player.active||!session.paused||previewing||!music.paused)return;
  if(reloadPending){location.reload();return;}
  if(sw?.waiting)sw.waiting.postMessage('ACTIVATE');
}
async function boot(){
  try{const [d,s,v,p,c]=await Promise.all([storage.get<Dataset>('data'),storage.get<Settings>('settings'),storage.get<StoredAudioPack>('voicePack'),storage.get<StoredAudioPack>('sessionPack'),storage.get<Blob>('customMusic')]);
    if(d)data=validateDataset(d);if(s)Object.assign(settings,defaults,s);settings.duck=false;settings.repeats=Math.max(1,Math.min(20,settings.repeats));
    if(data){const hash=await fingerprint(data);if(v?.manifest.fingerprint===hash)voicePack=restorePack(v);if(p?.manifest.fingerprint===hash)sessionPack=restorePack(p);}
    if(sessionPack)mode='session';
    if(c){customMusic=c;customURL=URL.createObjectURL(c);}if(settings.background==='custom'&&!c)settings.background='off';
  }catch{notice('Local storage is unavailable. You can still import and practice, but keep a backup.');}
  speaker.pack=voicePack;normalizeSelection();rebuild();mountSession();render();setMode(mode);
  if('serviceWorker'in navigator&&import.meta.env.PROD){try{const updating=!!navigator.serviceWorker.controller;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(updating){reloadPending=true;maybeUpdate();}});sw=await navigator.serviceWorker.register(`${base}sw.js`);sw.addEventListener('updatefound',()=>{sw?.installing?.addEventListener('statechange',maybeUpdate)});maybeUpdate();}catch{notice('Offline installation was unavailable. Keep this page open, or reload over HTTPS.');}}
}
void boot().catch(()=>notice('The player could not finish opening. Reload the page to retry. Your saved files have not been deleted.'));
