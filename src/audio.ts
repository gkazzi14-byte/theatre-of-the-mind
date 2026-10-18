import type { Segment, Settings, Dataset } from './model';
import { fingerprint, validateDataset, segmentsFor } from './model';
import type { Speaker } from './player';
import { unzipSync, strFromU8 } from 'fflate';
import {playForeground} from './foreground-audio';

export interface Timing {start:number;end:number;segmentId:string;unitId:string;repeat:number}
export interface PackManifest {generated?:boolean;audioFile?:'session.wav'|'session.m4a';version:1;kind:'voice'|'session';fingerprint:string;voice:string;rate:number;clips?:Record<string,string>;timings?:Timing[];duration?:number;settings?:Settings}
export interface AudioPack {manifest:PackManifest;data:Dataset;files:Record<string,Blob>}
export interface StoredAudioPack {manifest:PackManifest;data:Dataset;files:Record<string,{bytes:ArrayBuffer;type:string}|Blob>}
export async function storePack(pack:AudioPack|undefined):Promise<StoredAudioPack|undefined>{
  if(!pack)return undefined;
  // ArrayBuffers avoid Safari's expensive multi-Blob IndexedDB serialization.
  const files=Object.fromEntries(await Promise.all(Object.entries(pack.files).map(async([name,blob])=>[name,{bytes:await blob.arrayBuffer(),type:blob.type}])));
  return {manifest:pack.manifest,data:pack.data,files};
}
export function restorePack(pack:StoredAudioPack):AudioPack{
  return {...pack,files:Object.fromEntries(Object.entries(pack.files).map(([name,file])=>[name,file instanceof Blob?file:new Blob([file.bytes],{type:file.type})]))};
}
export async function readPack(bytes:Uint8Array):Promise<AudioPack>{
  let total=0;
  const raw=unzipSync(bytes,{filter:f=>{total+=f.originalSize;if(total>600_000_000)throw Error('Audio pack is too large (600 MB limit).');return true;}});
  if(!raw['manifest.json']||!raw['dataset.json'])throw Error('This is not a Theatre audio pack.');
  const data=validateDataset(JSON.parse(strFromU8(raw['dataset.json'])));
  const m=JSON.parse(strFromU8(raw['manifest.json'])) as PackManifest;
  if(m.version!==1||!['voice','session'].includes(m.kind)||m.fingerprint!==await fingerprint(data)||typeof m.voice!=='string'||!Number.isFinite(m.rate)||m.rate<.8||m.rate>1.5)throw Error('This audio pack is invalid or does not match its document.');
  const ids=new Set(segmentsFor(data).map(s=>s.id));const files:Record<string,Blob>={};
  if(m.kind==='voice'){
    if(!m.clips||!Object.keys(m.clips).length)throw Error('The voice pack has no clips.');
    for(const [id,path]of Object.entries(m.clips)){if(!ids.has(id)||typeof path!=='string'||!/^clips\/[a-zA-Z0-9_.-]+\.(wav|m4a)$/.test(path)||!raw[path])throw Error('Voice pack has missing or invalid clips.');files[path]=new Blob([raw[path] as BlobPart],{type:path.endsWith('.m4a')?'audio/mp4':'audio/wav'});}
  }else{
    const audioFile=m.audioFile||'session.m4a';
    if(!['session.m4a','session.wav'].includes(audioFile))throw Error('Session audio format is invalid.');
    if(!raw[audioFile]||!Number.isFinite(m.duration)||m.duration!<=0||!Array.isArray(m.timings)||!m.timings.length)throw Error('Session audio or timing data is missing.');
    let end=0;for(const t of m.timings){if(!ids.has(t.segmentId)||typeof t.unitId!=='string'||!Number.isFinite(t.start)||!Number.isFinite(t.end)||t.start<end-.01||t.end<=t.start||t.end>m.duration!+.1||!Number.isInteger(t.repeat)||t.repeat<0)throw Error('Session timing data is invalid.');end=t.end;}
    files[audioFile]=new Blob([raw[audioFile] as BlobPart],{type:audioFile.endsWith('.wav')?'audio/wav':'audio/mp4'});
  }
  return {manifest:m,data,files};
}
export class BrowserSpeaker implements Speaker {
  private audio=new Audio();private url='';private serial=0;private utterance?:SpeechSynthesisUtterance;
  pack?:AudioPack;
  speak(segment:Segment,s:Settings,done:()=>void,error:(message:string)=>void){
    this.cancel();const serial=this.serial;
    const file=this.pack?.manifest.clips?.[segment.id];
    if(file&&this.pack?.files[file]){
      this.url=URL.createObjectURL(this.pack.files[file]);this.audio.src=this.url;this.audio.volume=s.voiceVolume;
      this.audio.playbackRate=s.rate/this.pack.manifest.rate;this.audio.preservesPitch=true;
      this.audio.onended=()=>{if(serial===this.serial)done()};this.audio.onerror=()=>{if(serial===this.serial)error('The narration clip could not play. Try importing the voice pack again.')};
      void playForeground(this.audio,s.voiceVolume).catch(()=>{if(serial===this.serial)error('Tap Play to allow audio, then try again.');});return;
    }
    if(!('speechSynthesis'in window)){error('Speech is unavailable here. Import a prepared voice pack to listen.');return;}
    const voices=window.speechSynthesis.getVoices().filter(v=>v.localService&&v.lang.startsWith('en'));
    const voice=voices.find(v=>v.voiceURI===s.voice)||voices[0];
    if(!voice){error('No local English voice is available. Check downloaded iPhone voices, or import a neural voice pack from your Mac.');return;}
    const u=new SpeechSynthesisUtterance(segment.text);this.utterance=u;u.voice=voice;u.lang=voice.lang;u.rate=s.rate;u.volume=s.voiceVolume;
    u.onend=()=>{if(serial===this.serial)done()};u.onerror=e=>{if(serial===this.serial&&e.error!=='canceled'&&e.error!=='interrupted')error(`Speech stopped (${e.error}). Tap Play to retry this sentence.`)};
    window.speechSynthesis.speak(u);
  }
  cancel(){this.serial++;this.audio.onended=null;this.audio.onerror=null;this.audio.pause();this.audio.removeAttribute('src');if(this.url){URL.revokeObjectURL(this.url);this.url='';}if('speechSynthesis'in window)window.speechSynthesis.cancel();this.utterance=undefined;}
}
