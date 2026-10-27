import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('dist');
http.createServer(async(req,res)=>{try{let p=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!p.startsWith(root+path.sep)&&p!==root)throw Error();if(p===root||p.endsWith(path.sep))p=path.join(p,'index.html');const data=await readFile(p);res.setHeader('Content-Type',({'html':'text/html; charset=utf-8','js':'text/javascript','css':'text/css','json':'application/json','webmanifest':'application/manifest+json','svg':'image/svg+xml'})[p.split('.').pop()]||'application/octet-stream');res.end(data)}catch{res.writeHead(404);res.end('Not found')}}).listen(4173,'0.0.0.0',()=>console.log('Local: http://localhost:4173'));
