const roleSelect = document.getElementById('roleSelect');
const userInput = document.getElementById('userInput');
const output = document.getElementById('output');
const deviceTable = document.getElementById('deviceTable');

function headers() {
  return { 'Content-Type': 'application/json', 'x-role': roleSelect.value, 'x-user': userInput.value };
}

function log(msg) { output.textContent = `${new Date().toLocaleTimeString()} ${msg}\n` + output.textContent; }

async function request(url, method = 'GET', body) {
  const res = await fetch(url, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'error');
  return data;
}

function roleTip() {
  const role = roleSelect.value;
  const tips = {
    debugger: 'debugger: 建档、记录修改、上传过程版本、提交检验（无封存/放行权限）',
    owner: 'owner: 检验签署、最终版本封存、资料确认、交付与冻结',
    admin: 'admin: 全部权限（用于本地验证）',
  };
  document.getElementById('roleTips').textContent = tips[role];
}

async function loadDevices() {
  try {
    const devices = await request('/api/devices');
    deviceTable.innerHTML = devices.map(d => `<tr><td>${d.deviceSn}</td><td>${d.productLine}</td><td>${d.model}</td><td>${d.status}</td><td>${d.ownerDebugger}</td><td>${d.programVersions.length}</td></tr>`).join('');
  } catch (e) { log(`加载失败: ${e.message}`); }
}

async function submitForm(e) {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target).entries());
  try { await request('/api/devices', 'POST', body); log('创建设备成功'); loadDevices(); }
  catch (e2) { log(`创建设备失败: ${e2.message}`); }
}

function sn() { return document.getElementById('sn').value; }
async function run(action, path, body) {
  try { await request(path, 'POST', body); log(`${action} 成功`); loadDevices(); }
  catch (e) { log(`${action} 失败: ${e.message}`); }
}
window.apiAddLog = () => run('新增调试日志', `/api/devices/${sn()}/logs`, {
  functionDomain: 'axis', objectName: 'x_limit', reason: 'adjust', summary: '前端操作',
  changedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(), loggedAt: new Date().toISOString(),
});
window.apiUploadProcess = () => run('上传过程版本', `/api/devices/${sn()}/versions`, {
  versionNo: `v1.0.${Math.floor(Math.random() * 100)}`,
  versionType: 'process', fileName: 'process.plc', sealed: false, note: 'frontend',
});
window.apiSubmitInspection = () => run('提交检验', `/api/devices/${sn()}/submit-inspection`, { checklistCodes: ['C1', 'C2'] });
window.apiSignInspection = () => run('检验签署', `/api/devices/${sn()}/sign-inspection`, {
  results: [{ itemCode: 'C1', required: true, passed: true }, { itemCode: 'C2', required: true, passed: true }],
});
window.apiSealFinal = () => run('封存最终版本', `/api/devices/${sn()}/versions`, {
  versionNo: 'v9.9.9', versionType: 'final', fileName: 'final.plc', sealed: true, note: 'seal',
});
window.apiDocsReady = () => run('资料齐全', `/api/devices/${sn()}/documents-ready`, { ready: true });
window.apiDeliver = () => run('交付', `/api/devices/${sn()}/deliver`);
window.apiFreeze = () => run('冻结', `/api/devices/${sn()}/freeze`);

document.getElementById('createForm').addEventListener('submit', submitForm);
document.getElementById('refreshBtn').addEventListener('click', loadDevices);
roleSelect.addEventListener('change', roleTip);
roleTip();
loadDevices();
