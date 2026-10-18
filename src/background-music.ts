import {foregroundContext} from './foreground-audio';

// Decode once and loop on the audio rendering thread, not through media seeks
// or JavaScript timers. Speech changes must never restart this source.
export class BackgroundMusic {
  private source?:AudioBufferSourceNode;
  private gain?:GainNode;
  private buffer?:AudioBuffer;
  private bufferURL='';
  private request=0;
  private pending?:Promise<void>;
  private level=0;
  private url='';
  private offset=0;
  private started=0;
  get paused(){return !this.source&&!this.pending;}
  get src(){return this.url;}
  set src(value:string){if(value===this.url)return;this.pause();this.url=value;this.buffer=undefined;this.bufferURL='';this.offset=0;}
  set volume(value:number){
    this.level=value;
    if(this.gain){const context=foregroundContext();this.gain.gain.setTargetAtTime(value,context.currentTime,.3);}
  }
  async play(volume:number){
    this.volume=volume;
    const context=foregroundContext();
    const resumed=context.resume(); // Keep resume in the initiating tap.
    if(this.source){await resumed;return;}
    if(this.pending){await resumed;return this.pending;}
    const token=++this.request,url=this.url;
    const work=(async()=>{
      const [buffer]=await Promise.all([
        this.bufferURL===url&&this.buffer?Promise.resolve(this.buffer):fetch(url).then(r=>{if(!r.ok)throw Error('Background sound could not load.');return r.arrayBuffer();}).then(b=>context.decodeAudioData(b)),
        resumed
      ]);
      if(token!==this.request)return;
      this.buffer=buffer;this.bufferURL=url;
      const source=context.createBufferSource(),gain=context.createGain();
      source.buffer=buffer;source.loop=true;gain.gain.setValueAtTime(0,context.currentTime);
      gain.gain.linearRampToValueAtTime(this.level,context.currentTime+.15);
      source.connect(gain).connect(context.destination);
      this.source=source;this.gain=gain;this.started=context.currentTime;
      source.start(0,this.offset%buffer.duration);
    })();
    this.pending=work;
    try{await work;}finally{if(this.pending===work)this.pending=undefined;}
  }
  pause(){
    ++this.request;this.pending=undefined;
    if(this.source){
      const context=foregroundContext();
      this.offset=(this.offset+context.currentTime-this.started)%(this.buffer?.duration||1);
      this.source.stop();this.source.disconnect();this.gain?.disconnect();
      this.source=undefined;this.gain=undefined;
    }
  }
}
