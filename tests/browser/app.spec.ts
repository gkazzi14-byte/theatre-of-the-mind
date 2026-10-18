import {test,expect} from '@playwright/test';
import {zipSync,strToU8} from 'fflate';
import {fingerprint,segmentsFor,defaults,type Dataset} from '../../src/model';
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdirSync} from 'node:fs';
test('private sample, controls, persistence, sounds, exports and offline shell',async({page,context})=>{
  const errors:string[]=[];const external:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith('http://127.0.0.1:4173'))external.push(r.url())});
  await page.goto('/');await page.getByRole('button',{name:'Explore with a short sample'}).click();
  await expect(page.locator('#document-count')).toContainText('2 scenes');
  await expect(page.locator('#scene-content')).toContainText('I give this moment my full attention.');
  await page.locator('#next').click();await expect(page.locator('#scene-content')).toContainText('A quiet morning.');
  await page.locator('#size').selectOption('sentence');await expect(page.locator('#position')).toContainText('/ 11');
  await page.locator('#size').selectOption('scene');await expect(page.locator('#position')).toContainText('/ 2');
  await page.locator('#affirmations').check();await expect(page.locator('#scene-content')).not.toContainText('quiet morning');
  await page.locator('[data-sound="rain"]').click();await page.locator('[data-favorite="rain"]').click();await page.locator('#favorites').click();await expect(page.locator('.sound-card')).toHaveCount(1);
  await page.locator('#timed-mode').click();await page.locator('#repeats').selectOption('custom');await page.locator('#custom-repeats').fill('5');await page.locator('#custom-repeats').dispatchEvent('change');
  const file=page.waitForEvent('download');await page.locator('#export-data').click();expect((await file).suggestedFilename()).toBe('practice.dataset.json');
  await page.waitForTimeout(400);await page.reload();await expect(page.locator('#size')).toHaveValue('scene');await expect(page.locator('#custom-repeats')).toHaveValue('5');
  await expect(page.locator('#session-view')).toBeHidden();await expect(page.locator('.mode-tabs')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/mobile-session.png',fullPage:true});
  await page.screenshot({path:'test-results/mobile-practice.png',fullPage:true});
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);await context.setOffline(true);await page.reload();
  await expect(page.locator('#document-count'),JSON.stringify({errors,html:await page.content()})).toContainText('2 scenes');
  expect(external).toEqual([]);expect(errors).toEqual([]);
});
test('invalid import cannot replace the current practice',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Explore with a short sample'}).click();
  await page.locator('#import-file').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"version":99}')});
  await expect(page.locator('#notice')).toContainText('Import failed');await expect(page.locator('#document-count')).toContainText('2 scenes');
});
test('repository subpath installs offline and Focus hides secondary controls',async({page,context})=>{
  await page.goto('/theatre-test/');await page.getByRole('button',{name:'Explore with a short sample'}).click();await page.locator('#focus').click();await expect(page.locator('.settings-panel')).toBeHidden();await expect(page.locator('#play')).toBeVisible();await page.locator('#focus').click();await expect(page.locator('.settings-panel')).toBeVisible();
  await page.evaluate(async()=>{await navigator.serviceWorker.ready});await page.waitForFunction(()=>!!navigator.serviceWorker.controller);await context.setOffline(true);await page.reload();await expect(page.locator('#document-count')).toContainText('2 scenes');expect(await page.evaluate(()=>navigator.serviceWorker.controller!.scriptURL)).toContain('/theatre-test/sw.js');
});

