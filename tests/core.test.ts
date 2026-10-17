import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {zipSync,strToU8} from 'fflate';
import {readFile} from 'node:fs/promises';
import {defaults,makeUnits,parseDocx,validateDataset,fingerprint,type Dataset} from '../src/model';
import {Player,type Clock,type Speaker} from '../src/player';
import {readPack} from '../src/audio';
globalThis.DOMParser=new JSDOM('').window.DOMParser;
const sample:Dataset={version:1,title:'Test',guidance:[],sections:[{id:'s1',title:'One',scenes:[{id:'r1',number:1,line:'First sentence. Second sentence.',scenario:'A situation.',reaction:'A response.',pivot:'A feeling.'},{id:'r2',number:2,line:'Another belief.',scenario:'Another situation.',reaction:'Another response.',pivot:'Another feeling.'}]},{id:'s2',title:'Two',scenes:[{id:'r3',number:3,line:'Third belief.',scenario:'Third situation.',reaction:'Third response.',pivot:'Third feeling.'}]}]};
const options={...defaults,section:'s1',scene:'r1'};
function harness(mode:'manual'|'timed'='manual'){
  let now=0,fn:(()=>void)|undefined;let done=()=>{},fail=(_:string)=>{};let calls=0;
  const clock:Clock={now:()=>now,every:f=>{fn=f;return 1;},clear:()=>{fn=undefined;}};
  const speaker:Speaker={speak:(_s,_settings,d,e)=>{done=d;fail=e;calls++;},cancel:()=>{}};
  const p=new Player(makeUnits(sample,options),{...options,mode},speaker,()=>{},clock);
  return {p,finish:()=>done(),fail:(s:string)=>fail(s),tick:(ms:number)=>{now+=ms;fn?.();},callback:()=>done,calls:()=>calls};
}
test('granularity, scope, and affirmation filtering are independent',()=>{
  assert.equal(makeUnits(sample,options).length,8);
  assert.equal(makeUnits(sample,{...options,size:'sentence'}).length,9);
  assert.equal(makeUnits(sample,{...options,size:'scene'}).length,2);
  assert.equal(makeUnits(sample,{...options,size:'section',range:'all'}).length,2);
  assert.equal(makeUnits(sample,{...options,range:'scene'}).length,4);
  assert.equal(makeUnits(sample,{...options,range:'all',affirmations:true}).length,3);
  assert.equal(makeUnits(sample,{...options,range:'all',affirmations:true,size:'sentence'}).length,4);
});
test('manual waits after the full cell and Next reads the following cell',()=>{
  const h=harness();h.p.play();h.finish();assert.equal(h.p.part,1);h.finish();assert.equal(h.p.phase,'waiting');h.tick(100000);assert.equal(h.p.index,0);h.p.navigate(1);assert.equal(h.p.phase,'speaking');assert.equal(h.calls(),3);
});
test('timer pause freezes remaining time; resume does not catch up in background',()=>{
  const h=harness('timed');h.p.play();h.finish();h.finish();h.tick(12000);h.p.pause();assert.equal(h.p.remaining,18);h.tick(600000);assert.equal(h.p.index,0);h.p.play();h.tick(17900);assert.equal(h.p.phase,'visualizing');h.tick(100);assert.equal(h.p.index,1);assert.equal(h.p.phase,'speaking');
});
test('stale speech callback cannot advance after navigation or pause',()=>{
  const h=harness();h.p.play();const old=h.callback();h.p.navigate(1);old();assert.equal(h.p.index,1);assert.equal(h.p.part,0);const current=h.callback();h.p.pause();current();assert.equal(h.p.phase,'paused');h.p.play();assert.equal(h.p.part,0);
});
test('manual repetitions include a gap but still wait before moving to another unit',()=>{
  const h=harness();h.p.settings.repeats=2;h.p.play();h.finish();h.finish();assert.equal(h.p.phase,'visualizing');h.tick(30000);assert.equal(h.p.repeat,1);h.finish();h.finish();assert.equal(h.p.phase,'waiting');assert.equal(h.p.index,0);
});
test('timed repetition counts and final gap end in completed, with optional loop',()=>{
  const h=harness('timed');h.p.setUnits([makeUnits(sample,options)[1]]);h.p.settings.repeats=2;h.p.play();h.finish();h.tick(30000);assert.equal(h.p.repeat,1);h.finish();h.tick(30000);assert.equal(h.p.phase,'completed');h.p.settings.loop=true;h.p.play();h.finish();h.tick(30000);h.finish();h.tick(30000);assert.equal(h.p.phase,'speaking');
});
test('speech errors retain the sentence and never advance',()=>{const h=harness('timed');h.p.play();h.fail('unavailable');assert.equal(h.p.phase,'error');h.tick(60000);assert.equal(h.p.index,0);h.p.play();assert.equal(h.p.phase,'speaking');});
test('manual final unit completes instead of asking for a disabled Next',()=>{const h=harness();h.p.setUnits([makeUnits(sample,options)[1]]);h.p.play();h.finish();assert.equal(h.p.phase,'completed');h.p.settings.repeats=2;h.p.play();h.finish();h.tick(30000);h.finish();assert.equal(h.p.phase,'completed');});
test('changing selection cancels countdown and invalidates callbacks',()=>{const h=harness('timed');h.p.play();h.finish();h.finish();h.p.setUnits(makeUnits(sample,{...options,range:'scene',scene:'r2'}));h.tick(60000);assert.equal(h.p.phase,'ready');assert.equal(h.p.unit.segments[0].sceneId,'r2');});
function docx(rows:string[][]){const escape=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;');const xml=`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Title</w:t></w:r></w:p><w:p><w:r><w:t>I. Section</w:t></w:r></w:p><w:tbl>${rows.map(r=>`<w:tr>${r.map(c=>`<w:tc><w:p><w:r><w:t>${escape(c)}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`).join('')}</w:tbl></w:body></w:document>`;return zipSync({'word/document.xml':strToU8(xml)});}
const headers=['The Line','The Scenario','The Reaction','The Pivot'];
test('DOCX preserves Unicode and ignores blank rows',()=>{const d=parseDocx(docx([headers,['I’m here — now.','A & B','Observe.','Feel.'],['','','','']]));assert.equal(d.sections.length,1);assert.equal(d.sections[0].scenes.length,1);assert.equal(d.sections[0].scenes[0].line,'I’m here — now.');assert.equal(d.sections[0].scenes[0].scenario,'A & B');});
test('malformed layouts and incomplete rows fail rather than silently dropping content',()=>{assert.throws(()=>parseDocx(docx([['Wrong'],['text']])));assert.throws(()=>parseDocx(docx([headers,['line','scenario','','pivot']])));assert.throws(()=>validateDataset({...sample,version:2}));});
test('fingerprints are stable across JSON export and reject changed content',async()=>{assert.equal(await fingerprint(sample),await fingerprint(JSON.parse(JSON.stringify(sample))));const changed=structuredClone(sample);changed.sections[0].scenes[0].line+=' Changed.';assert.notEqual(await fingerprint(sample),await fingerprint(changed));});
test('audio pack validates fingerprint, missing clips, and timing order',async()=>{
  const m={version:1,kind:'voice',fingerprint:await fingerprint(sample),voice:'af_heart',rate:1,clips:{'r1.line.0':'clips/a.wav'}};
  const pack=(manifest:unknown,extra:Record<string,Uint8Array>={})=>zipSync({'dataset.json':strToU8(JSON.stringify(sample)),'manifest.json':strToU8(JSON.stringify(manifest)),...extra});
  await assert.rejects(()=>readPack(pack(m)),/missing/);await assert.rejects(()=>readPack(pack({...m,fingerprint:'wrong'})),/match/);
  assert.equal((await readPack(pack(m,{'clips/a.wav':new Uint8Array([1,2])}))).manifest.kind,'voice');
  await assert.rejects(()=>readPack(pack({...m,kind:'session',duration:10,timings:[{start:3,end:2,segmentId:'r1.line.0',unitId:'r1.line',repeat:0}]},{'session.m4a':new Uint8Array([1])})),/timing/);
});
test('actual source document has 41 complete scenes across nine sections',{skip:!process.env.THEATRE_DOCX},async()=>{const d=parseDocx(new Uint8Array(await readFile(process.env.THEATRE_DOCX!)));assert.equal(d.sections.length,9);assert.deepEqual(d.sections.map(s=>s.scenes.length),[6,3,7,6,4,4,3,4,4]);assert.equal(d.sections.flatMap(s=>s.scenes).length,41);});
