const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { openDb, run, get, all } = require('./db');

const app = express();
app.use(bodyParser.json({ limit: '2mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

const sessions = new Map();

function genToken() { return uuidv4().replace(/-/g, ''); }
function nowIso() { return new Date().toISOString(); }
function tsYYYYMMDDHHmm() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;
}
function sanitizeLabel(label) {
  return String(label || 'NONAME').trim().replace(/\s+/g, '-').replace(/_+/g, '-').replace(/[^\w\u4e00-\u9fa5-]/g, '');
}
function makeVersionNo({ deviceSn, userLabel, code }) {
  return `${deviceSn}_${sanitizeLabel(userLabel)}_${code}_${tsYYYYMMDDHHmm()}`;
}
function fileHash(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function audit(db, { action, userId, dept, deviceSn = null, plcVersionId = null, detail = '' }) {
  await run(db, `
    INSERT INTO audit_logs (id, action, user_id, dept, device_id, plc_version_id, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [uuidv4(), action, userId, dept, deviceSn, plcVersionId, detail, nowIso()]);
}

function authRequired(req, res, next) {
  const m = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ message: '未登录' });
  const u = sessions.get(m[1]);
  if (!u) return res.status(401).json({ message: '会话失效，请重新登录' });
  req.user = u;
  req.token = m[1];
  next();
}

function roleAllowed(role, expected) {
  if (expected.includes(role)) return true;
  const aliases = {
    user: ['debugger'],
    dept_lead: ['supervisor'],
    admin: ['process_admin']
  };
  return (aliases[role] || []).some((r) => expected.includes(r));
}

function requireRoles(expected) {
  return (req, res, next) => {
    if (!roleAllowed(req.user.role, expected)) return res.status(403).json({ message: `仅允许角色: ${expected.join(',')}` });
    next();
  };
}

function canAccessDevice(user, deviceRow) {
  if (['admin', 'process_admin'].includes(user.role)) return true;
  if (['dept_lead', 'supervisor', 'qa'].includes(user.role)) return deviceRow.dept === user.dept;
  return deviceRow.created_by === user.id;
}

async function loadDevice(db, deviceSn) {
  return get(db, `SELECT * FROM devices WHERE device_sn=?`, [deviceSn]);
}

async function loadApprovedArchive(db, deviceSn) {
  return get(db, `SELECT * FROM debug_archives WHERE device_sn=? AND approval_status='APPROVED' ORDER BY created_at DESC LIMIT 1`, [deviceSn]);
}

async function assertApprovedArchive(db, deviceSn) {
  const archive = await loadApprovedArchive(db, deviceSn);
  return archive || null;
}

function machineMutable(device) {
  return !['INSPECTED', 'FROZEN'].includes(device.status);
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.post('/api/auth/login', async (req, res) => {
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ message: '缺少工号' });
  const db = openDb();
  try {
    const u = await get(db, `SELECT id,name,dept,role,enabled FROM users WHERE id=?`, [userId]);
    if (!u) return res.status(403).json({ message: '用户不存在' });
    if (u.enabled !== 1) return res.status(403).json({ message: '用户已停用' });
    const token = genToken();
    const sessionUser = { id: u.id, name: u.name, dept: u.dept, role: u.role };
    sessions.set(token, sessionUser);
    await audit(db, { action: '登录', userId: u.id, dept: u.dept, detail: `role=${u.role}` });
    res.json({ token, user: sessionUser });
  } catch (e) {
    res.status(500).json({ message: '登录失败', error: String(e) });
  } finally { db.close(); }
});

app.post('/api/auth/logout', authRequired, async (req, res) => {
  const db = openDb();
  try { await audit(db, { action: '登出', userId: req.user.id, dept: req.user.dept }); } catch {}
  sessions.delete(req.token);
  db.close();
  res.json({ ok: true });
});
app.get('/api/me', authRequired, (req, res) => res.json(req.user));

app.get('/api/admin/users', authRequired, requireRoles(['admin', 'process_admin']), async (req, res) => {
  const db = openDb();
  try { res.json(await all(db, `SELECT id,name,dept,role,enabled FROM users ORDER BY id`)); }
  catch (e) { res.status(500).json({ message: '查询失败', error: String(e) }); }
  finally { db.close(); }
});

app.post('/api/admin/users', authRequired, requireRoles(['admin', 'process_admin']), async (req, res) => {
  const { id, name, dept, role, enabled } = req.body || {};
  if (!id || !dept || !role) return res.status(400).json({ message: 'id/dept/role 必填' });
  const db = openDb();
  try {
    await run(db, `
      INSERT INTO users (id,name,dept,role,enabled) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,dept=excluded.dept,role=excluded.role,enabled=excluded.enabled
    `, [id, name || id, dept, role, (enabled === 0 || enabled === '0') ? 0 : 1]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: '保存失败', error: String(e) });
  } finally { db.close(); }
});

// ===== Machine + Debug Archive =====
app.post('/api/machines', authRequired, requireRoles(['debugger', 'supervisor', 'admin', 'process_admin']), async (req, res) => {
  const { deviceSn, name, model, series, productLine, productionUnit, customerName } = req.body || {};
  if (!deviceSn) return res.status(400).json({ message: 'deviceSn 必填' });
  const db = openDb();
  try {
    await run(db, `
      INSERT INTO devices (device_sn,name,model,series,product_line,production_unit,customer_name,dept,status,created_by,created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DEBUGGING', ?, ?)
    `, [deviceSn, name || deviceSn, model || null, series || null, productLine || null, productionUnit || null, customerName || null, req.user.dept, req.user.id, nowIso()]);
    await run(db, `INSERT INTO device_pointers (device_sn,current_version_id,baseline_version_id,sealed_version_id,baseline_locked,updated_at) VALUES (?,NULL,NULL,NULL,0,?)`, [deviceSn, nowIso()]);
    await audit(db, { action: 'MACHINE_CREATE', userId: req.user.id, dept: req.user.dept, deviceSn, detail: name || '' });
    res.json({ ok: true, deviceSn });
  } catch (e) {
    res.status(500).json({ message: '创建设备失败', error: String(e) });
  } finally { db.close(); }
});

app.post('/api/debug-archives', authRequired, requireRoles(['debugger', 'supervisor', 'admin']), async (req, res) => {
  const { deviceSn, plcDraftVersionId = null } = req.body || {};
  if (!deviceSn) return res.status(400).json({ message: 'deviceSn 必填' });
  const db = openDb();
  try {
    const device = await loadDevice(db, deviceSn);
    if (!device) return res.status(404).json({ message: '机床不存在' });
    if (!canAccessDevice(req.user, device)) return res.status(403).json({ message: '无权限' });
    const archiveId = uuidv4();
    await run(db, `
      INSERT INTO debug_archives (
        archive_id,device_sn,owner_user_id,plc_draft_version_id,approval_status,approver_user_id,approve_comment,approved_at,created_at,updated_at
      ) VALUES (?, ?, ?, ?, 'DRAFT', NULL, NULL, NULL, ?, ?)
    `, [archiveId, deviceSn, req.user.id, plcDraftVersionId, nowIso(), nowIso()]);
    await audit(db, { action: 'DEBUG_ARCHIVE_CREATE', userId: req.user.id, dept: req.user.dept, deviceSn, plcVersionId: plcDraftVersionId, detail: `archive=${archiveId}` });
    res.json({ ok: true, archiveId });
  } catch (e) {
    res.status(500).json({ message: '建档失败', error: String(e) });
  } finally { db.close(); }
});

app.post('/api/debug-archives/:archiveId/submit', authRequired, requireRoles(['debugger', 'supervisor', 'admin']), async (req, res) => {
  const db = openDb();
  try {
    const a = await get(db, `SELECT * FROM debug_archives WHERE archive_id=?`, [req.params.archiveId]);
    if (!a) return res.status(404).json({ message: '档案不存在' });
    const device = await loadDevice(db, a.device_sn);
    if (!device || !canAccessDevice(req.user, device)) return res.status(403).json({ message: '无权限' });
    await run(db, `UPDATE debug_archives SET approval_status='SUBMITTED', updated_at=? WHERE archive_id=?`, [nowIso(), a.archive_id]);
    await audit(db, { action: 'DEBUG_ARCHIVE_SUBMIT', userId: req.user.id, dept: req.user.dept, deviceSn: a.device_sn, plcVersionId: a.plc_draft_version_id, detail: `archive=${a.archive_id}` });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: '提交失败', error: String(e) });
  } finally { db.close(); }
});

app.post('/api/debug-archives/:archiveId/approve', authRequired, requireRoles(['supervisor', 'admin', 'dept_lead']), async (req, res) => {
  const db = openDb();
  try {
    const a = await get(db, `SELECT * FROM debug_archives WHERE archive_id=?`, [req.params.archiveId]);
    if (!a) return res.status(404).json({ message: '档案不存在' });
    const device = await loadDevice(db, a.device_sn);
    if (!device || !canAccessDevice(req.user, device)) return res.status(403).json({ message: '无权限' });
    await run(db, `UPDATE debug_archives SET approval_status='APPROVED', approver_user_id=?, approve_comment=?, approved_at=?, updated_at=? WHERE archive_id=?`, [req.user.id, req.body?.comment || '', nowIso(), nowIso(), a.archive_id]);
    await audit(db, { action: 'DEBUG_ARCHIVE_APPROVED', userId: req.user.id, dept: req.user.dept, deviceSn: a.device_sn, plcVersionId: a.plc_draft_version_id, detail: `archive=${a.archive_id}` });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: '审批失败', error: String(e) });
  } finally { db.close(); }
});

app.post('/api/debug-archives/:archiveId/reject', authRequired, requireRoles(['supervisor', 'admin', 'dept_lead']), async (req, res) => {
  const db = openDb();
  try {
    const a = await get(db, `SELECT * FROM debug_archives WHERE archive_id=?`, [req.params.archiveId]);
    if (!a) return res.status(404).json({ message: '档案不存在' });
    await run(db, `UPDATE debug_archives SET approval_status='REJECTED', approver_user_id=?, approve_comment=?, approved_at=?, updated_at=? WHERE archive_id=?`, [req.user.id, req.body?.comment || '', nowIso(), nowIso(), a.archive_id]);
    await audit(db, { action: 'DEBUG_ARCHIVE_REJECTED', userId: req.user.id, dept: req.user.dept, deviceSn: a.device_sn, plcVersionId: a.plc_draft_version_id, detail: `archive=${a.archive_id}` });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: '驳回失败', error: String(e) });
  } finally { db.close(); }
});

app.get('/api/machines/:deviceSn/debugArchive', authRequired, async (req, res) => {
  const db = openDb();
  try {
    const device = await loadDevice(db, req.params.deviceSn);
    if (!device) return res.status(404).json({ message: '机床不存在' });
    if (!canAccessDevice(req.user, device)) return res.status(403).json({ message: '无权限' });
    const a = await get(db, `SELECT * FROM debug_archives WHERE device_sn=? ORDER BY created_at DESC LIMIT 1`, [req.params.deviceSn]);
    res.json(a || null);
  } catch (e) {
    res.status(500).json({ message: '查询失败', error: String(e) });
  } finally { db.close(); }
});

// ===== Existing device APIs kept for frontend =====
app.get('/api/devices', authRequired, async (req, res) => {
  const db = openDb();
  try {
    let rows = [];
    if (['admin', 'process_admin'].includes(req.user.role)) rows = await all(db, `SELECT * FROM devices ORDER BY created_at DESC`);
    else if (['dept_lead', 'supervisor', 'qa'].includes(req.user.role)) rows = await all(db, `SELECT * FROM devices WHERE dept=? ORDER BY created_at DESC`, [req.user.dept]);
    else rows = await all(db, `SELECT * FROM devices WHERE created_by=? ORDER BY created_at DESC`, [req.user.id]);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ message: '查询设备失败', error: String(e) });
  } finally { db.close(); }
});

app.get('/api/devices/:deviceSn', authRequired, async (req, res) => {
  const db = openDb();
  try {
    const device = await loadDevice(db, req.params.deviceSn);
    if (!device) return res.status(404).json({ message: '设备不存在' });
    if (!canAccessDevice(req.user, device)) return res.status(403).json({ message: '无权限' });
    const pointers = await get(db, `SELECT * FROM device_pointers WHERE device_sn=?`, [req.params.deviceSn]) || {};
    const baseline = pointers.baseline_version_id ? await get(db, `SELECT * FROM plc_versions WHERE plc_version_id=?`, [pointers.baseline_version_id]) : null;
    const current = pointers.current_version_id ? await get(db, `SELECT * FROM plc_versions WHERE plc_version_id=?`, [pointers.current_version_id]) : null;
    const sealed = pointers.sealed_version_id ? await get(db, `SELECT * FROM plc_versions WHERE plc_version_id=?`, [pointers.sealed_version_id]) : null;
    const baselineCandidates = await all(db, `SELECT plc_version_id,version_no,approval_status,created_by,created_at FROM plc_versions WHERE device_sn=? AND version_type='B' ORDER BY created_at DESC`, [req.params.deviceSn]);
    res.json({ device, pointers, baseline, current, sealed, baselineCandidates });
  } catch (e) {
    res.status(500).json({ message: '查询失败', error: String(e) });
  } finally { db.close(); }
});

app.post('/api/devices', authRequired, upload.single('baselineFile'), async (req, res) => {
  const { deviceSn, name, userLabel } = req.body || {};
  if (!deviceSn || !userLabel || !req.file) return res.status(400).json({ message: 'deviceSn/userLabel/baselineFile 必填' });
  const db = openDb();
  try {
    const exists = await loadDevice(db, deviceSn);
    if (exists) return res.status(400).json({ message: 'deviceSn 已存在' });

    await run(db, `INSERT INTO devices (device_sn,name,dept,status,created_by,created_at) VALUES (?, ?, ?, 'DEBUGGING', ?, ?)`, [deviceSn, name || deviceSn, req.user.dept, req.user.id, nowIso()]);
    await run(db, `INSERT INTO device_pointers (device_sn,current_version_id,baseline_version_id,sealed_version_id,baseline_locked,updated_at) VALUES (?,NULL,NULL,NULL,0,?)`, [deviceSn, nowIso()]);

    const plcVersionId = uuidv4();
    const versionNo = makeVersionNo({ deviceSn, userLabel, code: 'B' });
    await run(db, `
      INSERT INTO plc_versions (
        plc_version_id,device_sn,version_no,user_label,version_type,version_seq,source_type,change_span,file_ref,file_hash,
        approval_status,approved_by,approved_at,created_by,created_at
      ) VALUES (?, ?, ?, ?, 'B', 0, 'upload', NULL, ?, ?, 'PENDING', NULL, NULL, ?, ?)
    `, [plcVersionId, deviceSn, versionNo, userLabel, req.file.path, fileHash(req.file.path), req.user.id, nowIso()]);

    const archiveId = uuidv4();
    await run(db, `
      INSERT INTO debug_archives (
        archive_id,device_sn,owner_user_id,plc_draft_version_id,approval_status,approver_user_id,approve_comment,approved_at,created_at,updated_at
      ) VALUES (?, ?, ?, ?, 'DRAFT', NULL, NULL, NULL, ?, ?)
    `, [archiveId, deviceSn, req.user.id, plcVersionId, nowIso(), nowIso()]);

    await audit(db, { action: 'PLC_BASELINE_SUBMIT', userId: req.user.id, dept: req.user.dept, deviceSn, plcVersionId, detail: `versionNo=${versionNo}` });
    res.json({ deviceSn, baselinePlcVersionId: plcVersionId, archiveId, message: '已建档(草稿)并提交基线版本，审批通过前不可调试' });
  } catch (e) {
    res.status(500).json({ message: '创建失败', error: String(e) });
  } finally { db.close(); }
});

app.post('/api/devices/:deviceSn/baseline/:plcVersionId/approve', authRequired, requireRoles(['supervisor', 'admin', 'dept_lead']), async (req, res) => {
  const db = openDb();
  try {
    const { deviceSn, plcVersionId } = req.params;
    const device = await loadDevice(db, deviceSn);
    if (!device) return res.status(404).json({ message: '设备不存在' });
    if (!canAccessDevice(req.user, device)) return res.status(403).json({ message: '无权限' });
    const ptr = await get(db, `SELECT * FROM device_pointers WHERE device_sn=?`, [deviceSn]);
    if (ptr?.baseline_locked === 1) return res.status(400).json({ message: 'Baseline已锁定' });

    await run(db, `UPDATE plc_versions SET approval_status='APPROVED',approved_by=?,approved_at=? WHERE plc_version_id=? AND device_sn=?`, [req.user.id, nowIso(), plcVersionId, deviceSn]);
    await run(db, `UPDATE device_pointers SET baseline_version_id=?,baseline_locked=1,updated_at=? WHERE device_sn=?`, [plcVersionId, nowIso(), deviceSn]);
    await run(db, `UPDATE debug_archives SET approval_status='APPROVED',approver_user_id=?,approve_comment=?,approved_at=?,updated_at=? WHERE device_sn=? AND plc_draft_version_id=?`, [req.user.id, 'baseline approved', nowIso(), nowIso(), deviceSn, plcVersionId]);
    await audit(db, { action: 'PLC_BASELINE_APPROVE', userId: req.user.id, dept: req.user.dept, deviceSn, plcVersionId });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: '审批失败', error: String(e) });
  } finally { db.close(); }
});

app.post('/api/devices/:deviceSn/baseline/:plcVersionId/reject', authRequired, requireRoles(['supervisor', 'admin', 'dept_lead']), async (req, res) => {
  const db = openDb();
  try {
    const { deviceSn, plcVersionId } = req.params;
    await run(db, `UPDATE plc_versions SET approval_status='REJECTED',approved_by=?,approved_at=? WHERE plc_version_id=? AND device_sn=?`, [req.user.id, nowIso(), plcVersionId, deviceSn]);
    await run(db, `UPDATE debug_archives SET approval_status='REJECTED',approver_user_id=?,approve_comment=?,approved_at=?,updated_at=? WHERE device_sn=? AND plc_draft_version_id=?`, [req.user.id, req.body?.reason || '', nowIso(), nowIso(), deviceSn, plcVersionId]);
    await audit(db, { action: 'PLC_BASELINE_REJECT', userId: req.user.id, dept: req.user.dept, deviceSn, plcVersionId, detail: req.body?.reason || '' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: '驳回失败', error: String(e) });
  } finally { db.close(); }
});

app.get('/api/devices/:deviceSn/plcVersions', authRequired, async (req, res) => {
  const db = openDb();
  try {
    const device = await loadDevice(db, req.params.deviceSn);
    if (!device || !canAccessDevice(req.user, device)) return res.status(403).json({ message: '无权限' });
    const rows = await all(db, `SELECT plc_version_id,version_no,user_label,version_type,version_seq,approval_status,approved_by,approved_at,created_by,created_at FROM plc_versions WHERE device_sn=? ORDER BY created_at DESC`, [req.params.deviceSn]);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ message: '查询失败', error: String(e) });
  } finally { db.close(); }
});

app.get('/api/devices/:deviceSn/versions', authRequired, async (req, res) => {
  const db = openDb();
  try {
    const device = await loadDevice(db, req.params.deviceSn);
    if (!device || !canAccessDevice(req.user, device)) return res.status(403).json({ message: '无权限' });
    const rows = await all(db, `SELECT plc_version_id AS id, version_no AS display_no, file_ref AS filename, created_at FROM plc_versions WHERE device_sn=? ORDER BY created_at DESC`, [req.params.deviceSn]);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ message: '查询失败', error: String(e) });
  } finally { db.close(); }
});

app.post('/api/devices/:deviceSn/versions', authRequired, upload.single('file'), async (req, res) => {
  const db = openDb();
  try {
    const { deviceSn } = req.params;
    const device = await loadDevice(db, deviceSn);
    if (!device) return res.status(404).json({ message: '设备不存在' });
    if (!canAccessDevice(req.user, device)) return res.status(403).json({ message: '无权限' });
    if (!machineMutable(device)) return res.status(400).json({ message: '已检验/已冻结机床禁止直接调试修改' });
    const archive = await assertApprovedArchive(db, deviceSn);
    if (!archive) return res.status(400).json({ message: '未建档审批通过，不允许上传过程版本' });
    if (!req.file) return res.status(400).json({ message: 'file 必传' });

    const id = uuidv4();
    const userLabel = req.body?.versionLabel || '过程版本';
    const versionNo = makeVersionNo({ deviceSn, userLabel, code: 'P' });
    await run(db, `
      INSERT INTO plc_versions (
        plc_version_id,device_sn,version_no,user_label,version_type,version_seq,source_type,change_span,file_ref,file_hash,
        approval_status,approved_by,approved_at,created_by,created_at
      ) VALUES (?, ?, ?, ?, 'P', 0, 'upload', NULL, ?, ?, 'NA', NULL, NULL, ?, ?)
    `, [id, deviceSn, versionNo, userLabel, req.file.path, fileHash(req.file.path), req.user.id, nowIso()]);
    await audit(db, { action: 'PROCESS_VERSION_UPLOAD', userId: req.user.id, dept: req.user.dept, deviceSn, plcVersionId: id, detail: versionNo });
    res.json({ ok: true, id });
  } catch (e) {
    res.status(500).json({ message: '上传失败', error: String(e) });
  } finally { db.close(); }
});

app.post('/api/devices/:deviceSn/versions/:vid/set-current', authRequired, async (req, res) => {
  const db = openDb();
  try {
    const { deviceSn, vid } = req.params;
    const device = await loadDevice(db, deviceSn);
    if (!device || !canAccessDevice(req.user, device)) return res.status(403).json({ message: '无权限' });
    await run(db, `UPDATE device_pointers SET current_version_id=?,updated_at=? WHERE device_sn=?`, [vid, nowIso(), deviceSn]);
    await audit(db, { action: 'SET_CURRENT_VERSION', userId: req.user.id, dept: req.user.dept, deviceSn, plcVersionId: vid });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: '设置失败', error: String(e) });
  } finally { db.close(); }
});

app.post('/api/devices/:deviceSn/versions/:vid/set-baseline', authRequired, async (req, res) => {
  const db = openDb();
  try {
    const { deviceSn, vid } = req.params;
    const device = await loadDevice(db, deviceSn);
    if (!device || !canAccessDevice(req.user, device)) return res.status(403).json({ message: '无权限' });
    await run(db, `UPDATE device_pointers SET baseline_version_id=?,updated_at=? WHERE device_sn=?`, [vid, nowIso(), deviceSn]);
    await audit(db, { action: 'SET_BASELINE_VERSION', userId: req.user.id, dept: req.user.dept, deviceSn, plcVersionId: vid });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: '设置失败', error: String(e) });
  } finally { db.close(); }
});

app.post('/api/devices/:deviceSn/changeRecords', authRequired, async (req, res) => {
  const { changeReason, changeSummary, impactInspection, functionDomain } = req.body || {};
  if (!changeReason || !changeSummary) return res.status(400).json({ message: 'changeReason/changeSummary 必填' });
  const db = openDb();
  try {
    const device = await loadDevice(db, req.params.deviceSn);
    if (!device) return res.status(404).json({ message: '设备不存在' });
    if (!canAccessDevice(req.user, device)) return res.status(403).json({ message: '无权限' });
    if (!machineMutable(device)) return res.status(400).json({ message: '已检验/已冻结机床禁止直接修改' });
    const archive = await assertApprovedArchive(db, req.params.deviceSn);
    if (!archive) return res.status(400).json({ message: '未建档审批通过，不允许填写变更记录' });

    const changeId = uuidv4();
    const now = nowIso();
    const lateHours = Math.floor((Date.now() - new Date(now).getTime()) / 3600000);
    await run(db, `
      INSERT INTO change_records (
        change_id,device_sn,plc_version_id,function_domain,change_date,changer_user_id,change_reason,change_summary,impact_inspection,is_backfilled,created_at
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [changeId, req.params.deviceSn, functionDomain || 'General', now, req.user.id, changeReason, changeSummary, impactInspection ? 1 : 0, lateHours > 24 ? 1 : 0, now]);

    await audit(db, { action: 'CHANGE_RECORD_CREATE', userId: req.user.id, dept: req.user.dept, deviceSn: req.params.deviceSn, detail: `impactInspection=${impactInspection ? 1 : 0}` });
    res.json({ ok: true, changeId });
  } catch (e) {
    res.status(500).json({ message: '保存失败', error: String(e) });
  } finally { db.close(); }
});

app.get('/api/devices/:deviceSn/changeRecords', authRequired, async (req, res) => {
  const db = openDb();
  try {
    const rows = await all(db, `
      SELECT *,
             CASE WHEN ((strftime('%s','now') - strftime('%s', change_date)) / 3600) > 24 THEN 1 ELSE 0 END AS overdue_24h
      FROM change_records
      WHERE device_sn=?
      ORDER BY created_at DESC
    `, [req.params.deviceSn]);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ message: '查询失败', error: String(e) });
  } finally { db.close(); }
});

app.get('/api/versions/:vid/download', authRequired, async (req, res) => {
  const db = openDb();
  try {
    const v = await get(db, `SELECT * FROM plc_versions WHERE plc_version_id=?`, [req.params.vid]);
    if (!v) return res.status(404).json({ message: '版本不存在' });
    const device = await loadDevice(db, v.device_sn);
    if (!device || !canAccessDevice(req.user, device)) return res.status(403).json({ message: '无权限' });
    if (!v.file_ref || !fs.existsSync(v.file_ref)) return res.status(404).json({ message: '文件不存在' });
    res.download(v.file_ref, path.basename(v.file_ref));
  } catch (e) {
    res.status(500).json({ message: '下载失败', error: String(e) });
  } finally { db.close(); }
});

// ===== Checklist freeze =====
app.post('/api/checklists/templates', authRequired, requireRoles(['process_admin', 'admin']), async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ message: 'name 必填' });
  const db = openDb();
  try {
    const templateId = uuidv4();
    await run(db, `INSERT INTO checklist_templates (template_id,name,owner_user_id,review_status,created_at) VALUES (?, ?, ?, 'DRAFT', ?)`, [templateId, name, req.user.id, nowIso()]);
    res.json({ ok: true, templateId });
  } catch (e) {
    res.status(500).json({ message: '创建模板失败', error: String(e) });
  } finally { db.close(); }
});

