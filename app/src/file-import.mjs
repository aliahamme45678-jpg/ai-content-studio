import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export async function readImportFile(input) {
  if (!input.base64) return input;
  const extension = String(input.name || '').split('.').pop().toLowerCase();
  if (!['docx','xlsx','md','txt','csv','json','jsonl'].includes(extension)) throw Object.assign(new Error('unsupported_file_type'),{statusCode:400});
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64) || input.base64.length > 6 * 1024 * 1024) throw Object.assign(new Error('invalid_file_payload'),{statusCode:400});
  if (!['docx','xlsx'].includes(extension)) return {...input,text:Buffer.from(input.base64,'base64').toString('utf8').replace(/^\uFEFF/,'')};
  return new Promise((resolve,reject)=>{
    const child=spawn(process.env.STUDIO_PYTHON || 'python',['-u',fileURLToPath(new URL('./extract-file.py',import.meta.url))],{windowsHide:true,env:{...process.env,PYTHONUTF8:'1'},stdio:['pipe','pipe','pipe']});
    let output='';let error='';
    const timer=setTimeout(()=>child.kill(),15000);timer.unref();
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>12*1024*1024)child.kill();});child.stderr.on('data',chunk=>{error+=chunk;});
    child.once('error',e=>{clearTimeout(timer);reject(Object.assign(e,{statusCode:400}));});
    child.once('close',code=>{clearTimeout(timer);try{if(code!==0)throw new Error('file_parse_failed: '+error.slice(-200));resolve({...input,...JSON.parse(output)});}catch(e){reject(Object.assign(e,{statusCode:400}));}});
    child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({base64:input.base64,extension}));
  });
}
