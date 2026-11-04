import { sameOriginRequest } from './auth.mjs';

// Only the salted scrypt verifier is shipped; the password is never served to clients.
export const defaultPasswordHash = '7611c75f47937692fafc4af09cc9e07b:316bf0b410842d53474d2b314d53c34fea4160ec003af32c7d1b6f988f53315c';

const loginPage = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>登录 · SPX工作台</title><style>
*{box-sizing:border-box}body{margin:0;background:#fff;color:#181c23;font:14px system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;min-height:100vh;display:grid;place-items:center}.card{width:min(380px,calc(100vw - 40px));padding:32px;border:1px solid #e8eaed;border-radius:6px}h1{font-size:24px;font-weight:600;margin:0 0 28px}label{display:block;margin-bottom:8px;font-size:13px}input,button{width:100%;height:42px;border-radius:4px;font:inherit}input{padding:0 12px;border:1px solid #dcdfe6;background:#fff;color:#181c23}input:focus-visible{outline:2px solid #28831a;outline-offset:2px}button{margin-top:20px;background:#00a800;border:0;color:#fff;cursor:pointer}button:hover{background:#008c00}button:disabled{opacity:.6;cursor:wait}button:focus-visible{outline:2px solid #181c23;outline-offset:3px}.error{color:#c43a32;min-height:20px;margin:10px 0 0;font-size:13px}
</style></head><body><main class="card"><h1>SPX工作台</h1><form id="login"><label for="password">访问密码</label><input id="password" name="password" type="password" autocomplete="current-password" required autofocus maxlength="1024"><button type="submit">进入工作台</button><p class="error" role="alert" aria-live="polite"></p></form></main><script>
const form=document.querySelector('form'),button=form.querySelector('button'),error=form.querySelector('.error');
form.addEventListener('submit',async event=>{event.preventDefault();if(button.disabled)return;button.disabled=true;button.textContent='正在登录…';error.textContent='';try{const response=await fetch('/api/studio/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:form.password.value})});if(!response.ok){error.textContent=response.status===429?'尝试过于频繁，请稍后再试。':response.status===401?'密码错误，请重新输入。':'登录失败，请稍后再试。';form.password.focus();return}location.replace('/')}catch{error.textContent='连接失败，请检查网络后重试。'}finally{button.disabled=false;button.textContent='进入工作台'}});
</script></body></html>`;

export function createPasswordGate(auth, { now = Date.now, secureCookie = false } = {}) {
  const attempts = new Map();
  return async function passwordGate(req, res, url, { body, json }) {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'same-origin');
    res.setHeader('x-frame-options', 'DENY');
    const secure = secureCookie || Boolean(req.socket?.encrypted);
    if (url.pathname.startsWith('/api/') && !sameOriginRequest(req)) { json(res,403,{error:'cross_origin_request_denied'});return true; }
    if (req.method === 'POST' && url.pathname === '/api/studio/auth/login') {
      const address = req.socket?.remoteAddress || 'local';
      for (const [key, value] of attempts) if (value.until <= now()) attempts.delete(key);
      const attempt = attempts.get(address);
      if (attempt?.count >= 6) { res.setHeader('retry-after',String(Math.ceil((attempt.until-now())/1000)));json(res,429,{error:'login_rate_limited'});return true; }
      const input = await body(req);
      const session = auth.login(input?.token);
      if (!session) { attempts.set(address,{count:(attempt?.count||0)+1,until:attempt?.until||now()+60000});json(res,401,{error:'invalid_studio_token'});return true; }
      attempts.delete(address);
      res.setHeader('set-cookie',auth.cookie(session,secure));json(res,200,{authenticated:true});return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/studio/auth/logout') {
      auth.logout(req);res.setHeader('set-cookie',auth.cookie(null,secure));json(res,200,{authenticated:false});return true;
    }
    if (url.pathname === '/login' && ['GET','HEAD'].includes(req.method)) {
      if (auth.authorized(req)) { res.writeHead(303,{location:'/'});res.end(); }
      else { res.writeHead(200,{'content-type':'text/html; charset=utf-8','content-security-policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"});res.end(req.method==='HEAD'?'':loginPage); }
      return true;
    }
    if (auth.authorized(req)) return false;
    if (url.pathname.startsWith('/api/') || !['GET','HEAD'].includes(req.method)) json(res,401,{error:'studio_auth_required'});
    else { res.writeHead(303,{location:'/login'});res.end(); }
    return true;
  };
}
