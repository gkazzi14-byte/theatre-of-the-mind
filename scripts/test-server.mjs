// Static production fixture, including a GitHub-Pages-style repository subpath.
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('dist');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.webmanifest':'application/manifest+json','.png':'image/png','.wav':'audio/wav'};
createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');let pathname=decodeURIComponent(url.pathname);
  if(pathname.startsWith('/theatre-test/'))pathname=pathname.slice('/theatre-test'.length);
  if(pathname.endsWith('/'))pathname+='index.html';
  const file=path.resolve(root,'.'+pathname);
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  if(!(await stat(file)).isFile()){res.writeHead(404).end();return;}
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache','Vary':'Origin'});res.end(await readFile(file));
}catch{res.writeHead(404).end('Not found');}}).listen(4173,'127.0.0.1',()=>console.log('Production fixture: http://127.0.0.1:4173'));
