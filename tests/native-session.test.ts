import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {NativeSession,transferSession,type NativeAudioPlugin,type NativeState} from '../src/native-session';
import {defaults} from '../src/model';
import type {AudioPack} from '../src/audio';

globalThis.document=new JSDOM('').window.document;
function harness(){
  let listener=(_:NativeState)=>{};
  let state:NativeState={id:'',position:0,duration:30,playing:false,ended:false};
  let loop=false,cleared=false;
  const chunks:Uint8Array[]=[],controls:string[]=[];
  const bridge:NativeAudioPlugin={
    begin:async({id})=>{state={...state,id};chunks.length=0;},
    append:async({data})=>{chunks.push(Uint8Array.from(atob(data),c=>c.charCodeAt(0)));},
    finish:async()=>state,
    clear:async()=>{cleared=true;state={...state,id:'',playing:false};},
    play:async()=>{controls.push('play');state={...state,playing:true};return state;},
    pause:async()=>{controls.push('pause');state={...state,playing:false};return state;},
    seek:async({position})=>{controls.push(`seek:${position}`);state={...state,position};return state;},
    setLoop:async value=>{loop=value.loop;},state:async()=>state,
    share:async()=>{},
    addListener:async(_,fn)=>{listener=fn;return {remove:async()=>{}};},
  };
  return {bridge,chunks,controls,emit:(update:Partial<NativeState>)=>{state={...state,...update};listener(state);},loop:()=>loop,cleared:()=>cleared};
}
const pack:AudioPack={
  data:{version:1,title:'Synthetic practice',guidance:[],sections:[]},
  manifest:{version:1,kind:'session',fingerprint:'test',voice:'Synthetic',rate:1,duration:30,audioFile:'session.wav',timings:[],settings:{...defaults}},
  files:{'session.wav':new Blob([new Uint8Array([1,2,3,4])])},
};
test('native file transfer preserves every byte with bounded bridge messages',async()=>{
  const h=harness(),bytes=Uint8Array.from({length:500_003},(_,i)=>i%251);
  const state=await transferSession(h.bridge,new Blob([bytes]),'test','wav',{title:'Test',loop:true,starts:[0,12]},()=>true);
  assert.equal(state?.id,'test');assert.equal(h.chunks.length,3);
  assert.ok(h.chunks.every(chunk=>chunk.length<=192*1024));
  assert.deepEqual(Buffer.concat(h.chunks),Buffer.from(bytes));
});
test('cancelled native transfer cannot finish and replace a newer session',async()=>{
  const h=harness();let current=true,finished=false;
  const append=h.bridge.append;h.bridge.append=async value=>{await append(value);current=false;};
  h.bridge.finish=async()=>{finished=true;throw Error('must not finish');};
  await transferSession(h.bridge,new Blob([new Uint8Array(400_000)]),'cancelled','wav',{title:'Test',loop:false,starts:[]},()=>current);
  assert.equal(h.chunks.length,1);assert.equal(finished,false);
});
test('native controls preserve seek/play/pause order and accept lock-screen state',async()=>{
  const h=harness(),session=new NativeSession(h.bridge);let plays=0,pauses=0;
  session.onplay=()=>plays++;session.onpause=()=>pauses++;
  session.setSource(pack);session.currentTime=12;
  const playing=session.play();session.pause();await playing;
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.deepEqual(h.controls,['seek:12','play','pause']);assert.equal(session.currentTime,12);assert.equal(session.paused,true);
  h.emit({playing:true,position:18});assert.equal(session.paused,false);assert.equal(session.currentTime,18);
  h.emit({id:'old-session',playing:false,position:0});assert.equal(session.currentTime,18);
  assert.equal(plays,2);assert.equal(pauses,1);
  session.loop=true;await new Promise(resolve=>setTimeout(resolve,0));assert.equal(h.loop(),true);
  await session.clear();assert.equal(h.cleared(),true);assert.equal(session.paused,true);
});
test('native transfer failure is visible and cannot start missing audio',async()=>{
  const h=harness();h.bridge.append=async()=>{throw Error('Storage full');};
  const session=new NativeSession(h.bridge);let error='';session.onerror=()=>{error=session.error?.message||'';};
  session.setSource(pack);await session.play();
  assert.equal(error,'Storage full');assert.equal(session.loading,false);assert.equal(session.paused,true);assert.deepEqual(h.controls,[]);
});
