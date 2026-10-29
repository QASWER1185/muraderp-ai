// Used exclusively by the loopback development server for an isolated demo.
const { randomUUID } = require('node:crypto');
const sessions = new Map();
const userId = '00000000-0000-4000-8000-000000000001';
module.exports = function localAuth(req, res, pathname, apiTarget, bridgeToken) {
  const chatAliases = new Set(['/api/v1/ai/copilot/v2/chat', ...['/api/v1/ai/copilot','/api/copilot'].flatMap(prefix=>['','/','/chat','/agent','/agent/input','/v2/chat'].map(suffix=>prefix+suffix))]);
  const isChat = chatAliases.has(pathname);
  if (!pathname.startsWith('/api/v1/') && !isChat) return false;
  const origin = req.headers.origin;
  if (origin && origin !== `http://${req.headers.host}`) {
    res.writeHead(403).end(); return true;
  }
  const send = (code, data, headers = {}) => {
    res.writeHead(code, {'content-type':'application/json', 'cache-control':'no-store', ...headers});
    res.end(JSON.stringify(data));
  };
  const token = req.headers.cookie?.match(/(?:^|;\s*)murad_local_demo=([^;]+)/)?.[1];
  const session = sessions.get(token);
  if (pathname === '/api/v1/auth/session') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; if (body.length > 4096) req.destroy(); });
      req.on('end', () => {
        try {
          const {email} = JSON.parse(body);
          if (typeof email !== 'string' || !email.includes('@')) return send(400, {error:{message:'Enter an email for the local demo.'}});
          const id = randomUUID();
          sessions.set(id, {userId, email});
          send(200, {user:{id:userId,email}, demo:true}, {'set-cookie':`murad_local_demo=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`});
        } catch { send(400, {error:{message:'Invalid local sign-in request.'}}); }
      });
    } else if (req.method === 'DELETE') {
      sessions.delete(token); send(200, {data:null}, {'set-cookie':'murad_local_demo=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});
    } else send(session ? 200 : 401, {data:session ?? null, demo:true});
    return true;
  }
  if (!session) { send(401, {error:{message:'Sign in to the local demo.'}}); return true; }
  if (pathname === '/api/v1/workspaces') {
    send(200, {demo:true,data:[{organizationId:'00000000-0000-4000-8000-000000000002',organizationName:'Local Demo — Empty Data',branches:[{branchId:'00000000-0000-4000-8000-000000000003',branchName:'Development'}]}]}); return true;
  }
  if (isChat && req.method === 'POST' && bridgeToken) {
    console.log('[CHAT-ROUTE]', req.method, pathname, '-> http://127.0.0.1:3000/__local-dev/copilot (v2)');
    const target = new URL('/__local-dev/copilot', apiTarget);
    if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(target.hostname)) { send(503, {error:{message:'Local bridge requires loopback HTTP.'}}); return true; }
    const upstream = require('node:http').request(target, {method:'POST',headers:{'content-type':'application/json','X-Local-Dev-Bridge':bridgeToken,'X-Api-Key':req.headers['x-api-key'] ?? ''}}, result=>{res.writeHead(result.statusCode, {'content-type':'application/json','cache-control':'no-store','X-Copilot-Pipeline':result.headers['x-copilot-pipeline'] ?? 'v2-local-demo'});result.pipe(res);});
    upstream.on('error', ()=>send(503,{error:{message:'Local Copilot bridge unavailable.'}}));
    upstream.setTimeout(240000,()=>upstream.destroy());req.pipe(upstream);return true;
  }
  // Keep demo sessions isolated from the real ERP, including all write routes.
  send(503, {demo:true,error:{code:'LOCAL_DEMO_DATA_UNAVAILABLE',message:'Local demo session: ERP database is not connected; no records were changed.'}});
  return true;
};