app.post('/api/checklists/templates/:templateId/items', authRequired, requireRoles(['process_admin', 'admin']), async (req, res) => {
  const { itemCode, itemName, isRequired } = req.body || {};
  if (!itemCode || !itemName) return res.status(400).json({ message: 'itemCode/itemName 必填' });
  const db = openDb();
  try {
    const itemId = uuidv4();
    await run(db, `INSERT INTO checklist_template_items (item_id,template_id,item_code,item_name,is_required,created_at) VALUES (?, ?, ?, ?, ?, ?)`, [itemId, req.params.templateId, itemCode, itemName, isRequired ? 1 : 0, nowIso()]);
    res.json({ ok: true, itemId });
  } catch (e) {
    res.status(500).json({ message: '新增项失败', error: String(e) });
  } finally { db.close(); }
});

app.post('/api/checklists/templates/:templateId/freeze', authRequired, requireRoles(['process_admin', 'admin']), async (req, res) => {
  const db = openDb();
  try {
    const items = await all(db, `SELECT * FROM checklist_template_items WHERE template_id=? ORDER BY created_at`, [req.params.templateId]);
    if (!items.length) return res.status(400).json({ message: '模板无检验项，不能冻结' });
    const year = new Date().getFullYear();
    const count = (await get(db, `SELECT COUNT(1) AS c FROM checklist_frozen_versions WHERE version_no LIKE ?`, [`CL-${year}-%`]))?.c || 0;
    const versionNo = `CL-${year}-${String(count + 1).padStart(3, '0')}`;
    const frozenVersionId = uuidv4();
    await run(db, `INSERT INTO checklist_frozen_versions (frozen_version_id,template_id,version_no,status,created_by,created_at) VALUES (?, ?, ?, 'FROZEN', ?, ?)`, [frozenVersionId, req.params.templateId, versionNo, req.user.id, nowIso()]);
    for (const it of items) {
      await run(db, `INSERT INTO checklist_frozen_items (frozen_item_id,frozen_version_id,item_code,item_name,is_required,created_at) VALUES (?, ?, ?, ?, ?, ?)`, [uuidv4(), frozenVersionId, it.item_code, it.item_name, it.is_required, nowIso()]);
    }
    res.json({ ok: true, frozenVersionId, versionNo, itemCount: items.length });
  } catch (e) {
    res.status(500).json({ message: '冻结失败', error: String(e) });
  } finally { db.close(); }
});

