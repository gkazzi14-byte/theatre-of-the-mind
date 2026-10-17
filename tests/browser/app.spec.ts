import {test,expect} from '@playwright/test';
import {zipSync,strToU8} from 'fflate';
import {fingerprint,segmentsFor,type Dataset} from '../../src/model';
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
  await page.locator('#session-tab').click();await expect(page.locator('#session-play')).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/mobile-session.png',fullPage:true});
  await page.locator('#interactive-tab').click();await page.screenshot({path:'test-results/mobile-practice.png',fullPage:true});
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
  const manifest={version:1,kind:'session',fingerprint:await fingerprint(audioData),voice:'Test session',rate:1,duration:5,timings:[{start:0,end:2,segmentId:'r1.line.0',unitId:'r1.line',repeat:0}]};
  const bytes=zipSync({'dataset.json':strToU8(JSON.stringify(audioData)),'manifest.json':strToU8(JSON.stringify(manifest)),'session.m4a':new Uint8Array(readFileSync(file))});
  await page.goto('/');await page.locator('#import-file').setInputFiles({name:'session.theatre.zip',mimeType:'application/zip',buffer:Buffer.from(bytes)});await page.locator('#confirm-import').click();await expect(page.locator('#session-view')).toBeVisible();await page.locator('#session-play').click();await expect(page.locator('#session-play')).toContainText('Pause');await expect(page.locator('#session-caption')).toContainText('One quiet breath');
  await page.locator('audio').evaluate((a:HTMLAudioElement)=>{a.currentTime=3});await expect(page.locator('#session-caption')).toContainText('visualize');await page.locator('#session-play').click();await expect(page.locator('#session-play')).toContainText('Play');
  const dl=page.waitForEvent('download');await page.locator('#export-audio').click();expect((await dl).suggestedFilename()).toBe('theatre-session.m4a');
});
test('generated personal packs import and play without publishing their content',async({page})=>{
  test.skip(!process.env.THEATRE_AUDIO_DIR,'Optional local artifact check; personal files are never fixtures.');
  await page.goto('/');await page.locator('#import-file').setInputFiles(`${process.env.THEATRE_AUDIO_DIR}/voice.theatre.zip`);await page.locator('#confirm-import').click();await expect(page.locator('#dialog')).not.toBeVisible();await page.reload();await expect(page.locator('#document-count')).toContainText('41 scenes');await expect(page.locator('#engine-label')).toContainText('af_heart');await page.locator('#play').click();await expect(page.locator('#player-status')).toContainText('Listening');await page.locator('#play').click();await expect(page.locator('#player-status')).toContainText('Paused');
  await page.locator('#import-file').setInputFiles(`${process.env.THEATRE_AUDIO_DIR}/session.theatre.zip`);await page.locator('#confirm-import').click();await expect(page.locator('#session-details')).toContainText('16 minutes');await page.locator('#session-play').click();await expect(page.locator('#session-play')).toContainText('Pause');await page.locator('#session-play').click();
});
