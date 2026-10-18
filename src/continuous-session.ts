import type {AudioPack,Timing} from './audio';
import {makeUnits,type Settings} from './model';
const RATE=22050;
export function recipeKey(settings:Settings){const {size,range,section,scene,affirmations,gap,rate,repeats,background,musicVolume,voiceVolume}=settings;return JSON.stringify({size,range,section,scene,affirmations,gap,rate,repeats,background,musicVolume,voiceVolume});}
export async function continuousSession(voice:AudioPack,settings:Settings,background:Blob|undefined,signal:AbortSignal):Promise<AudioPack>{
  const context=new OfflineAudioContext(1,1,RATE),clips:Record<string,Float32Array>={},units=makeUnits(voice.data,settings);
  const decode=async(blob:Blob)=>{
    if(signal.aborted)throw new DOMException('Preparation cancelled','AbortError');
    const buffer=await context.decodeAudioData(await blob.arrayBuffer());
    const mono=new Float32Array(buffer.length);
    for(let c=0;c<buffer.numberOfChannels;c++){const channel=buffer.getChannelData(c);for(let i=0;i<mono.length;i++)mono[i]+=channel[i]/buffer.numberOfChannels;}
    return mono;
  };
  for(const id of new Set(units.flatMap(u=>u.segments.map(s=>s.id)))){
    const path=voice.manifest.clips?.[id],blob=path&&voice.files[path];
    if(!blob)throw Error('This voice pack is missing narration. Import the complete voice pack to continue.');
    clips[id]=await decode(blob);
  }
  let time=.25;const timings:Timing[]=[];
  for(const unit of units)for(let repeat=0;repeat<settings.repeats;repeat++){
    for(const segment of unit.segments){const end=time+clips[segment.id].length/RATE*voice.manifest.rate/settings.rate;timings.push({start:time,end,segmentId:segment.id,unitId:unit.id,repeat});time=end+.15;}
    time+=settings.gap;
  }
  if(!timings.length||time>1800)throw Error('Choose a practice shorter than 30 minutes for automatic screen-off audio.');
  const music=background?await decode(background):undefined;
  if(signal.aborted)throw new DOMException('Preparation cancelled','AbortError');
  // The worker joins decoded PCM without OfflineAudioContext.startRendering(),
  // and writes one output buffer instead of allocating an entire render graph.
  const worker=new Worker(new URL('./session-mixer.worker.ts',import.meta.url),{type:'module'});
  const bytes=await new Promise<ArrayBuffer>((resolve,reject)=>{
    const abort=()=>{worker.terminate();reject(new DOMException('Preparation cancelled','AbortError'));};
    signal.addEventListener('abort',abort,{once:true});
    worker.onmessage=e=>{signal.removeEventListener('abort',abort);worker.terminate();if(e.data.error)reject(Error(e.data.error));else resolve(e.data.bytes);};
    worker.onerror=()=>{signal.removeEventListener('abort',abort);worker.terminate();reject(Error('Audio preparation failed. Tap Play to retry.'));};
    worker.postMessage({rate:RATE,duration:time,clips,timings,background:music,musicVolume:settings.musicVolume,voiceVolume:settings.voiceVolume},[...Object.values(clips).map(c=>c.buffer),...(music?[music.buffer]:[])]);
  });
  return {data:voice.data,manifest:{version:1,kind:'session',audioFile:'session.wav',fingerprint:voice.manifest.fingerprint,voice:voice.manifest.voice,rate:settings.rate,duration:time,timings,settings:{...settings,mode:'timed',duck:false},generated:true},files:{'session.wav':new Blob([bytes],{type:'audio/wav'})}};
}