// ===== Inspection =====
app.post('/api/machines/:deviceSn/inspection-tasks/generate', authRequired, requireRoles(['qa', 'process_admin', 'admin']), async (req, res) => {
  const { frozenVersionId } = req.body || {};
  if (!frozenVersionId) return res.status(400).json({ message: 'frozenVersionId 必填' });
  const db = openDb();
  try {
    const device = await loadDevice(db, req.params.deviceSn);
    if (!device) return res.status(404).json({ message: '机床不存在' });
    const archive = await assertApprovedArchive(db, req.params.deviceSn);
    if (!archive) return res.status(400).json({ message: '未建档审批通过，不允许生成检验任务' });

    const fz = await get(db, `SELECT * FROM checklist_frozen_versions WHERE frozen_version_id=? AND status='FROZEN'`, [frozenVersionId]);
    if (!fz) return res.status(404).json({ message: '冻结清单版本不存在' });

    const items = await all(db, `SELECT * FROM checklist_frozen_items WHERE frozen_version_id=?`, [frozenVersionId]);
    for (const it of items) {
      await run(db, `
        INSERT INTO inspection_tasks (task_id,device_sn,frozen_version_id,item_code,item_name,is_required,result,remark,evidence_ref,qa_user_id,qa_signed_at,created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'PENDING', NULL, NULL, NULL, NULL, ?)
      `, [uuidv4(), req.params.deviceSn, frozenVersionId, it.item_code, it.item_name, it.is_required, nowIso()]);
    }
    await run(db, `UPDATE devices SET status='PENDING_INSPECTION' WHERE device_sn=?`, [req.params.deviceSn]);
    await audit(db, { action: 'INSPECTION_TASKS_GENERATED', userId: req.user.id, dept: req.user.dept, deviceSn: req.params.deviceSn, detail: `frozenVersionId=${frozenVersionId}` });
    res.json({ ok: true, generated: items.length });
  } catch (e) {
    res.status(500).json({ message: '生成失败', error: String(e) });
  } finally { db.close(); }
});

