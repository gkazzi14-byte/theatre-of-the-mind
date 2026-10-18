#!/usr/bin/env node
/** Local-only audio preparation. Run with: node --import tsx audio-tool/prepare.mjs */
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {zipSync,strToU8} from 'fflate';
import {makeUnits,segmentsFor,validateDataset,fingerprint,defaults,SOUNDS} from '../src/model.ts';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const arg=(name,fallback)=>{const i=args.indexOf(name);return i>=0?args[i+1]:fallback;};
const has=name=>args.includes(name);
const output=path.resolve(arg('--out',path.join(ROOT,'private','audio')));
const cache=path.join(ROOT,'audio-tool','.cache');
const model='onnx-community/Kokoro-82M-v1.0-ONNX';
function command(name,argv){const r=spawnSync(name,argv,{encoding:'utf8',maxBuffer:20_000_000});if(r.error)throw Error(`${name} is unavailable. ${r.error.message}`);if(r.status!==0)throw Error(`${name} failed: ${r.stderr.slice(-2000)}`);return r.stdout;}
function ffmpeg(argv){return command('ffmpeg',['-hide_banner','-loglevel','error','-y',...argv]);}
async function exists(p){try{await access(p);return true}catch{return false}}
function wav(seconds,frequency=0){const samples=Math.round(seconds*24000),buf=Buffer.alloc(44+samples*2);buf.write('RIFF');buf.writeUInt32LE(buf.length-8,4);buf.write('WAVEfmt ',8);buf.writeUInt32LE(16,16);buf.writeUInt16LE(1,20);buf.writeUInt16LE(1,22);buf.writeUInt32LE(24000,24);buf.writeUInt32LE(48000,28);buf.writeUInt16LE(2,32);buf.writeUInt16LE(16,34);buf.write('data',36);buf.writeUInt32LE(samples*2,40);for(let i=0;i<samples;i++)buf.writeInt16LE(Math.round(Math.sin(2*Math.PI*frequency*i/24000)*1800*Math.min(1,i/400,(samples-i)/400)),44+i*2);return buf;}
function duration(p){return Number(command('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',p]).trim());}
function quoteConcat(p){return "file '"+p.replace(/'/g,"'\\''")+"'";}
async function main(){
  if(has('--help')||!args.length){console.log(`Theatre local audio preparation\n\nInstall: npm install --prefix audio-tool\nRun: npm run prepare:audio -- --recipe /path/practice.recipe.json\nOptions:\n  --out DIR         Private output folder (default: ./private/audio)\n  --music FILE      Local music file when recipe background is custom\n  --voice ID        Override neural voice (default af_heart)\n  --audition        Create short English voice samples\n  --voices          List all English voices\n  --offline         Require cached model and voice assets\n  --smoke           Synthetic tone test; never presented as narration\n  --voice-only      Generate a voice pack without mixing a session\n\nPersonal content stays local. First neural run downloads model/voice assets.\nPrepared sessions use timed advancement regardless of interactive settings.`);return;}
  await mkdir(output,{recursive:true});await mkdir(cache,{recursive:true});
  command('ffmpeg',['-version']);
  let tts;
  if(!has('--smoke')){
    const {env,StyleTextToSpeech2Model,AutoTokenizer}=await import('@huggingface/transformers');
    env.cacheDir=path.join(cache,'models');
    env.allowRemoteModels=!has('--offline');
    const {KokoroTTS}=await import('kokoro-js');
    console.log(has('--offline')?'Loading cached local neural model…':'Loading neural model (first run downloads public model assets; text stays local)…');
    const [neural,tokenizer]=await Promise.all([
      StyleTextToSpeech2Model.from_pretrained(model,{dtype:'q8',device:'cpu',session_options:{intraOpNumThreads:4,interOpNumThreads:1}}),
      AutoTokenizer.from_pretrained(model)
    ]);
    tts=new KokoroTTS(neural,tokenizer);
  }
  if(has('--voices')){const voices=Object.entries(tts.voices).filter(([id])=>/^[ab][fm]_/.test(id));for(const [id,v]of voices)console.log(id,JSON.stringify(v));return;}
  const voice=arg('--voice','af_heart');
  async function speech(text,selectedVoice,rate){
    const hash=createHash('sha256').update(JSON.stringify({model,engine:'kokoro-js-1.2-q8',text,voice:selectedVoice,rate,smoke:has('--smoke')})).digest('hex');
    const p=path.join(cache,hash+'.wav');
    if(!await exists(p)){
      if(has('--smoke'))await writeFile(p,wav(.3,220));
      else {
        if(!/^[ab][fm]_/.test(selectedVoice)||!tts.voices[selectedVoice])throw Error('Unknown English voice. Use --voices to list voices.');
        // Kokoro truncates very long token sequences. Split unusually long
        // sentences internally while retaining one navigation clip per sentence.
        const chunks=[];let chunk='';
        for(const word of text.split(/\s+/)){if(word.length>260)throw Error('A word exceeds the speech engine limit. Edit the document to add spacing.');if(chunk.length+word.length>260){chunks.push(chunk);chunk='';}chunk+=(chunk?' ':'')+word;}if(chunk)chunks.push(chunk);
        if(chunks.length===1){const audio=await tts.generate(text,{voice:selectedVoice,speed:rate});await audio.save(p);}
        else {const parts=[];for(let j=0;j<chunks.length;j++){const part=p+`.part-${j}.wav`;const audio=await tts.generate(chunks[j],{voice:selectedVoice,speed:rate});await audio.save(part);parts.push(quoteConcat(part));}const list=p+'.txt';await writeFile(list,parts.join('\n'));ffmpeg(['-f','concat','-safe','0','-i',list,'-ar','24000','-ac','1',p]);}
      }
    }
    return p;
  }
  if(has('--audition')){
    for(const v of ['af_heart','af_nicole','af_bella','am_michael','am_puck','bf_emma','bf_isabella','bm_george']){
      const p=await speech('Take one unhurried breath. Picture the scene clearly. Let the feeling follow, in its own time.',v,.9);
      await writeFile(path.join(output,`audition-${v}.wav`),await readFile(p));console.log(`Audition ready: ${v}`);
    }return;
  }
  const recipePath=arg('--recipe');if(!recipePath)throw Error('Pass --recipe /path/practice.recipe.json or --audition.');
  const recipe=JSON.parse(await readFile(recipePath,'utf8'));if(recipe.version!==1||recipe.kind!=='recipe')throw Error('Unsupported recipe. Export a fresh recipe from the app.');
  const data=validateDataset(recipe.data);const fp=await fingerprint(data);if(fp!==recipe.fingerprint)throw Error('Recipe fingerprint mismatch. Export a fresh recipe.');
  const settings={...defaults,...recipe.settings};
  if(!['sentence','cell','scene','section'].includes(settings.size)||!['scene','section','all'].includes(settings.range)||!Number.isFinite(settings.gap)||settings.gap<10||settings.gap>60||!Number.isInteger(settings.repeats)||settings.repeats<1||settings.repeats>20||!Number.isFinite(settings.rate)||settings.rate<.8||settings.rate>1.5||![settings.voiceVolume,settings.musicVolume].every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw Error('Invalid session settings. Export a fresh recipe.');
  const selectedVoice=arg('--voice',settings.neuralVoice||voice);
  const units=makeUnits(data,settings);if(!units.length)throw Error('The selected practice is empty.');
  // All document sentences support changing scope after import, without regeneration.
  const segments=segmentsFor(data);const clipPaths={},files={},clips={};
  for(let i=0;i<segments.length;i++){
    const seg=segments[i];const p=await speech(seg.text,selectedVoice,settings.rate);
    // Kokoro emits float32 WAV; silence is int16 WAV. The concat demuxer must
    // receive identical codecs, otherwise it interprets float bytes as PCM16.
    const mixPath=p+'.pcm.wav';if(!await exists(mixPath))ffmpeg(['-i',p,'-ar','24000','-ac','1','-c:a','pcm_s16le',mixPath]);clipPaths[seg.id]=mixPath;
    const portable=p+'.m4a';
    if(!await exists(portable))ffmpeg(['-i',p,'-c:a','aac','-b:a','64k','-movflags','+faststart',portable]);
    const file=`clips/${createHash('sha256').update(seg.id).digest('hex').slice(0,20)}.m4a`;clips[seg.id]=file;files[file]=new Uint8Array(await readFile(portable));
    if(i%10===0||i===segments.length-1)console.log(`Narration ${i+1}/${segments.length}`);
  }
  const common={version:1,fingerprint:fp,voice:has('--smoke')?'TEST TONES — NOT NARRATION':selectedVoice,rate:settings.rate};
  const dataset=strToU8(JSON.stringify(data));
  await writeFile(path.join(output,'voice.theatre.zip'),zipSync({...files,'dataset.json':dataset,'manifest.json':strToU8(JSON.stringify({...common,kind:'voice',clips}))},{level:0}));
  if(has('--voice-only')){console.log('Voice pack ready.');return;}
  const gapFile=path.join(cache,`silence-${settings.gap}.wav`);if(!await exists(gapFile))await writeFile(gapFile,wav(settings.gap));
  const pauseFile=path.join(cache,'sentence-pause.wav');if(!await exists(pauseFile))await writeFile(pauseFile,wav(.2));
  // Fade in the background before speech begins, preserving the first words.
  const leadFile=path.join(cache,'lead-in-3s.wav');if(!await exists(leadFile))await writeFile(leadFile,wav(3));
  const concat=[quoteConcat(leadFile)],timings=[];let time=3;
  const lengths={};for(const [id,p]of Object.entries(clipPaths))lengths[id]=duration(p);
  for(const unit of units)for(let repeat=0;repeat<settings.repeats;repeat++){
    for(let i=0;i<unit.segments.length;i++){
      const s=unit.segments[i];const end=time+lengths[s.id];timings.push({start:time,end,segmentId:s.id,unitId:unit.id,repeat});concat.push(quoteConcat(clipPaths[s.id]));time=end;
      if(i<unit.segments.length-1){concat.push(quoteConcat(pauseFile));time+=.2;}
    }
    concat.push(quoteConcat(gapFile));time+=settings.gap;
  }
  if(time>4*3600)throw Error('Session exceeds four hours. Reduce the scope or repetitions.');
  const listFile=path.join(output,'session-inputs.txt');await writeFile(listFile,concat.join('\n'));
  const narration=path.join(output,'narration.wav');ffmpeg(['-f','concat','-safe','0','-i',listFile,'-ar','24000','-ac','1','-c:a','pcm_s16le',narration]);
  let background;
  if(settings.background==='custom'){background=arg('--music');if(!background)throw Error('This recipe uses your music. Pass --music /path/to/music.mp3.');}
  else if(settings.background!=='off'){if(!SOUNDS.some(s=>s[0]===settings.background))throw Error('Unknown background.');background=path.join(ROOT,'public','audio',settings.background+'.wav');}
  const sessionFile=path.join(output,'session.m4a');const fade=`afade=t=in:d=1.5,afade=t=out:st=${Math.max(0,time-3)}:d=3,alimiter=limit=0.85:level=false`;
  if(background){
    // Keep the music bed steady across speech and visualization gaps.
    const mix=`[0:a]volume=${settings.voiceVolume}[v];[1:a]volume=${settings.musicVolume}[bg];[v][bg]amix=inputs=2:duration=first:normalize=0,${fade}[out]`;
    ffmpeg(['-i',narration,'-stream_loop','-1','-i',path.resolve(background),'-filter_complex',mix,'-map','[out]','-t',String(time),'-ac','2','-ar','44100','-c:a','aac','-b:a','128k','-movflags','+faststart',sessionFile]);
  }else ffmpeg(['-i',narration,'-af',`volume=${settings.voiceVolume},${fade}`,'-ac','2','-ar','44100','-c:a','aac','-b:a','128k','-movflags','+faststart',sessionFile]);
  const manifest={...common,kind:'session',duration:duration(sessionFile),timings,settings:{...settings,duck:false}};
  await writeFile(path.join(output,'session.theatre.zip'),zipSync({'dataset.json':dataset,'manifest.json':strToU8(JSON.stringify(manifest)),'session.m4a':new Uint8Array(await readFile(sessionFile))},{level:0}));
  await writeFile(path.join(output,'session-manifest.json'),JSON.stringify(manifest,null,2));
  console.log(`Done: ${units.length} units, ${settings.repeats} reading(s), ${Math.round(time/60)} minutes.\nImport voice.theatre.zip for interactive practice.\nImport session.theatre.zip for locked-screen listening.\nPrivate output: ${output}`);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
