import type { Unit, Settings, Segment } from './model';
export type Phase='ready'|'speaking'|'visualizing'|'paused'|'waiting'|'completed'|'error';
export interface Speaker {speak(segment:Segment,settings:Settings,done:()=>void,error:(message:string)=>void):void;cancel():void}
export interface Clock { now():number; every(fn:()=>void):unknown; clear(id:unknown):void }
const realClock:Clock={now:()=>Date.now(),every:fn=>setInterval(fn,100),clear:id=>clearInterval(id as number)};
export class Player {
  phase:Phase='ready';index=0;part=0;repeat=0;remaining=0;message='';
  private timer:unknown;private deadline=0;private token=0;private pausedPhase:Phase='ready';private gapPending=false;
  constructor(public units:Unit[],public settings:Settings,private speaker:Speaker,private changed:()=>void,private clock:Clock=realClock){}
  get unit(){return this.units[this.index]}
  get segment(){return this.unit?.segments[this.part]}
  get active(){return this.phase==='speaking'||this.phase==='visualizing'}
  private clear(){this.token++;this.speaker.cancel();if(this.timer!==undefined)this.clock.clear(this.timer);this.timer=undefined;}
  private emit(){this.changed()}
  setUnits(units:Unit[],anchor?:string){this.clear();this.units=units;this.index=Math.max(0,units.findIndex(u=>u.segments.some(s=>s.id===anchor)));this.part=0;this.repeat=0;this.gapPending=false;this.phase='ready';this.emit();}
  play(){if(!this.unit)return;if(this.active)return;if(this.phase==='completed'){this.index=0;this.part=0;this.repeat=0;}
    if(this.phase==='paused'&&this.pausedPhase==='visualizing'){this.startGap(this.remaining);return;}
    if(this.phase==='waiting'){this.part=0;this.repeat=0;}this.speak();}
  pause(){if(!this.active)return;this.pausedPhase=this.phase;if(this.phase==='visualizing')this.remaining=Math.max(0,(this.deadline-this.clock.now())/1000);this.clear();this.phase='paused';this.emit();}
  navigate(delta:number){const resume=this.active||this.phase==='waiting';this.clear();this.index=Math.max(0,Math.min(this.units.length-1,this.index+delta));this.part=0;this.repeat=0;this.gapPending=false;this.phase='ready';this.emit();if(resume)this.speak();}
  jump(index:number){const resume=this.active;this.clear();this.index=Math.max(0,Math.min(this.units.length-1,index));this.part=0;this.repeat=0;this.gapPending=false;this.phase='ready';this.emit();if(resume)this.speak();}
  repeatNow(){if(!this.unit)return;this.clear();this.part=0;this.repeat=0;this.gapPending=false;this.speak();}
  stop(){this.clear();this.phase='ready';this.part=0;this.repeat=0;this.gapPending=false;this.emit();}
  private speak(){
    this.clear();const seg=this.segment;if(!seg)return;this.phase='speaking';this.emit();const token=this.token;
    this.speaker.speak(seg,this.settings,()=>{if(token!==this.token||this.phase!=='speaking')return;
      if(this.part+1<this.unit.segments.length){this.part++;this.speak();return;}
      if(this.settings.mode==='timed'||this.repeat+1<this.settings.repeats){this.gapPending=true;this.startGap(this.settings.gap);}else{this.phase=this.index===this.units.length-1?'completed':'waiting';this.emit();}
    },message=>{if(token!==this.token)return;this.clear();this.message=message;this.phase='error';this.emit();});
  }
  private startGap(seconds:number){this.clear();this.phase='visualizing';this.remaining=seconds;this.deadline=this.clock.now()+seconds*1000;const token=this.token;this.emit();
    this.timer=this.clock.every(()=>{if(token!==this.token)return;this.remaining=Math.max(0,(this.deadline-this.clock.now())/1000);this.emit();if(this.remaining<=0){this.clear();this.gapPending=false;this.afterGap();}});
  }
  private afterGap(){
    if(this.repeat+1<this.settings.repeats){this.repeat++;this.part=0;this.speak();return;}
    this.repeat=0;this.part=0;
    if(this.settings.mode==='manual'){this.phase=this.index===this.units.length-1?'completed':'waiting';this.emit();return;}
    if(this.index+1<this.units.length){this.index++;this.speak();return;}
    if(this.settings.loop){this.index=0;this.speak();return;}
    this.phase='completed';this.emit();
  }
}
