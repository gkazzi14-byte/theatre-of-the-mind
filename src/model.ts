import { unzipSync, strFromU8 } from 'fflate';
import {sha256} from '@noble/hashes/sha2.js';

export const FIELDS = ['line', 'scenario', 'reaction', 'pivot'] as const;
export type Field = typeof FIELDS[number];
export const LABELS: Record<Field,string> = {line:'The Line', scenario:'The Scenario',reaction:'The Reaction',pivot:'The Pivot'};
export interface Scene { id: string; number: number; line: string; scenario: string; reaction: string; pivot: string }
export interface Section { id: string; title: string; scenes: Scene[] }
export interface Dataset { version: 1; title: string; guidance: string[]; sections: Section[] }
export interface Settings {
  size: 'sentence'|'cell'|'scene'|'section'; range: 'scene'|'section'|'all'; section: string; scene: string;
  mode: 'manual'|'timed'; affirmations: boolean; gap: number; rate: number; repeats: number;
  background: string; musicVolume: number; voiceVolume: number; duck: boolean; loop: boolean;
  voice: string; neuralVoice: string; favorites: string[];
}
export const defaults: Settings = {size:'cell',range:'section',section:'',scene:'',mode:'manual',affirmations:false,gap:30,rate:1,repeats:1,background:'off',musicVolume:.16,voiceVolume:1,duck:true,loop:false,voice:'',neuralVoice:'af_heart',favorites:[]};
export interface Segment {id:string; text:string; sectionId:string; sceneId:string; field:Field}
export interface Unit {id:string; label:string; segments:Segment[]}
export function sentences(text:string):string[] {
  return Array.from(new Intl.Segmenter('en',{granularity:'sentence'}).segment(text),p=>p.segment.trim()).filter(Boolean);
}
export function segmentsFor(data:Dataset):Segment[] {
  return data.sections.flatMap(s=>s.scenes.flatMap(r=>FIELDS.flatMap(f=>sentences(r[f]).map((text,i)=>({id:`${r.id}.${f}.${i}`,text,sectionId:s.id,sceneId:r.id,field:f})))));
}
export function makeUnits(data:Dataset, settings:Settings):Unit[] {
  const selected=segmentsFor(data).filter(s=>(settings.range==='all'||s.sectionId===settings.section)&&(settings.range!=='scene'||s.sceneId===settings.scene)&&(!settings.affirmations||s.field==='line'));
  const result:Unit[]=[];
  for(const seg of selected){
    const key=settings.size==='sentence'?seg.id:settings.size==='cell'?`${seg.sceneId}.${seg.field}`:settings.size==='scene'?seg.sceneId:seg.sectionId;
    let unit=result.at(-1);
    if(!unit||unit.id!==key){
      const section=data.sections.find(s=>s.id===seg.sectionId)!;
      const scene=section.scenes.find(s=>s.id===seg.sceneId)!;
      unit={id:key,label:settings.size==='section'?section.title:`Scene ${scene.number}${settings.size==='scene'?'':` · ${LABELS[seg.field]}`}`,segments:[]};result.push(unit);
    }
    unit.segments.push(seg);
  }
  return result;
}
export function validateDataset(raw:unknown):Dataset {
  const d=raw as Dataset;
  if(!d||d.version!==1||typeof d.title!=='string'||!Array.isArray(d.guidance)||!d.guidance.every(t=>typeof t==='string')||!Array.isArray(d.sections)||!d.sections.length)throw Error('This is not a supported Theatre dataset (version 1).');
  const ids=new Set<string>();let count=0;
  for(const s of d.sections){
    if(!s||typeof s.id!=='string'||ids.has(s.id)||typeof s.title!=='string'||!Array.isArray(s.scenes)||!s.scenes.length)throw Error('Every section needs a unique ID, title, and scenes.');ids.add(s.id);
    for(const r of s.scenes){if(!r||typeof r.id!=='string'||ids.has(r.id)||!Number.isInteger(r.number)||r.number<1||FIELDS.some(f=>typeof r[f]!=='string'||!r[f].trim()))throw Error('Each scene needs a unique ID, number, and all four text columns.');ids.add(r.id);count++;}
  }
  if(count>2000||JSON.stringify(d).length>4_000_000)throw Error('This document is too large. Import a smaller selection (up to 2,000 scenes).');
  // Canonical shape discards unknown properties and keeps hashes consistent across imports.
  return {version:1,title:d.title,guidance:[...d.guidance],sections:d.sections.map(s=>({id:s.id,title:s.title,scenes:s.scenes.map(r=>({id:r.id,number:r.number,line:r.line,scenario:r.scenario,reaction:r.reaction,pivot:r.pivot}))}))};
}
export function parseDocx(bytes:Uint8Array):Dataset {
  const zip=unzipSync(bytes,{filter:f=>f.name==='word/document.xml'&&f.originalSize<8_000_000});
  if(!zip['word/document.xml'])throw Error('The file is not a supported Word document, or it is too large.');
  const xml=new DOMParser().parseFromString(strFromU8(zip['word/document.xml']),'application/xml');
  if(xml.getElementsByTagName('parsererror').length)throw Error('The Word document contains invalid XML.');
  const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const body=xml.getElementsByTagNameNS(ns,'body')[0];if(!body)throw Error('No document body found.');
  const text=(el:Element)=>Array.from(el.getElementsByTagNameNS(ns,'p')).map(p=>Array.from(p.getElementsByTagNameNS(ns,'t')).map(t=>t.textContent||'').join('')).join('\n').trim();
  const data:Dataset={version:1,title:'Theatre of the Mind',guidance:[],sections:[]};
  let heading='',number=0,first=true;
  for(const el of Array.from(body.children)){
    if(el.localName==='p'){
      const t=Array.from(el.getElementsByTagNameNS(ns,'t')).map(x=>x.textContent||'').join('').trim();
      if(!t)continue;
      if(first){data.title=t;first=false;continue;}
      if(/^(?:[IVXLCDM]+[.)]|\d+[.)])\s+/.test(t)&&!/how to/i.test(t))heading=t;
      if(!data.sections.length)data.guidance.push(t);
      continue;
    }
    if(el.localName!=='tbl')continue;
    const rows=Array.from(el.children).filter(x=>x.localName==='tr').map(r=>Array.from(r.children).filter(x=>x.localName==='tc').map(text));
    if(rows.length<1)continue;
    const headers=rows[0].map(t=>t.toLowerCase());
    if(headers.length!==4||!headers[0].includes('line')||!headers[1].includes('scenario')||!headers[2].includes('reaction')||!headers[3].includes('pivot'))throw Error('Expected four columns: Line, Scenario, Reaction, Pivot. No data was replaced.');
    const filled=rows.slice(1).filter(r=>r.some(t=>t.trim()));if(!filled.length)continue;
    const id=`section-${data.sections.length+1}`;
    const section:Section={id,title:heading||`Section ${data.sections.length+1}`,scenes:[]};
    for(const r of filled){if(r.length!==4||r.some(t=>!t.trim()))throw Error(`An incomplete scene was found in ${section.title}. Fill all four columns before importing.`);number++;section.scenes.push({id:`scene-${number}`,number,line:r[0],scenario:r[1],reaction:r[2],pivot:r[3]});}
    data.sections.push(section);heading='';
  }
  // Section captions are not introductory instructions.
  const firstHeading=data.sections[0]?.title;
  const cut=data.guidance.indexOf(firstHeading);if(cut>=0)data.guidance=data.guidance.slice(0,cut);
  return validateDataset(data);
}
export async function fingerprint(data:Dataset):Promise<string>{
  const bytes=new TextEncoder().encode(JSON.stringify(validateDataset(data)));
  return Array.from(sha256(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
export const SOUNDS = [
  ['warm','Warm drone','Ambient'],['chords','Soft chords','Ambient'],['air','Airy pad','Ambient'],['bells','Distant bells','Ambient'],
  ['rain','Gentle rain','Nature-inspired'],['ocean','Ocean hush','Nature-inspired'],['stream','Flowing water','Nature-inspired'],['forest','Forest breeze','Nature-inspired'],
  ['white','White noise','Noise'],['pink','Pink noise','Noise'],['brown','Brown noise','Noise'],['soft','Soft filtered noise','Noise']
] as const;
