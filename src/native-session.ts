import {Capacitor,registerPlugin,type PluginListenerHandle} from '@capacitor/core';
import type {AudioPack} from './audio';

export const nativeIOS=Capacitor.isNativePlatform()&&Capacitor.getPlatform()==='ios';
export interface NativeState {id:string;position:number;duration:number;playing:boolean;ended:boolean;error?:string}
export interface NativeAudioPlugin {
  begin(options:{id:string;extension:string;size:number}):Promise<void>;
  append(options:{id:string;data:string}):Promise<void>;
  finish(options:{id:string;title:string;loop:boolean;starts:number[]}):Promise<NativeState>;
  clear():Promise<void>;
  play():Promise<NativeState>;
  pause():Promise<NativeState>;
  seek(options:{position:number}):Promise<NativeState>;
  setLoop(options:{loop:boolean}):Promise<void>;
  state():Promise<NativeState>;
  share(options:{name:string;text?:string}):Promise<void>;
  addListener(event:'state',listener:(state:NativeState)=>void):Promise<PluginListenerHandle>;
}
const plugin=registerPlugin<NativeAudioPlugin>('TheatreAudio');

// Transfer bounded chunks. A whole session can be hundreds of MB; encoding it
// as one base64 message would exhaust a phone's WebView memory.
export async function transferSession(bridge:NativeAudioPlugin,blob:Blob,id:string,extension:string,metadata:{title:string;loop:boolean;starts:number[]},current:()=>boolean){
  await bridge.begin({id,extension,size:blob.size});
  for(let offset=0;offset<blob.size;offset+=192*1024){
    if(!current())return;
    const bytes=new Uint8Array(await blob.slice(offset,offset+192*1024).arrayBuffer());
    let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    await bridge.append({id,data:btoa(binary)});
  }
  if(current())return bridge.finish({id,...metadata});
}

export class NativeSession {
  paused=true;ended=false;duration=NaN;error:Error|null=null;loading=false;
  onplay?:()=>void;onpause?:()=>void;ontimeupdate?:()=>void;onended?:()=>void;onerror?:()=>void;
  private position=0;private looping=false;private id='';
  private ready:Promise<void>=Promise.resolve();
  private listening:Promise<PluginListenerHandle>;
  private operations:Promise<unknown>=Promise.resolve();
  constructor(private bridge:NativeAudioPlugin=plugin){
    this.listening=bridge.addListener('state',state=>this.receive(state));
    // A WebView can miss callbacks while suspended. Read the native clock on
    // return; native audio never depends on these JavaScript callbacks.
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)void bridge.state().then(state=>this.receive(state)).catch(()=>{});});
  }
  get currentTime(){return this.position;}
  set currentTime(position:number){void this.command(()=>this.bridge.seek({position}));}
  get loop(){return this.looping;}
  set loop(loop:boolean){this.looping=loop;void this.ready.then(()=>this.bridge.setLoop({loop})).catch(error=>this.fail(error));}
  private receive(state:NativeState){
    if(state.id!==this.id)return;
    const wasPaused=this.paused,wasEnded=this.ended;
    this.position=state.position;this.duration=state.duration;this.paused=!state.playing;this.ended=state.ended;
    if(state.error){this.fail(new Error(state.error));return;}
    if(wasPaused!==this.paused){if(this.paused)this.onpause?.();else this.onplay?.();}
    this.ontimeupdate?.();if(this.ended&&!wasEnded)this.onended?.();
  }
  private fail(error:unknown){this.error=error instanceof Error?error:new Error(String(error));this.paused=true;this.loading=false;this.onerror?.();}
  setSource(pack:AudioPack){
    const id=crypto.randomUUID();this.id=id;this.error=null;this.position=0;this.duration=pack.manifest.duration!;this.paused=true;this.ended=false;this.loading=true;
    const file=pack.manifest.audioFile||'session.m4a',timings=pack.manifest.timings||[];
    this.ready=this.listening.then(async()=>{
      const state=await transferSession(this.bridge,pack.files[file],id,file.endsWith('.wav')?'wav':'m4a',{
        title:pack.data.title,loop:this.looping,starts:timings.filter((t,i)=>!i||t.unitId!==timings[i-1].unitId).map(t=>t.start),
      },()=>this.id===id);
      if(this.id===id){this.loading=false;if(state)this.receive(state);}
    }).catch(error=>{if(this.id===id)this.fail(error);});
  }
  clear(){this.id='';this.loading=false;this.paused=true;this.ended=false;this.position=0;this.duration=NaN;this.ready=this.bridge.clear().catch(error=>this.fail(error));return this.ready;}
  private command(action:()=>Promise<NativeState>){
    // Preserve seek/play/pause ordering across the asynchronous native bridge.
    const id=this.id,ready=this.ready;
    const result=this.operations.then(()=>ready).then(async()=>{if(this.id===id&&!this.error)this.receive(await action());});
    this.operations=result.catch(error=>this.fail(error));return result;
  }
  play(){return this.command(()=>this.bridge.play());}
  pause(){void this.command(()=>this.bridge.pause()).catch(()=>{});}
  async share(name:string,text?:string){if(text===undefined)await this.ready;await this.bridge.share({name,text});}
}