app.get('/api/machines/:deviceSn/inspection-tasks', authRequired, async (req, res) => {
  const db = openDb();
  try {
    const rows = await all(db, `SELECT * FROM inspection_tasks WHERE device_sn=? ORDER BY created_at`, [req.params.deviceSn]);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ message: '查询失败', error: String(e) });
  } finally { db.close(); }
});

app.post('/api/inspection-tasks/:taskId/result', authRequired, requireRoles(['qa']), async (req, res) => {
  const { result, remark, evidenceRef } = req.body || {};
  if (!['PASS', 'FAIL'].includes(result)) return res.status(400).json({ message: 'result 仅支持 PASS/FAIL' });
  const db = openDb();
  try {
    const t = await get(db, `SELECT * FROM inspection_tasks WHERE task_id=?`, [req.params.taskId]);
    if (!t) return res.status(404).json({ message: '任务不存在' });
    await run(db, `UPDATE inspection_tasks SET result=?,remark=?,evidence_ref=?,qa_user_id=?,qa_signed_at=? WHERE task_id=?`, [result, remark || '', evidenceRef || null, req.user.id, nowIso(), req.params.taskId]);
    await audit(db, { action: 'INSPECTION_TASK_SIGN', userId: req.user.id, dept: req.user.dept, deviceSn: t.device_sn, detail: `${t.item_code}:${result}` });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: '保存失败', error: String(e) });
  } finally { db.close(); }
});

