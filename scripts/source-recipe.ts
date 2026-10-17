// Optional Mac shortcut: create a private recipe from a four-column DOCX.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {parseDocx,fingerprint,defaults} from '../src/model';
globalThis.DOMParser=new JSDOM('').window.DOMParser;
const input=process.argv[2];if(!input)throw Error('Usage: node --import tsx scripts/source-recipe.ts /path/document.docx');
const data=parseDocx(new Uint8Array(await readFile(input)));
const settings={...defaults,section:data.sections[0].id,scene:data.sections[0].scenes[0].id,mode:'timed',background:'warm',rate:.9};
await mkdir('private',{recursive:true});
await writeFile('private/practice.recipe.json',JSON.stringify({version:1,kind:'recipe',fingerprint:await fingerprint(data),data,settings},null,2));
console.log(`Private recipe created: ${data.sections.length} sections, ${data.sections.reduce((n,s)=>n+s.scenes.length,0)} scenes. Session selects the first section, cell-by-cell, with 30-second gaps.`);