const audioData:Dataset={version:1,title:'Audio test',guidance:[],sections:[{id:'s1',title:'Quiet practice',scenes:[{id:'r1',number:1,line:'One quiet breath.',scenario:'A calm room.',reaction:'Let your shoulders soften.',pivot:'Notice the stillness.'}]}]};
function wav(){const count=12000,b=Buffer.alloc(44+count*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(24000,24);b.writeUInt32LE(48000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(count*2,40);for(let i=0;i<count;i++)b.writeInt16LE(Math.round(Math.sin(i*.05)*500),44+i*2);return b;}
test('imported clips play privately and manual Next starts the next cell',async({page})=>{
  await page.goto('/');const clips:Record<string,string>={},files:Record<string,Uint8Array>={};for(const [i,s]of segmentsFor(audioData).entries()){clips[s.id]=`clips/${i}.wav`;files[clips[s.id]]=wav();}
  const bytes=zipSync({...files,'dataset.json':strToU8(JSON.stringify(audioData)),'manifest.json':strToU8(JSON.stringify({version:1,kind:'voice',fingerprint:await fingerprint(audioData),voice:'Test local clips',rate:1,clips}))});
  await page.locator('#import-file').setInputFiles({name:'voice.theatre.zip',mimeType:'application/zip',buffer:Buffer.from(bytes)});await page.locator('#confirm-import').click();
  await expect(page.locator('#engine-label')).toContainText('Local neural audio');await page.locator('#play').click();await expect(page.locator('#player-status')).toContainText('Tap Next');await page.locator('#next').click();await expect(page.locator('#scene-content')).toContainText('A calm room.');await expect(page.locator('#player-status')).toContainText('Tap Next');
  await page.locator('#repeat').click();await expect(page.locator('#player-status')).toContainText('Listening');await page.locator('#play').click();await expect(page.locator('#player-status')).toContainText('Paused');
});
test('prepared session imports, plays, seeks and exports',async({page})=>{
  mkdirSync('test-results',{recursive:true});const file='test-results/session-fixture.m4a';execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','sine=frequency=110:duration=5','-c:a','aac',file]);
  const manifest={version:1,kind:'session',fingerprint:await fingerprint(audioData),voice:'Test session',rate:1,duration:5,timings:[{start:0,end:2,segmentId:'r1.line.0',unitId:'r1.line',repeat:0},{start:4,end:4.5,segmentId:'r1.scenario.0',unitId:'r1.scenario',repeat:0}]};
  const bytes=zipSync({'dataset.json':strToU8(JSON.stringify(audioData)),'manifest.json':strToU8(JSON.stringify(manifest)),'session.m4a':new Uint8Array(readFileSync(file))});
  await page.goto('/');await page.locator('#import-file').setInputFiles({name:'session.theatre.zip',mimeType:'application/zip',buffer:Buffer.from(bytes)});await page.locator('#confirm-import').click();await expect(page.locator('#session-view')).toBeVisible();await page.locator('#play').click();await expect(page.locator('#play')).toContainText('Pause');await expect(page.locator('#session-caption')).toContainText('One quiet breath');
  await page.locator('audio').evaluate((a:HTMLAudioElement)=>{a.currentTime=3});await expect(page.locator('#session-caption')).toContainText('visualize');await page.locator('#play').click();await expect(page.locator('#play')).toContainText('Play');
  await page.locator('#next').click();expect(await page.locator('audio').evaluate((a:HTMLAudioElement)=>a.currentTime)).toBeCloseTo(4,1);
  await page.locator('#previous').click();expect(await page.locator('audio').evaluate((a:HTMLAudioElement)=>a.currentTime)).toBeCloseTo(0,1);
  await expect(page.locator('#interactive-tab')).toHaveCount(0);
  await page.locator('#play').click();await expect(page.locator('#session-view')).toBeVisible();
  await expect(page.locator('#play')).toContainText('Pause');await page.locator('#play').click();
  // The ordinary player remains the native continuous player after reopening.
  await expect(page.locator('#session-tab')).toHaveCount(0);
  await page.reload();await expect(page.locator('#session-view')).toBeVisible();
  await page.locator('#play').click();await expect(page.locator('#play')).toContainText('Pause');
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('pagehide'));});
  expect(await page.locator('audio').evaluate((a:HTMLAudioElement)=>a.paused)).toBe(false);
  const hiddenTime=await page.locator('audio').evaluate((a:HTMLAudioElement)=>a.currentTime);
  await expect.poll(()=>page.locator('audio').evaluate((a:HTMLAudioElement)=>a.currentTime)).toBeGreaterThan(hiddenTime+.2);
  await page.locator('#play').click();
  await page.getByText('Audio details',{exact:true}).click();
  const dl=page.waitForEvent('download');await page.locator('#export-audio').click();expect((await dl).suggestedFilename()).toBe('theatre-session.m4a');
});
test('generated personal packs import and play without publishing their content',async({page})=>{
  test.setTimeout(120_000);
  test.skip(!process.env.THEATRE_AUDIO_DIR,'Optional local artifact check; personal files are never fixtures.');
  await page.goto('/');await page.locator('#import-file').setInputFiles(`${process.env.THEATRE_AUDIO_DIR}/voice.theatre.zip`);await page.locator('#confirm-import').click();await expect(page.locator('#dialog')).not.toBeVisible();await page.reload();await expect(page.locator('#document-count')).toContainText('41 scenes');await expect(page.locator('#engine-label')).toContainText('af_heart');await page.locator('#play').click();await expect(page.locator('#player-status')).toContainText('Listening');await page.locator('#play').click();await expect(page.locator('#player-status')).toContainText('Paused');
  await page.locator('#import-file').setInputFiles(`${process.env.THEATRE_AUDIO_DIR}/session.theatre.zip`);await page.locator('#confirm-import').click();await expect(page.locator('#session-details')).toContainText('16 minutes');expect(await page.locator('audio').evaluate(async(a:HTMLAudioElement)=>(await fetch(a.src)).headers.get('Content-Type'))).toBe('audio/wav');await page.locator('#play').click();await expect(page.locator('#play')).toContainText('Pause');await page.locator('#play').click();
});

