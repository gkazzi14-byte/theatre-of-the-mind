// iOS may ignore HTMLMediaElement.volume. Foreground-only gain nodes provide
// music/narration balance. Prepared sessions deliberately bypass Web Audio.
let context:AudioContext|undefined;
const gains=new WeakMap<HTMLMediaElement,GainNode>();
export function foregroundVolume(audio:HTMLMediaElement,volume:number){
  const gain=gains.get(audio);
  if(gain&&context){gain.gain.cancelScheduledValues(context.currentTime);gain.gain.setTargetAtTime(volume,context.currentTime,.16);}
  else audio.volume=volume;
}
export function configurePlayback(){
  // Supported by Safari; optional on other browsers.
  const nav=navigator as Navigator&{audioSession?:{type:string}};
  try{if(nav.audioSession)nav.audioSession.type='playback';}catch{/* Optional API. */}
}
export function foregroundContext(){
  configurePlayback();
  return context??=new AudioContext({latencyHint:'playback'});
}
export async function playForeground(audio:HTMLMediaElement,volume:number){
  configurePlayback();
  if('AudioContext'in window){
    context=foregroundContext();
    if(!gains.has(audio)){const source=context.createMediaElementSource(audio),gain=context.createGain();gain.gain.value=volume;source.connect(gain).connect(context.destination);gains.set(audio,gain);}
    audio.volume=1;foregroundVolume(audio,volume);
    // Invoke both while the initiating user gesture is still in scope.
    await Promise.all([context.resume(),audio.play()]);
  }else{audio.volume=volume;await audio.play();}
}
