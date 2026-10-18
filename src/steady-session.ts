import type {AudioPack} from './audio';

// Render a single native media track, so phone playback needs no background
// timers, Web Audio context, or individual clip changes after the screen locks.
export async function steadySession(voice:AudioPack,session:AudioPack,background?:Blob):Promise<AudioPack>{
  const m=session.manifest,settings=m.settings;
  if(!settings||!m.duration||!m.timings||voice.manifest.fingerprint!==m.fingerprint)throw Error('Matching narration is needed to update this session.');
  // Bound peak decoded/rendered PCM memory on phones. Longer existing sessions
  // remain playable without attempting an oversized in-browser allocation.
  if(m.duration>30*60)throw Error('This session is too long to remix on this phone.');
  const rate=22050;
  const context=new OfflineAudioContext(1,Math.ceil(m.duration*rate),rate);
  const buffers=new Map<string,AudioBuffer>();
  for(const id of new Set(m.timings.map(t=>t.segmentId))){
    const path=voice.manifest.clips?.[id],blob=path&&voice.files[path];
    if(!blob)throw Error('The voice pack is missing a session clip.');
    buffers.set(id,await context.decodeAudioData(await blob.arrayBuffer()));
  }
  const narration=context.createGain();narration.gain.value=settings.voiceVolume;narration.connect(context.destination);
  for(const t of m.timings){
    const source=context.createBufferSource();source.buffer=buffers.get(t.segmentId)!;
    // Preserve the existing timeline, including codec padding in imported clips.
    source.playbackRate.value=source.buffer.duration/(t.end-t.start);
    source.connect(narration);source.start(t.start);source.stop(t.end);
  }
  if(settings.background!=='off'){
    if(!background)throw Error('The original background audio is unavailable.');
    const source=context.createBufferSource(),gain=context.createGain();
    source.buffer=await context.decodeAudioData(await background.arrayBuffer());source.loop=true;
    gain.gain.setValueAtTime(0,0);gain.gain.linearRampToValueAtTime(settings.musicVolume,Math.min(1.5,m.duration/4));
    gain.gain.setValueAtTime(settings.musicVolume,Math.max(m.duration/2,m.duration-1.5));gain.gain.linearRampToValueAtTime(0,m.duration);
    source.connect(gain).connect(context.destination);source.start();
  }
  const rendered=await context.startRendering(),samples=rendered.getChannelData(0);
  const bytes=new ArrayBuffer(44+samples.length*2),view=new DataView(bytes);
  const tag=(offset:number,value:string)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
  tag(0,'RIFF');view.setUint32(4,bytes.byteLength-8,true);tag(8,'WAVE');tag(12,'fmt ');
  view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
  view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);
  tag(36,'data');view.setUint32(40,samples.length*2,true);
  for(let i=0;i<samples.length;i++)view.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,samples[i]))*32767),true);
  return {data:session.data,manifest:{...m,audioFile:'session.wav',settings:{...settings,duck:false}},files:{'session.wav':new Blob([bytes],{type:'audio/wav'})}};
}