test('cached background sounds support Safari byte ranges and play offline',async({page,context})=>{
  await page.addInitScript(()=>{
    const create=AudioContext.prototype.createBufferSource;
    const sources:AudioBufferSourceNode[]=[];
    (window as unknown as {musicSources:AudioBufferSourceNode[]}).musicSources=sources;
    AudioContext.prototype.createBufferSource=function(){const source=create.call(this);sources.push(source);return source;};
  });
  await page.goto('/');await page.getByRole('button',{name:'Explore with a short sample'}).click();
  await page.evaluate(async()=>{await navigator.serviceWorker.ready});await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await context.setOffline(true);
  const ranges=await page.evaluate(async()=>{
    const results=[];
    for(const range of ['bytes=0-1','bytes=-4','bytes=99999999-']){
      const r=await fetch('audio/rain.wav',{headers:{Range:range}});
      results.push({status:r.status,length:(await r.arrayBuffer()).byteLength,range:r.headers.get('Content-Range')});
    }
    return results;
  });
  expect(ranges[0]).toMatchObject({status:206,length:2});expect(ranges[0].range).toMatch(/^bytes 0-1\//);
  expect(ranges[1]).toMatchObject({status:206,length:4});expect(ranges[2].status).toBe(416);
  await page.locator('[data-sound="rain"]').click();await page.locator('#preview-sound').click();
  await expect(page.locator('#preview-sound')).toHaveText('Stop preview');
  await expect.poll(()=>page.evaluate(()=>{
    const sources=(window as unknown as {musicSources:AudioBufferSourceNode[]}).musicSources;
    return sources.length===1&&sources[0].loop&&sources[0].context.currentTime>0;
  })).toBe(true);
  await expect(page.locator('#notice')).not.toContainText('could not start');
});

test('music stays on one audio source across narration and unit navigation',async({page})=>{
  await page.addInitScript(()=>{
    const create=AudioContext.prototype.createBufferSource;
    const stats={starts:0,stops:0};
    (window as unknown as {loopStats:typeof stats}).loopStats=stats;
    AudioContext.prototype.createBufferSource=function(){
      const source=create.call(this),start=source.start.bind(source),stop=source.stop.bind(source);
      source.start=(...args)=>{stats.starts++;start(...args)};
      source.stop=(...args)=>{stats.stops++;stop(...args)};
      return source;
    };
  });
  await page.goto('/');const clips:Record<string,string>={},files:Record<string,Uint8Array>={};
  for(const [i,s]of segmentsFor(audioData).entries()){clips[s.id]=`clips/${i}.wav`;files[clips[s.id]]=wav();}
  const bytes=zipSync({...files,'dataset.json':strToU8(JSON.stringify(audioData)),'manifest.json':strToU8(JSON.stringify({version:1,kind:'voice',fingerprint:await fingerprint(audioData),voice:'Test clips',rate:1,clips}))});
  await page.locator('#import-file').setInputFiles({name:'voice.theatre.zip',mimeType:'application/zip',buffer:Buffer.from(bytes)});await page.locator('#confirm-import').click();
  await page.locator('[data-sound="warm"]').click();await page.locator('#play').click();await expect(page.locator('#player-status')).toContainText('Tap Next');
  await page.locator('#next').click();await expect(page.locator('#player-status')).toContainText('Tap Next');
  await page.waitForTimeout(17000); // Cross the full bundled sound loop boundary.
  expect(await page.evaluate(()=>(window as unknown as {loopStats:unknown}).loopStats)).toEqual({starts:1,stops:0});
  await page.locator('#repeat').click();await page.locator('#play').click();
  expect(await page.evaluate(()=>(window as unknown as {loopStats:unknown}).loopStats)).toEqual({starts:1,stops:1});
});

test('existing ducked session is automatically remixed with continuous music and saved',async({page})=>{
  const clips:Record<string,string>={},files:Record<string,Uint8Array>={};
  for(const [i,s]of segmentsFor(audioData).entries()){clips[s.id]=`clips/${i}.wav`;files[clips[s.id]]=wav();}
  const common={version:1,fingerprint:await fingerprint(audioData),voice:'Steady test',rate:1};
  const voice=zipSync({...files,'dataset.json':strToU8(JSON.stringify(audioData)),'manifest.json':strToU8(JSON.stringify({...common,kind:'voice',clips}))});
  await page.goto('/');await page.locator('#import-file').setInputFiles({name:'voice.theatre.zip',mimeType:'application/zip',buffer:Buffer.from(voice)});await page.locator('#confirm-import').click();
  const manifest={...common,kind:'session',duration:35,timings:[{start:3,end:3.5,segmentId:'r1.line.0',unitId:'r1.line',repeat:0}],settings:{...defaults,background:'warm',duck:true}};
  const pack=zipSync({'dataset.json':strToU8(JSON.stringify(audioData)),'manifest.json':strToU8(JSON.stringify(manifest)),'session.m4a':new Uint8Array([0])});
  await page.locator('#import-file').setInputFiles({name:'session.theatre.zip',mimeType:'application/zip',buffer:Buffer.from(pack)});await page.locator('#confirm-import').click();
  await expect(page.locator('#session-view')).toBeVisible();
  await page.reload();await expect(page.locator('#session-view')).toBeVisible();await page.locator('#play').click();await expect(page.locator('#play')).toContainText('Pause');
  const music=await page.locator('audio').evaluate(async(a:HTMLAudioElement)=>{
    const context=new OfflineAudioContext(1,1,22050),buffer=await context.decodeAudioData(await (await fetch(a.src)).arrayBuffer());
    const samples=buffer.getChannelData(0),rms=[];
    for(const seconds of [2,8,15.95,16,20,31.95,32]){
      const start=Math.floor(seconds*buffer.sampleRate),end=start+Math.floor(.05*buffer.sampleRate);
      let sum=0;for(let i=start;i<end;i++)sum+=samples[i]*samples[i];rms.push(Math.sqrt(sum/(end-start)));
    }
    return {duration:buffer.duration,rms};
  });
  expect(music.duration).toBeCloseTo(35,1);for(const rms of music.rms)expect(rms).toBeGreaterThan(.005);
  await page.getByText('Audio details',{exact:true}).click();
  const downloaded=page.waitForEvent('download');await page.locator('#export-audio').click();expect((await downloaded).suggestedFilename()).toBe('theatre-session.wav');
});
