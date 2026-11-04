import {collectionPython} from './collection-python.mjs';
import {spawn} from 'node:child_process';
import {StringDecoder} from 'node:string_decoder';
import {join} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {inspectLoginState} from './douyin-config.mjs';
let login={state:'idle',detail:'尚未打开扫码窗口'};
export async function douyinLoginRoute({req,res,url,json,dataDir,root,launch=spawn}){
  if(url.pathname!=='/api/studio/douyin/login')return false;
  if(req.method==='GET'){json(res,200,login);return true;}
  if(req.method!=='POST')return false;
  if(login.state==='waiting'){json(res,202,login);return true;}
  const statePath=join(dataDir,'douyin-scan-state.json');
  login={state:'waiting',detail:'正在打开抖音窗口，请点击登录并使用手机扫码；最多等待 6 分钟。',startedAt:new Date().toISOString()};
  const child=launch(await collectionPython(dataDir),['-I','-u',join(root,'login-douyin.py'),statePath],{windowsHide:true,env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}});
  const decoder=new StringDecoder('utf8');
  child.stdout.on('data',chunk=>{const text=decoder.write(chunk).trim();if(text)login.detail=text.slice(-1000);});
  // Do not expose browser diagnostics or any cookie values to the page.
  child.stderr.on('data',()=>{});
  child.on('error',()=>{login={...login,state:'failed',detail:'扫码窗口启动失败，请检查本机 Python 与浏览器依赖后重试。'};});
  const timer=setTimeout(()=>{child.kill();},7*60*1000);timer.unref();
  child.on('close',async code=>{clearTimeout(timer);try{
    const result=code===0?await inspectLoginState(statePath):null;
    if(!result?.configured)throw new Error('login_not_completed');
    // Reuse the existing private ASR configuration, without returning credentials.
    await writeFile(join(dataDir,'douyin.env'),`DASHSCOPE_API_KEY=${process.env.DASHSCOPE_API_KEY||''}\nDOUYIN_STATE_PATH=${statePath}\n`,'utf8');
    process.env.DOUYIN_STATE_PATH=statePath;
    login={...login,state:'succeeded',detail:'登录成功，本机采集服务已接入该登录状态。'};
  }catch{login={...login,state:'failed',detail:'未完成登录（窗口关闭、超时或平台未确认）。已有采集结果保留，可重新打开扫码窗口。'};}});
  json(res,202,login);return true;
}
