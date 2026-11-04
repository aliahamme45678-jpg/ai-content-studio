import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const run=promisify(execFile);const cache=new Map();
export async function collectionPython(dataDir){
 if(cache.has(dataDir))return cache.get(dataDir);
 let configured;try{configured=JSON.parse(await readFile(join(dataDir,'collector-python.json'),'utf8')).executable;}catch{}
 const drive=process.env.SystemDrive||'C:';
 const candidates=[configured,process.env.STUDIO_PYTHON,`${drive}\\Python311\\python.exe`,`${drive}\\Python312\\python.exe`,`${drive}\\Python313\\python.exe`,'python'].filter(Boolean);
 for(const candidate of [...new Set(candidates)]){
  try{const {stdout}=await run(candidate,['-I','-c','import sys, requests; from playwright.async_api import async_playwright; print(sys.executable)'],{windowsHide:true,timeout:10000,encoding:'utf8'});const executable=stdout.trim();if(!executable)continue;cache.set(dataDir,executable);return executable;}catch{}
 }
 throw Object.assign(new Error('collector_python_dependencies_missing'),{statusCode:503});
}
