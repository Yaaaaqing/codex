const http = require('http');
const fs = require('fs');
const path = require('path');
const { DeviceWorkflowService, WorkflowError, VersionType } = require('./workflow');

const svc = new DeviceWorkflowService();

function auth(req) {
  return {
    role: req.headers['x-role'] || 'debugger',
    user: req.headers['x-user'] || 'alice',
  };
}

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

async function api(req, res) {
  try {
    const { role, user } = auth(req);
    const body = await readBody(req);
    const url = req.url;

    if (req.method === 'GET' && url === '/api/devices') return sendJson(res, 200, svc.listDevices(role, user));
    if (req.method === 'POST' && url === '/api/devices') return sendJson(res, 200, svc.createDevice(body, role, user));

    const m = url.match(/^\/api\/devices\/([^/]+)\/(.+)$/);
    if (!m) return sendJson(res, 404, { error: 'not found' });
    const sn = decodeURIComponent(m[1]);
    const action = m[2];

    if (req.method === 'POST' && action === 'logs') return sendJson(res, 200, svc.addDebugLog(sn, body, role, user));
    if (req.method === 'POST' && action === 'versions') return sendJson(res, 200, svc.addProgramVersion(sn, body, role, user));
    if (req.method === 'POST' && action === 'submit-inspection') return sendJson(res, 200, svc.submitInspection(sn, body.checklistCodes || [], role, user));
    if (req.method === 'POST' && action === 'sign-inspection') return sendJson(res, 200, svc.signInspection(sn, body.results || [], role, user));
    if (req.method === 'POST' && action === 'documents-ready') return sendJson(res, 200, svc.setDocumentsReady(sn, body.ready, role));
    if (req.method === 'POST' && action === 'deliver') return sendJson(res, 200, svc.deliver(sn, role));
    if (req.method === 'POST' && action === 'freeze') return sendJson(res, 200, svc.freeze(sn, role));

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
svc.addDebugLog('SN-1001', {
  functionDomain: 'axis', objectName: 'x_limit', reason: 'optimize', summary: '调整参数',
  changedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(), loggedAt: new Date().toISOString(),
}, 'admin', 'system');
svc.addProgramVersion('SN-1001', { versionNo: 'v1.0.1', versionType: VersionType.PROCESS, fileName: 'proc.plc', sealed: false, note: 'process' }, 'admin', 'system');

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Web demo running: http://localhost:${port}`));
