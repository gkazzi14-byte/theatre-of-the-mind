import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {readPack} from '../src/audio';
import {segmentsFor,makeUnits} from '../src/model';
import assert from 'node:assert/strict';
const dir=process.argv[2]||'private/audio';
const voice=await readPack(new Uint8Array(await readFile(`${dir}/voice.theatre.zip`)));
const session=await readPack(new Uint8Array(await readFile(`${dir}/session.theatre.zip`)));
assert.equal(voice.manifest.fingerprint,session.manifest.fingerprint);
assert.equal(Object.keys(voice.manifest.clips!).length,segmentsFor(voice.data).length);
for(const [name,file]of Object.entries(voice.files)){assert.ok(file.size>44);const header=Buffer.from(await file.slice(0,12).arrayBuffer());if(name.endsWith('.wav')){assert.equal(header.toString('ascii',0,4),'RIFF');assert.equal(header.toString('ascii',8,12),'WAVE');}else assert.equal(header.toString('ascii',4,8),'ftyp');}
const units=makeUnits(session.data,session.manifest.settings!);
const timeline=session.manifest.timings!;
assert.equal(timeline.length,units.reduce((n,u)=>n+u.segments.length,0)*session.manifest.settings!.repeats);
assert.equal(timeline[0].start,3,'The music fade-in must finish before the first words.');
for(let i=1;i<timeline.length;i++)if(timeline[i].unitId!==timeline[i-1].unitId||timeline[i].repeat!==timeline[i-1].repeat)assert.ok(Math.abs(timeline[i].start-timeline[i-1].end-session.manifest.settings!.gap)<.01);
const info=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_name,sample_rate,channels','-of','json',`${dir}/session.m4a`],{encoding:'utf8'}));
assert.equal(info.streams[0].codec_name,'aac');assert.equal(info.streams[0].channels,2);
assert.ok(Math.abs(Number(info.format.duration)-session.manifest.duration!)<.01);
assert.ok(Math.abs(session.manifest.duration!-timeline.at(-1)!.end-session.manifest.settings!.gap)<.1);
// Verify real speech survived the mix, not just that the container is valid.
// This catches mismatched PCM codecs when concatenating neural speech/silence.
const first=timeline[0],clip=voice.files[voice.manifest.clips![first.segmentId]];
const raw=execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-i','pipe:0','-ar','24000','-ac','1','-f','f32le','pipe:1'],{input:Buffer.from(await clip.arrayBuffer()),maxBuffer:20_000_000});
const mixed=execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-ss',String(first.start),'-i',`${dir}/session.m4a`,'-t',String(first.end-first.start),'-ar','24000','-ac','1','-f','f32le','pipe:1'],{maxBuffer:20_000_000});
const ref=new Float32Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));const actual=new Float32Array(mixed.buffer.slice(mixed.byteOffset,mixed.byteOffset+mixed.byteLength));
let best=0,bestOffset=0;const correlation=(offset:number,stride:number)=>{let xy=0,xx=0,yy=0;for(let i=2400;i<Math.min(ref.length,actual.length)-2400;i+=stride){const a=ref[i],b=actual[i+offset];xy+=a*b;xx+=a*a;yy+=b*b;}return xy/Math.sqrt(xx*yy);};for(let offset=-2048;offset<=2048;offset+=8){const c=correlation(offset,4);if(c>best){best=c;bestOffset=offset;}}const coarse=bestOffset;for(let offset=coarse-8;offset<=coarse+8;offset++){const c=correlation(offset,1);if(c>best){best=c;bestOffset=offset;}}console.log('Alignment offset:',bestOffset);
assert.ok(best>.95,`Mixed narration must match its source clip; correlation ${best}`);
console.log('Source-to-session speech correlation:',best.toFixed(4));
console.log(JSON.stringify({sections:voice.data.sections.length,scenes:voice.data.sections.flatMap(s=>s.scenes).length,clips:Object.keys(voice.manifest.clips!).length,sessionUnits:units.length,voice:voice.manifest.voice,rate:voice.manifest.rate,sessionSeconds:Number(info.format.duration),background:session.manifest.settings!.background,leadInSeconds:timeline[0].start,voicePackBytes:(await readFile(`${dir}/voice.theatre.zip`)).byteLength,sessionPackBytes:(await readFile(`${dir}/session.theatre.zip`)).byteLength},null,2));
