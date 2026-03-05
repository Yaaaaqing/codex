const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DeviceWorkflowService, WorkflowError, VersionType } = require('./workflow');

const svc = new DeviceWorkflowService();

const users = [
  { username: 'alice', password: 'alice123', role: 'debugger', displayName: '调试员 Alice' },
  { username: 'bob', password: 'bob123', role: 'owner', displayName: '产线负责人 Bob' },
  { username: 'admin', password: 'admin123', role: 'admin', displayName: '系统管理员' },
];
const sessions = new Map();

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { resolve({}); }
    });
  });
}

function serveStatic(req, res) {
  const map = {
    '/': 'index.html',
    '/index.html': 'index.html',
    '/main.js': 'main.js',
    '/styles.css': 'styles.css',
  };
  const file = map[req.url];
  if (!file) return false;
  const p = path.join(__dirname, 'public', file);
  const type = file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'application/javascript' : 'text/html';
  res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
  res.end(fs.readFileSync(p));
  return true;
}

function currentUser(req) {
  const token = req.headers['x-auth-token'];
  if (!token || !sessions.has(token)) return null;
  return sessions.get(token);
}

function requireAuth(req, res) {
  const user = currentUser(req);
  if (!user) {
    sendJson(res, 401, { error: 'unauthorized: please login' });
    return null;
  }
  return user;
}

async function api(req, res) {
  try {
    const body = await readBody(req);
    const url = req.url;

    if (req.method === 'POST' && url === '/api/login') {
      const found = users.find(u => u.username === body.username && u.password === body.password);
      if (!found) return sendJson(res, 401, { error: '用户名或密码错误' });
      const token = crypto.randomBytes(16).toString('hex');
      sessions.set(token, { username: found.username, role: found.role, displayName: found.displayName });
      return sendJson(res, 200, { token, user: { username: found.username, role: found.role, displayName: found.displayName } });
    }

    if (req.method === 'POST' && url === '/api/logout') {
      const token = req.headers['x-auth-token'];
      if (token) sessions.delete(token);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'GET' && url === '/api/me') {
      const me = requireAuth(req, res);
      if (!me) return;
      return sendJson(res, 200, { user: me });
    }

    const me = requireAuth(req, res);
    if (!me) return;

    if (req.method === 'GET' && url === '/api/devices') return sendJson(res, 200, svc.listDevices(me.role, me.username));
    if (req.method === 'POST' && url === '/api/devices') return sendJson(res, 200, svc.createDevice(body, me.role, me.username));

    const m = url.match(/^\/api\/devices\/([^/]+)\/(.+)$/);
    if (!m) return sendJson(res, 404, { error: 'not found' });
    const sn = decodeURIComponent(m[1]);
    const action = m[2];

    if (req.method === 'POST' && action === 'approve-baseline') return sendJson(res, 200, svc.approveBaseline(sn, me.role, me.username, body.approved));
    if (req.method === 'POST' && action === 'logs') return sendJson(res, 200, svc.addDebugLog(sn, body, me.role, me.username));
    if (req.method === 'POST' && action === 'versions') return sendJson(res, 200, svc.addProgramVersion(sn, body, me.role, me.username));
    if (req.method === 'POST' && action === 'submit-inspection') return sendJson(res, 200, svc.submitInspection(sn, me.role, me.username));
    if (req.method === 'POST' && action === 'sign-inspection') return sendJson(res, 200, svc.signInspection(sn, body.results || [], me.role, me.username));
    if (req.method === 'POST' && action === 'documents-ready') return sendJson(res, 200, svc.setDocumentsReady(sn, body.ready, me.role));
    if (req.method === 'POST' && action === 'archive-report') return sendJson(res, 200, svc.archiveInspectionReport(sn, me.role));
    if (req.method === 'POST' && action === 'approve-tech-docs') return sendJson(res, 200, svc.approveTechDocs(sn, me.role));
    if (req.method === 'POST' && action === 'deliver') return sendJson(res, 200, svc.deliver(sn, me.role));
    if (req.method === 'POST' && action === 'freeze') return sendJson(res, 200, svc.freeze(sn, me.role));

    return sendJson(res, 404, { error: 'not found' });
  } catch (e) {
    if (e instanceof WorkflowError) return sendJson(res, 400, { error: e.message });
    console.error(e);
    return sendJson(res, 500, { error: 'internal error' });
  }
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) return api(req, res);
  if (serveStatic(req, res)) return;
  sendJson(res, 404, { error: 'not found' });
});

svc.createDevice({ deviceSn: 'SN-1001', productLine: 'L1', model: 'M-Alpha', ownerDebugger: 'alice', baselineFileName: 'base.plc' }, 'admin', 'system');
svc.approveBaseline('SN-1001', 'admin', 'system', true);
svc.addDebugLog('SN-1001', {
  functionDomain: 'axis', objectName: 'x_limit', reason: 'optimize', summary: '调整参数',
  changedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(), loggedAt: new Date().toISOString(),
}, 'admin', 'system');
svc.addProgramVersion('SN-1001', { versionNo: 'v1.0.1', versionType: VersionType.PROCESS, fileName: 'proc.plc', sealed: false, note: 'process' }, 'admin', 'system');

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Web demo running: http://localhost:${port}`));
