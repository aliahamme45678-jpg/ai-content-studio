import {readFile,writeFile,stat,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

export async function inspectLoginState(path,now=Date.now()){
  if(!path)return {configured:false,state:'visitor',detail:'游客模式；主页全量和评论可能被平台要求登录'};
  try{
    const info=await stat(path);if(!info.isFile()||info.size>4*1024*1024)throw new Error('invalid_size');
    const data=JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
    if(!Array.isArray(data.cookies)||!Array.isArray(data.origins))throw new Error('invalid_storage_state');
    const cookies=data.cookies.filter(c=>typeof c.name==='string'&&typeof c.value==='string'&&typeof c.domain==='string'&&/(^|\.)douyin\.com$/i.test(c.domain.replace(/^\./,'')));
    if(!cookies.length)return {configured:false,state:'invalid',detail:'文件不包含抖音登录状态，请选择浏览器导出的 storageState JSON'};
    const usable=cookies.filter(c=>!Number.isFinite(c.expires)||c.expires<=0||c.expires*1000>now);
    if(!usable.length)return {configured:false,state:'expired',detail:'文件中的抖音 Cookie 均已过期，请更新登录状态文件'};
    return {configured:true,state:'loaded',cookieCount:usable.length,detail:'登录状态文件可读取；平台是否接受仍以实际采集结果为准'};
  }catch{return {configured:false,state:'invalid',detail:'无法读取有效的登录状态 JSON；请选择文件，不能填写文件夹或网页链接'};}
}

export async function douyinConfigRoute(ctx){
  const {req,res,url,json,body,dataDir}=ctx;
  if(url.pathname!=='/api/studio/integrations/douyin/config')return false;
  if(req.method==='GET'){json(res,200,{asrKey:process.env.DASHSCOPE_API_KEY||'',asrConfigured:Boolean(process.env.DASHSCOPE_API_KEY),statePath:process.env.DOUYIN_STATE_PATH||'',login:await inspectLoginState(process.env.DOUYIN_STATE_PATH)});return true;}
  if(req.method!=='POST')return false;
  const input=await body(req),values={DASHSCOPE_API_KEY:process.env.DASHSCOPE_API_KEY||'',DOUYIN_STATE_PATH:process.env.DOUYIN_STATE_PATH||''};
  for(const [field,key] of [['asrKey','DASHSCOPE_API_KEY'],['statePath','DOUYIN_STATE_PATH']]){
    if(input[field]===undefined||input[field]==='')continue;
    if(typeof input[field]!=='string'||/[\r\n]/.test(input[field])){json(res,400,{error:'invalid_collection_config',detail:'配置必须是单行文字'});return true;}
    values[key]=input[field].trim();
  }
  if(input.clearState===true)values.DOUYIN_STATE_PATH='';
  let importedPath;
  if(input.stateJson!==undefined){
    if(typeof input.stateJson!=='string'||Buffer.byteLength(input.stateJson)>4*1024*1024){json(res,400,{error:'invalid_douyin_state',detail:'登录状态文件必须是小于 4 MB 的 JSON 文件'});return true;}
    importedPath=join(dataDir,`douyin-state-${randomUUID()}.json`);
    await writeFile(importedPath,input.stateJson,'utf8');values.DOUYIN_STATE_PATH=importedPath;
  }
  if(values.DOUYIN_STATE_PATH)values.DOUYIN_STATE_PATH=resolve(values.DOUYIN_STATE_PATH);
  const login=await inspectLoginState(values.DOUYIN_STATE_PATH);
  if(values.DOUYIN_STATE_PATH&&!login.configured){if(importedPath)await rm(importedPath,{force:true});json(res,400,{error:'invalid_douyin_state',detail:login.detail});return true;}
  await writeFile(join(dataDir,'douyin.env'),Object.entries(values).map(([k,v])=>`${k}=${v}`).join('\n')+'\n','utf8');Object.assign(process.env,values);
  json(res,200,{saved:true,asrConfigured:Boolean(values.DASHSCOPE_API_KEY),loginStateConfigured:login.configured,login});return true;
}
