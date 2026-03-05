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

function roleConfig() {
  const role = roleSelect.value;
  const tips = {
    debugger: 'debugger: 建档、记录修改、上传过程版本、提交检验（不可审批/签署/交付）',
    owner: 'owner: 审批基线、质检签署、封存最终版本、资料归档审批、交付冻结',
    admin: 'admin: 全流程权限（系统治理/验证）',
  };
  const menus = {
    debugger: ['我的设备', '建档', '修改记录', '程序版本', '检验进度'],
    owner: ['产线总览', '待审批', '检验与放行', '风险看板'],
    admin: ['全局仪表盘', '设备检索', '模板管理', '系统参数'],
  };

  document.getElementById('roleTips').textContent = tips[role];
  document.getElementById('menuList').innerHTML = menus[role].map(m => `<li>${m}</li>`).join('');

  document.querySelectorAll('.role-debugger,.role-owner,.role-admin').forEach(el => {
    el.style.display = 'none';
  });
  document.querySelectorAll(`.role-${role},.role-admin`).forEach(el => {
    el.style.display = 'flex';
  });
  document.getElementById('createPanel').style.display = (role === 'owner') ? 'none' : 'block';
}

async function loadDevices() {
  try {
    const devices = await request('/api/devices');
    deviceTable.innerHTML = devices.map(d => {
      const baseline = d.programVersions.find(v => v.versionType === 'baseline');
      const templateVersion = d.inspectionTask?.templateVersion || '-';
      return `<tr>
        <td>${d.deviceSn}</td><td>${d.productLine}</td><td>${d.model}</td><td>${d.status}</td>
        <td>${d.ownerDebugger}</td><td>${baseline?.approved ? '已审批' : '待审批'}</td><td>${templateVersion}</td>
      </tr>`;
    }).join('');
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

window.apiApproveBaseline = () => run('审批基线', `/api/devices/${sn()}/approve-baseline`, { approved: true });
window.apiAddLog = () => run('新增调试日志', `/api/devices/${sn()}/logs`, {
  functionDomain: 'axis', objectName: 'x_limit', reason: 'adjust', summary: '前端操作',
  changedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(), loggedAt: new Date().toISOString(),
});
window.apiUploadProcess = () => run('上传过程版本', `/api/devices/${sn()}/versions`, {
  versionNo: `v1.0.${Math.floor(Math.random() * 100)}`,
  versionType: 'process', fileName: 'process.plc', sealed: false, note: 'frontend',
});
window.apiSubmitInspection = () => run('提交检验', `/api/devices/${sn()}/submit-inspection`);
window.apiSignInspection = () => run('检验签署', `/api/devices/${sn()}/sign-inspection`, {
  results: [
    { itemCode: 'C-AXIS', required: true, passed: true },
    { itemCode: 'C-INTERLOCK', required: true, passed: true },
    { itemCode: 'C-ALARM', required: true, passed: true },
  ],
});
window.apiSealFinal = () => run('封存最终版本', `/api/devices/${sn()}/versions`, {
  versionNo: 'v9.9.9', versionType: 'final', fileName: 'final.plc', sealed: true, note: 'seal',
});
window.apiDocsReady = () => run('资料齐全', `/api/devices/${sn()}/documents-ready`, { ready: true });
window.apiArchiveReport = () => run('归档检验报告', `/api/devices/${sn()}/archive-report`);
window.apiApproveTechDocs = () => run('审批技术文件', `/api/devices/${sn()}/approve-tech-docs`);
window.apiDeliver = () => run('交付', `/api/devices/${sn()}/deliver`);
window.apiFreeze = () => run('冻结', `/api/devices/${sn()}/freeze`);

document.getElementById('createForm').addEventListener('submit', submitForm);
document.getElementById('refreshBtn').addEventListener('click', loadDevices);
roleSelect.addEventListener('change', roleConfig);
roleConfig();
loadDevices();