app.get('/api/machines/:deviceSn/delivery-gate', authRequired, async (req, res) => {
  const db = openDb();
  try {
    const deviceSn = req.params.deviceSn;
    const approvedArchive = !!(await assertApprovedArchive(db, deviceSn));
    const requiredTotal = (await get(db, `SELECT COUNT(1) AS c FROM inspection_tasks WHERE device_sn=? AND is_required=1`, [deviceSn]))?.c || 0;
    const requiredPassed = (await get(db, `SELECT COUNT(1) AS c FROM inspection_tasks WHERE device_sn=? AND is_required=1 AND result='PASS' AND qa_signed_at IS NOT NULL`, [deviceSn]))?.c || 0;
    const pointers = await get(db, `SELECT * FROM device_pointers WHERE device_sn=?`, [deviceSn]);
    const finalSealed = !!pointers?.sealed_version_id;
    res.json({
      approvedArchive,
      requiredTotal,
      requiredPassed,
      requiredAllPassed: requiredTotal > 0 && requiredTotal === requiredPassed,
      finalSealed,
      canDeliver: approvedArchive && requiredTotal > 0 && requiredTotal === requiredPassed && finalSealed
    });
  } catch (e) {
    res.status(500).json({ message: '查询失败', error: String(e) });
  } finally { db.close(); }
});

