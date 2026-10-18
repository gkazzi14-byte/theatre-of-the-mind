import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const walk=async dir=>(await Promise.all((await readdir(dir,{withFileTypes:true})).map(x=>x.isDirectory()?walk(`${dir}/${x.name}`):`${dir}/${x.name}`))).flat();
const files=await walk('dist');
for(const f of files)if(/\.(docx|m4a)$|recipe\.json$|dataset\.json$|theatre\.zip$/.test(f))throw Error(`Personal asset must not be deployed: ${f}`);
const hash=createHash('sha256');for(const f of files.sort())hash.update(await readFile(f));
const version=hash.digest('hex').slice(0,14);
const assets=files.map(f=>f.slice(5));
await writeFile('dist/sw.js',`const CACHE='theatre-${version}';
const ASSETS=${JSON.stringify(assets)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('message',event=>{if(event.data==='ACTIVATE')self.skipWaiting()});
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('theatre-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const u=new URL(event.request.url);if(event.request.method!=='GET'||u.origin!==self.location.origin)return;
event.respondWith(caches.open(CACHE).then(async cache=>{const hit=await cache.match(event.request,{ignoreVary:true});if(hit){
const range=event.request.headers.get('range');
if(range&&new URL(event.request.url).pathname.endsWith('.wav')){
  const bytes=await hit.arrayBuffer(),size=bytes.byteLength;
  const match=/^bytes=(\\d*)-(\\d*)$/.exec(range);
  if(match&&(match[1]||match[2])){
    const start=match[1]?Number(match[1]):Math.max(0,size-Number(match[2]));
    const end=match[1]?(match[2]?Math.min(Number(match[2]),size-1):size-1):size-1;
    if(start>=size||start>end)return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+size}});
    const headers=new Headers(hit.headers);headers.set('Content-Range','bytes '+start+'-'+end+'/'+size);headers.set('Content-Length',String(end-start+1));headers.set('Accept-Ranges','bytes');
    return new Response(bytes.slice(start,end+1),{status:206,headers});
  }
  return new Response(bytes,{status:200,headers:hit.headers});
}
return hit;
}if(event.request.mode==='navigate')return (await cache.match(new URL('index.html',self.registration.scope).href,{ignoreVary:true}))||fetch(event.request);return fetch(event.request)}));});
`);
console.log(`Deployment check passed: ${files.length} public assets; offline cache ${version}.`);
