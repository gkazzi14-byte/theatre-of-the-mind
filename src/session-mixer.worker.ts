interface MixJob {rate:number;duration:number;clips:Record<string,Float32Array>;timings:{start:number;end:number;segmentId:string}[];background?:Float32Array;musicVolume:number;voiceVolume:number}
self.onmessage=(event:MessageEvent<MixJob>)=>{
  try{
    const job=event.data,n=Math.ceil(job.duration*job.rate);
    if(!Number.isFinite(n)||n<=0||job.duration>1800)throw Error('Choose a practice shorter than 30 minutes.');
    const bytes=new ArrayBuffer(44+n*2),view=new DataView(bytes);
    const tag=(offset:number,text:string)=>{for(let i=0;i<text.length;i++)view.setUint8(offset+i,text.charCodeAt(i));};
    tag(0,'RIFF');view.setUint32(4,bytes.byteLength-8,true);tag(8,'WAVE');tag(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,job.rate,true);view.setUint32(28,job.rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);tag(36,'data');view.setUint32(40,n*2,true);
    const pcm=new Int16Array(bytes,44),background=job.background;
    const encode=(v:number)=>Math.round(Math.max(-1,Math.min(1,v))*32767);
    if(background?.length)for(let i=0;i<n;i++)pcm[i]=encode(background[i%background.length]*job.musicVolume);
    for(const timing of job.timings){
      const clip=job.clips[timing.segmentId],start=Math.round(timing.start*job.rate),end=Math.min(n,Math.round(timing.end*job.rate));
      for(let i=start;i<end;i++){
        const position=(i-start)*clip.length/(end-start),index=Math.floor(position),fraction=position-index;
        const sample=clip[index]*(1-fraction)+(clip[Math.min(index+1,clip.length-1)]||0)*fraction;
        pcm[i]=encode(pcm[i]/32767+sample*job.voiceVolume);
      }
    }
    self.postMessage({bytes}, {transfer:[bytes]});
  }catch(error){self.postMessage({error:error instanceof Error?error.message:'Audio preparation failed.'});}
};