app.post('/api/machines/:deviceSn/finalize-delivery', authRequired, requireRoles(['qa', 'supervisor', 'admin']), async (req, res) => {
  const { plcVersionId } = req.body || {};
  if (!plcVersionId) return res.status(400).json({ message: 'plcVersionId 必填' });
  const db = openDb();
  try {
    const deviceSn = req.params.deviceSn;
    const v = await get(db, `SELECT * FROM plc_versions WHERE plc_version_id=? AND device_sn=?`, [plcVersionId, deviceSn]);
    if (!v) return res.status(404).json({ message: '版本不存在' });

    const requiredTotal = (await get(db, `SELECT COUNT(1) AS c FROM inspection_tasks WHERE device_sn=? AND is_required=1`, [deviceSn]))?.c || 0;
    const requiredPassed = (await get(db, `SELECT COUNT(1) AS c FROM inspection_tasks WHERE device_sn=? AND is_required=1 AND result='PASS' AND qa_signed_at IS NOT NULL`, [deviceSn]))?.c || 0;
    if (!(requiredTotal > 0 && requiredTotal === requiredPassed)) {
      return res.status(400).json({ message: '必选检验项未全部通过并签署，不能封存最终版本' });
    }

    await run(db, `UPDATE plc_versions SET version_type='F',approval_status='APPROVED',approved_by=?,approved_at=? WHERE plc_version_id=?`, [req.user.id, nowIso(), plcVersionId]);
    await run(db, `UPDATE device_pointers SET sealed_version_id=?,current_version_id=?,updated_at=? WHERE device_sn=?`, [plcVersionId, plcVersionId, nowIso(), deviceSn]);
    await run(db, `UPDATE devices SET status='INSPECTED' WHERE device_sn=?`, [deviceSn]);

    const report = {
      deviceSn,
      plcVersionId,
      generatedAt: nowIso(),
      generatedBy: req.user.id,
      summary: '交付功能检验报告（演示）'
    };
    const reportPath = path.join(UPLOAD_DIR, `report-${deviceSn}-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    await run(db, `INSERT INTO inspection_reports (report_id,device_sn,frozen_version_id,report_ref,created_by,created_at) VALUES (?, ?, NULL, ?, ?, ?)`, [uuidv4(), deviceSn, reportPath, req.user.id, nowIso()]);

    await audit(db, { action: 'FINAL_VERSION_SEALED', userId: req.user.id, dept: req.user.dept, deviceSn, plcVersionId, detail: `report=${path.basename(reportPath)}` });
    res.json({ ok: true, reportPath, status: 'INSPECTED' });
  } catch (e) {
    res.status(500).json({ message: '封存失败', error: String(e) });
  } finally { db.close(); }
});

app.post('/api/machines/:deviceSn/delivery-status', authRequired, requireRoles(['qa', 'supervisor', 'admin', 'process_admin']), async (req, res) => {
  const { status } = req.body || {};
  const allowed = ['DEBUGGING', 'PENDING_INSPECTION', 'INSPECTED', 'DELIVERED', 'FROZEN'];
  if (!allowed.includes(status)) return res.status(400).json({ message: '非法状态' });
  const db = openDb();
  try {
    await run(db, `UPDATE devices SET status=? WHERE device_sn=?`, [status, req.params.deviceSn]);
    await audit(db, { action: 'DELIVERY_STATUS_CHANGE', userId: req.user.id, dept: req.user.dept, deviceSn: req.params.deviceSn, detail: status });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: '更新失败', error: String(e) });
  } finally { db.close(); }
});

app.get('/api/devices/:deviceId/timeline', authRequired, async (req, res) => {
  const db = openDb();
  try {
    const rows = await all(db, `SELECT created_at,action,user_id,detail,plc_version_id FROM audit_logs WHERE device_id=? ORDER BY created_at DESC LIMIT 200`, [req.params.deviceId]);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ message: '查询失败', error: String(e) });
  } finally { db.close(); }
});

app.get('/api/kpi/employee', authRequired, async (req, res) => {
  const db = openDb();
  try {
    const deviceSns = (await all(db, `SELECT device_sn FROM devices WHERE created_by=?`, [req.user.id])).map(r => r.device_sn);
    if (!deviceSns.length) return res.json({ deviceCount: 0, versionCount: 0, needBaselineCount: 0 });
    const placeholders = deviceSns.map(() => '?').join(',');
    const versionCount = (await get(db, `SELECT COUNT(1) c FROM plc_versions WHERE device_sn IN (${placeholders})`, deviceSns))?.c || 0;
    const needBaseline = (await get(db, `SELECT COUNT(1) c FROM device_pointers WHERE device_sn IN (${placeholders}) AND baseline_version_id IS NULL`, deviceSns))?.c || 0;
    res.json({ deviceCount: deviceSns.length, versionCount, needBaselineCount: needBaseline });
  } catch (e) {
    res.status(500).json({ message: '查询失败', error: String(e) });
  } finally { db.close(); }
});

app.get('/api/kpi/dept', authRequired, async (req, res) => {
  const db = openDb();
  try {
    const params = ['admin', 'process_admin'].includes(req.user.role) ? [] : [req.user.dept];
    const where = params.length ? 'WHERE dept=?' : '';
    const deptJoin = params.length ? 'WHERE d.dept=?' : '';
    const deviceCount = (await get(db, `SELECT COUNT(1) c FROM devices ${where}`, params))?.c || 0;
    const uploadedCount = (await get(db, `SELECT COUNT(DISTINCT v.device_sn) c FROM plc_versions v JOIN devices d ON d.device_sn=v.device_sn ${deptJoin}`, params))?.c || 0;
    const baselineCount = (await get(db, `SELECT COUNT(1) c FROM device_pointers p JOIN devices d ON d.device_sn=p.device_sn ${deptJoin ? `${deptJoin} AND p.baseline_version_id IS NOT NULL` : 'WHERE p.baseline_version_id IS NOT NULL'}`, params))?.c || 0;
    res.json({ deviceCount, uploadedCount, baselineCount, needBaseline: deviceCount - baselineCount });
  } catch (e) {
    res.status(500).json({ message: '查询失败', error: String(e) });
  } finally { db.close(); }
});

app.get('/api/audit', authRequired, async (req, res) => {
  const db = openDb();
  try {
    let rows = [];
    if (['admin', 'process_admin'].includes(req.user.role)) rows = await all(db, `SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 500`);
    else if (['dept_lead', 'supervisor', 'qa'].includes(req.user.role)) rows = await all(db, `SELECT * FROM audit_logs WHERE dept=? ORDER BY created_at DESC LIMIT 500`, [req.user.dept]);
    else {
      const sns = (await all(db, `SELECT device_sn FROM devices WHERE created_by=?`, [req.user.id])).map(r => r.device_sn);
      if (!sns.length) return res.json([]);
      const placeholders = sns.map(() => '?').join(',');
      rows = await all(db, `SELECT * FROM audit_logs WHERE device_id IN (${placeholders}) OR (action='登录' AND user_id=?) ORDER BY created_at DESC LIMIT 500`, [...sns, req.user.id]);
    }
    res.json(rows);
  } catch (e) {
    res.status(500).json({ message: '查询失败', error: String(e) });
  } finally { db.close(); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Demo 已启动：http://localhost:${PORT}`));
