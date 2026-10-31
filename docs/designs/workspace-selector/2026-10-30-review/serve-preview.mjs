import http from 'node:http';
import {readFile} from 'node:fs/promises';
const server=http.createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  const file=path==='/'?'preview.html':path==='/preview-bundle.iife.js'?'preview-bundle.iife.js':null;
  if(!file){res.writeHead(404).end();return}
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8');
  res.setHeader('Cache-Control','no-store');res.end(await readFile(new URL(file,import.meta.url)));
});server.listen(0,'127.0.0.1',()=>console.log(`Component QA: http://127.0.0.1:${server.address().port}`));
