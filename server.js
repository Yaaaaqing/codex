const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { openDb, run, get, all } = require('./db');

const app = express();
app.use(bodyParser.json({ limit: '2mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// Static frontend
app.use(express.static(path.join(__dirname, 'public')));

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB demo limit

// In-memory token sessions (demo only)
const sessions = new Map(); // token -> {id, name, dept, role}

function genToken() {
  return uuidv4().replace(/-/g, '');
}

function nowIso() {
  return new Date().toISOString();
}

function tsYYYYMMDDHHmm() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;
}

// label 需要做清洗，避免下划线/空格导致混乱
function sanitizeLabel(label) {
  return String(label || 'NONAME')
    .trim()
    .replace(/\s+/g, '-')      // 空格变-
    .replace(/_+/g, '-')       // 下划线变-
    .replace(/[^\w\u4e00-\u9fa5-]/g, ''); // 保留中英文数字-
}

function makeVersionNo({ deviceSn, userLabel, code }) {
  return `${deviceSn}_${sanitizeLabel(userLabel)}_${code}_${tsYYYYMMDDHHmm()}`;
}

async function audit(db, { action, userId, dept, deviceSn = null, plcVersionId = null, targetRef = null, detail = '' }) {
  await run(db, `
    INSERT INTO audit_logs (id, action, user_id, dept, device_sn, plc_version_id, target_ref, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [uuidv4(), action, userId, dept, deviceSn, plcVersionId, targetRef, detail, nowIso()]);
}

function authRequired(req, res, next) {
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ message: '未登录' });

  const token = m[1];
  const u = sessions.get(token);
  if (!u) return res.status(401).json({ message: '会话失效，请重新登录' });

  req.user = u;
  req.token = token;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ message: '仅管理员可操作' });
  next();
}

// Data permission: device visibility
function canAccessDevice(user, deviceRow) {
  if (user.role === 'admin') return true;
  if (user.role === 'dept_lead') return deviceRow.dept === user.dept;
  return deviceRow.created_by === user.id;
}

async function loadDevice(db, deviceSn) {
  return await get(db, `SELECT * FROM devices WHERE device_sn = ?`, [deviceSn]);
}

// ---------- Pages ----------
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ---------- Auth ----------
app.post('/api/auth/login', async (req, res) => {
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ message: '缺少工号' });

  const db = openDb();
  try {
    const u = await get(db, `SELECT id, name, dept, role, enabled FROM users WHERE id = ?`, [userId]);
    if (!u) return res.status(403).json({ message: '未授权：用户不存在（需管理员创建用户）' });
    if (u.enabled !== 1) return res.status(403).json({ message: '未授权：用户已停用' });

    const token = genToken();
    const sessionUser = { id: u.id, name: u.name, dept: u.dept, role: u.role };
    sessions.set(token, sessionUser);

    await audit(db, {
      action: '登录',
      userId: u.id,
      dept: u.dept,
      detail: `role=${u.role}`
    });

    res.json({ token, user: sessionUser });
  } catch (e) {
    res.status(500).json({ message: '登录失败', error: String(e) });
  } finally {
    db.close();
  }
});

app.post('/api/auth/logout', authRequired, async (req, res) => {
  const db = openDb();
  try {
    await audit(db, { action: '登出', userId: req.user.id, dept: req.user.dept, detail: '' });
  } catch {}
  sessions.delete(req.token);
  res.json({ ok: true });
  db.close();
});

app.get('/api/me', authRequired, (req, res) => res.json(req.user));

// ---------- Admin: users ----------
app.get('/api/admin/users', authRequired, requireAdmin, async (req, res) => {
  const db = openDb();
  try {
    const rows = await all(db, `SELECT id, name, dept, role, enabled FROM users ORDER BY id`);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ message: '查询失败', error: String(e) });
  } finally { db.close(); }
});

app.post('/api/admin/users', authRequired, requireAdmin, async (req, res) => {
  const { id, name, dept, role, enabled } = req.body || {};
  if (!id || !dept || !role) return res.status(400).json({ message: 'id/dept/role 必填' });

  const en = (enabled === 0 || enabled === '0') ? 0 : 1; // A: default enabled=1
  const db = openDb();
  try {
    await run(db, `
      INSERT INTO users (id, name, dept, role, enabled)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, dept=excluded.dept, role=excluded.role, enabled=excluded.enabled
    `, [id, name || id, dept, role, en]);

    await audit(db, {
      action: '用户管理-保存',
      userId: req.user.id,
      dept: req.user.dept,
      detail: `target=${id},dept=${dept},role=${role},enabled=${en}`
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: '保存失败', error: String(e) });
  } finally { db.close(); }
});

// ---------- Devices ----------
app.post('/api/devices', authRequired, upload.single('baselineFile'), async (req, res) => {
  const { deviceSn, name, userLabel } = req.body || {};
  if (!deviceSn) return res.status(400).json({ message: 'deviceSn 必填（出厂编号）' });
  if (!req.file) return res.status(400).json({ message: 'baselineFile 必传（Baseline 程序）' });
  if (!userLabel) return res.status(400).json({ message: 'userLabel 必填（用户定义名称）' });

  const db = openDb();
  try {
    // 1) 设备建档：DEBUGGING
    await run(db, `
      INSERT INTO devices (device_sn, name, dept, status, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [deviceSn, name || deviceSn, req.user.dept, 'DEBUGGING', req.user.id, nowIso()]);

    await run(db, `
      INSERT INTO device_pointers (device_sn, current_version_id, baseline_version_id, sealed_version_id, baseline_locked, updated_at)
      VALUES (?, NULL, NULL, NULL, 0, ?)
    `, [deviceSn, nowIso()]);

    // 2) baseline 版本：B + PENDING
    const plcVersionId = uuidv4();
    const versionNo = makeVersionNo({ deviceSn, userLabel, code: 'B' });
    const fileRef = req.file.path; // demo 用相对/绝对都行，建议用相对

    await run(db, `
      INSERT INTO plc_versions (
      plc_version_id, device_sn, version_no, user_label, version_type, version_seq, file_ref,
      approval_status, approved_by, approved_at, created_by, created_at
      ) VALUES (?, ?, ?, ?, 'S', ?, ?, 'APPROVED', ?, ?, ?, ?)
       `, [plcVersionId, deviceSn, versionNo, userLabel, nextSeq, req.file.path, req.user.id, nowIso(), req.user.id, nowIso()]);

    await audit(db, {
      action: 'PLC_BASELINE_SUBMIT',
      userId: req.user.id,
      dept: req.user.dept,
      deviceSn: deviceSn,              // 你后面会改 audit 参数名，这里先复用
      plcVersionId,
      detail: `versionNo=${versionNo}`,
      targetRef: `Device:${deviceSn}`
    });

    res.json({ deviceSn, baselinePlcVersionId: plcVersionId });
  } catch (e) {
    res.status(500).json({ message: '创建失败', error: String(e) });
  } finally { db.close(); }
});

app.post('/api/devices/:deviceSn/baseline/:plcVersionId/approve', authRequired, async (req, res) => {
  if (!['admin', 'dept_lead'].includes(req.user.role)) return res.status(403).json({ message: '仅负责人/管理员可审批' });

  const { deviceSn, plcVersionId } = req.params;
  const db = openDb();
  try {
    const device = await loadDevice(db, deviceSn);
    if (!device) return res.status(404).json({ message: '设备不存在' });
    if (!canAccessDevice(req.user, device)) return res.status(403).json({ message: '无权限' });

    const ptr = await get(db, `SELECT * FROM device_pointers WHERE device_sn=?`, [deviceSn]);
    if (ptr?.baseline_locked === 1) return res.status(400).json({ message: 'Baseline 已审批通过并锁定，不能再更改' });

    const v = await get(db, `SELECT * FROM plc_versions WHERE plc_version_id=? AND device_sn=?`, [plcVersionId, deviceSn]);
    if (!v) return res.status(404).json({ message: 'Baseline 版本不存在' });
    if (v.version_type !== 'B') return res.status(400).json({ message: '该版本不是 Baseline 候选' });
    if (v.approval_status !== 'PENDING') return res.status(400).json({ message: '该Baseline不是待审批状态' });

    await run(db, `
      UPDATE plc_versions
      SET approval_status='APPROVED', approved_by=?, approved_at=?
      WHERE plc_version_id=?
    `, [req.user.id, nowIso(), plcVersionId]);

    await run(db, `
      UPDATE device_pointers
      SET baseline_version_id=?, baseline_locked=1, updated_at=?
      WHERE device_sn=?
    `, [plcVersionId, nowIso(), deviceSn]);

    await audit(db, {
      action: 'PLC_BASELINE_APPROVE',
      userId: req.user.id,
      dept: req.user.dept,
      deviceSn,
      plcVersionId,
      targetRef: `PlcVersion:${plcVersionId}`,
      detail: ''
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: '审批失败', error: String(e) });
  } finally { db.close(); }
});

app.post('/api/devices/:deviceSn/baseline/:plcVersionId/reject', authRequired, async (req, res) => {
  if (!['admin','dept_lead'].includes(req.user.role)) return res.status(403).json({ message: '仅负责人/管理员可审批' });

  const { deviceSn, plcVersionId } = req.params;
  const { reason } = req.body || {};
  const db = openDb();
  try {
    const device = await loadDevice(db, deviceSn);
    if (!device) return res.status(404).json({ message: '设备不存在' });
    if (!canAccessDevice(req.user, device)) return res.status(403).json({ message: '无权限' });

    const ptr = await get(db, `SELECT * FROM device_pointers WHERE device_sn=?`, [deviceSn]);
    if (ptr?.baseline_locked === 1) return res.status(400).json({ message: 'Baseline 已锁定，不能驳回' });

    await run(db, `
      UPDATE plc_versions
      SET approval_status='REJECTED', approved_by=?, approved_at=?
      WHERE plc_version_id=? AND device_sn=?
    `, [req.user.id, nowIso(), plcVersionId, deviceSn]);

    await audit(db, {
      action: 'PLC_BASELINE_REJECT',
      userId: req.user.id,
      dept: req.user.dept,
      deviceSn,
      plcVersionId,
      targetRef: `PlcVersion:${plcVersionId}`,
      detail: `reason=${reason || ''}`
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: '驳回失败', error: String(e) });
  } finally { db.close(); }
});

app.get('/api/devices', authRequired, async (req, res) => {
  const db = openDb();
  try {
    let rows = [];
    if (req.user.role === 'admin') {
      rows = await all(db, `SELECT * FROM devices ORDER BY created_at DESC`);
    } else if (req.user.role === 'dept_lead') {
      rows = await all(db, `SELECT * FROM devices WHERE dept = ? ORDER BY created_at DESC`, [req.user.dept]);
    } else {
      rows = await all(db, `SELECT * FROM devices WHERE created_by = ? ORDER BY created_at DESC`, [req.user.id]);
    }
    res.json(rows);
  } catch (e) {
    res.status(500).json({ message: '查询设备失败', error: String(e) });
  } finally { db.close(); }
});

app.get('/api/devices/:deviceSn', authRequired, async (req, res) => {
  const { deviceSn } = req.params;
  const db = openDb();
  try {
    const device = await loadDevice(db, deviceSn);
    if (!device) return res.status(404).json({ message: '设备不存在' });
    if (!canAccessDevice(req.user, device)) return res.status(403).json({ message: '无权限访问该设备' });

    const pointers = await get(db, `SELECT * FROM device_pointers WHERE device_sn = ?`, [deviceSn]) || {};

    const baseline = pointers.baseline_version_id
      ? await get(db, `SELECT plc_version_id, version_no, approval_status, approved_by, approved_at, created_at FROM plc_versions WHERE plc_version_id=?`, [pointers.baseline_version_id])
      : null;

    const current = pointers.current_version_id
      ? await get(db, `SELECT plc_version_id, version_no, created_at FROM plc_versions WHERE plc_version_id=?`, [pointers.current_version_id])
      : null;

    const sealed = pointers.sealed_version_id
      ? await get(db, `SELECT plc_version_id, version_no, version_seq, approved_by, approved_at, created_at FROM plc_versions WHERE plc_version_id=?`, [pointers.sealed_version_id])
      : null;

    // Baseline候选（方便负责人审批）
    const baselineCandidates = await all(db, `
      SELECT plc_version_id, version_no, approval_status, created_by, created_at
      FROM plc_versions
      WHERE device_sn=? AND version_type='B'
      ORDER BY created_at DESC
      LIMIT 20
    `, [deviceSn]);

    res.json({ device, pointers, baseline, current, sealed, baselineCandidates });
  } catch (e) {
    res.status(500).json({ message: '查询失败', error: String(e) });
  } finally { db.close(); }
});

// ---------- Records (change/inspection as text) ----------
app.post('/api/versions/:vid/records', authRequired, async (req, res) => {
  const { description, recordType } = req.body || {};
  if (!description) return res.status(400).json({ message: 'description 必填' });

  const db = openDb();
  try {
    const v = await get(db, `SELECT * FROM plc_versions WHERE id = ?`, [req.params.vid]);
    if (!v) return res.status(404).json({ message: '版本不存在' });

    const device = await loadDevice(db, v.device_id);
    if (!device) return res.status(404).json({ message: '设备不存在' });
    if (!canAccessDevice(req.user, device)) return res.status(403).json({ message: '无权限操作该版本' });

    const id = uuidv4();
    await run(db, `
      INSERT INTO change_records (id, plc_version_id, description, created_at)
      VALUES (?, ?, ?, ?)
    `, [id, req.params.vid, `[${recordType || '记录'}] ${description}`, nowIso()]);

    await audit(db, { action: '新增记录', userId: req.user.id, dept: req.user.dept, deviceId: device.id, plcVersionId: req.params.vid, detail: `type=${recordType || '记录'}` });

    res.json({ ok: true, id });
  } catch (e) {
    res.status(500).json({ message: '保存失败', error: String(e) });
  } finally { db.close(); }
});

app.post('/api/devices/:deviceSn/changeRecords', authRequired, async (req, res) => {
  const { deviceSn } = req.params;
  const { changeReason, changeSummary, impactInspection } = req.body || {};
  if (!changeReason || !changeSummary) return res.status(400).json({ message: 'changeReason/changeSummary 必填' });

  const db = openDb();
  try {
    const device = await loadDevice(db, deviceSn);
    if (!device) return res.status(404).json({ message: '设备不存在' });
    if (!canAccessDevice(req.user, device)) return res.status(403).json({ message: '无权限' });

    const changeId = uuidv4();
    await run(db, `
      INSERT INTO change_records (
        change_id, device_sn, plc_version_id, change_date, changer_user_id,
        change_reason, change_summary, impact_inspection, created_at
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)
    `, [
      changeId, deviceSn, nowIso(), req.user.id,
      changeReason, changeSummary, (impactInspection ? 1 : 0), nowIso()
    ]);

    await audit(db, { action: 'CHANGE_RECORD_CREATE', userId: req.user.id, dept: req.user.dept, deviceId: deviceSn, plcVersionId: null, detail: `impactInspection=${impactInspection ? 1 : 0}`, targetRef: `Change:${changeId}` });
    res.json({ ok: true, changeId });
  } catch (e) {
    res.status(500).json({ message: '保存失败', error: String(e) });
  } finally { db.close(); }
});

app.get('/api/devices/:deviceSn/changeRecords', authRequired, async (req, res) => {
  const { deviceSn } = req.params;
  const db = openDb();
  try {
    const device = await loadDevice(db, deviceSn);
    if (!device) return res.status(404).json({ message: '设备不存在' });
    if (!canAccessDevice(req.user, device)) return res.status(403).json({ message: '无权限' });

    const rows = await all(db, `SELECT * FROM change_records WHERE device_sn=? ORDER BY created_at DESC`, [deviceSn]);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ message: '查询失败', error: String(e) });
  } finally { db.close(); }
});

app.get('/api/versions/:vid/records', authRequired, async (req, res) => {
  const db = openDb();
  try {
    const v = await get(db, `SELECT * FROM plc_versions WHERE id = ?`, [req.params.vid]);
    if (!v) return res.status(404).json({ message: '版本不存在' });

    const device = await loadDevice(db, v.device_id);
    if (!device) return res.status(404).json({ message: '设备不存在' });
    if (!canAccessDevice(req.user, device)) return res.status(403).json({ message: '无权限访问' });

    const rows = await all(db, `SELECT * FROM change_records WHERE plc_version_id = ? ORDER BY created_at DESC`, [req.params.vid]);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ message: '查询失败', error: String(e) });
  } finally { db.close(); }
});

// ---------- Timeline (device) ----------
app.get('/api/devices/:deviceId/timeline', authRequired, async (req, res) => {
  const db = openDb();
  try {
    const device = await loadDevice(db, req.params.deviceId);
    if (!device) return res.status(404).json({ message: '设备不存在' });
    if (!canAccessDevice(req.user, device)) return res.status(403).json({ message: '无权限访问' });

    // Build timeline from audit + change_records
    const a = await all(db, `
      SELECT created_at, action, user_id, detail, plc_version_id
      FROM audit_logs
      WHERE device_id = ?
      ORDER BY created_at DESC
      LIMIT 200
    `, [device.id]);

    // Optional: include record rows mapped by version (already in audit as '新增记录')
    res.json(a);
  } catch (e) {
    res.status(500).json({ message: '查询失败', error: String(e) });
  } finally { db.close(); }
});

//--------版本列表--------
app.get('/api/devices/:deviceSn/plcVersions', authRequired, async (req, res) => {
  const { deviceSn } = req.params;
  const db = openDb();
  try {
    const device = await loadDevice(db, deviceSn);
    if (!device) return res.status(404).json({ message: '设备不存在' });
    if (!canAccessDevice(req.user, device)) return res.status(403).json({ message: '无权限' });

    const rows = await all(db, `
      SELECT plc_version_id, version_no, user_label, version_type, version_seq,
             approval_status, approved_by, approved_at, created_by, created_at
      FROM plc_versions
      WHERE device_sn=?
      ORDER BY created_at DESC
    `, [deviceSn]);

    res.json(rows);
  } catch (e) {
    res.status(500).json({ message: '查询失败', error: String(e) });
  } finally { db.close(); }
});

//-----------download--------
app.get('/api/devices/:deviceSn/plcVersions', authRequired, async (req, res) => {
  const { deviceSn } = req.params;
  const db = openDb();
  try {
    const device = await loadDevice(db, deviceSn);
    if (!device) return res.status(404).json({ message: '设备不存在' });
    if (!canAccessDevice(req.user, device)) return res.status(403).json({ message: '无权限' });

    const rows = await all(db, `
      SELECT plc_version_id, version_no, user_label, version_type, version_seq,
             approval_status, approved_by, approved_at, created_by, created_at
      FROM plc_versions
      WHERE device_sn=?
      ORDER BY created_at DESC
    `, [deviceSn]);

    res.json(rows);
  } catch (e) {
    res.status(500).json({ message: '查询失败', error: String(e) });
  } finally { db.close(); }
});

// ---------- KPIs ----------
// app.get('/api/kpi/employee', authRequired, async (req, res) => {
//   const db = openDb();
//   try {
//     // For user role only meaningful; for others still computed by their scope
//     let deviceIds = [];
//     if (req.user.role === 'admin') {
//       deviceIds = (await all(db, `SELECT id FROM devices`, [])).map(r => r.id);
//     } else if (req.user.role === 'dept_lead') {
//       deviceIds = (await all(db, `SELECT id FROM devices WHERE dept = ?`, [req.user.dept])).map(r => r.id);
//     } else {
//       deviceIds = (await all(db, `SELECT id FROM devices WHERE created_by = ?`, [req.user.id])).map(r => r.id);
//     }

//     const deviceCount = deviceIds.length;
//     if (deviceIds.length === 0) return res.json({ deviceCount, versionCount: 0, needBaselineCount: 0 });

//     const placeholders = deviceIds.map(() => '?').join(',');
//     const versionCountRow = await get(db, `SELECT COUNT(1) AS c FROM plc_versions WHERE device_id IN (${placeholders})`, deviceIds);
//     const needBaselineRow = await get(db, `
//       SELECT COUNT(1) AS c
//       FROM device_pointers p
//       JOIN devices d ON d.id = p.device_id
//       WHERE d.id IN (${placeholders}) AND p.baseline_version_id IS NULL
//     `, deviceIds);

//     res.json({
//       deviceCount,
//       versionCount: versionCountRow?.c || 0,
//       needBaselineCount: needBaselineRow?.c || 0
//     });
//   } catch (e) {
//     res.status(500).json({ message: '查询失败', error: String(e) });
//   } finally { db.close(); }
// });

// app.get('/api/kpi/dept', authRequired, async (req, res) => {
//   const db = openDb();
//   try {
//     // For dept_lead/admin: scope = dept or all
//     const scopeDept = req.user.role === 'admin' ? null : req.user.dept;
//     const where = scopeDept ? 'WHERE dept = ?' : '';
//     const params = scopeDept ? [scopeDept] : [];

//     const deviceCount = (await get(db, `SELECT COUNT(1) AS c FROM devices ${where}`, params))?.c || 0;
//     const baselineCount = (await get(db, `
//       SELECT COUNT(1) AS c
//       FROM device_pointers p
//       JOIN devices d ON d.id = p.device_id
//       ${scopeDept ? 'WHERE d.dept = ?' : ''}
//       AND p.baseline_version_id IS NOT NULL
//     `, params))?.c || 0;

//     const uploadedCount = (await get(db, `
//       SELECT COUNT(DISTINCT d.id) AS c
//       FROM devices d
//       JOIN plc_versions v ON v.device_id = d.id
//       ${scopeDept ? 'WHERE d.dept = ?' : ''}
//     `, params))?.c || 0;

//     const needBaseline = deviceCount - baselineCount;
//     res.json({ deviceCount, uploadedCount, baselineCount, needBaseline });
//   } catch (e) {
//     res.status(500).json({ message: '查询失败', error: String(e) });
//   } finally { db.close(); }
// });

// ---------- Audit ----------
// app.get('/api/audit', authRequired, async (req, res) => {
//   const db = openDb();
//   try {
//     let rows = [];
//     if (req.user.role === 'admin') {
//       rows = await all(db, `SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 500`);
//     } else if (req.user.role === 'dept_lead') {
//       rows = await all(db, `SELECT * FROM audit_logs WHERE dept = ? ORDER BY created_at DESC LIMIT 500`, [req.user.dept]);
//     } else {
//       // user: only devices created by me
//       const myDeviceIds = (await all(db, `SELECT id FROM devices WHERE created_by = ?`, [req.user.id])).map(r => r.id);
//       if (myDeviceIds.length === 0) return res.json([]);
//       const placeholders = myDeviceIds.map(() => '?').join(',');
//       rows = await all(db, `
//         SELECT * FROM audit_logs
//         WHERE device_id IN (${placeholders}) OR (action='登录' AND user_id=?)
//         ORDER BY created_at DESC
//         LIMIT 500
//       `, [...myDeviceIds, req.user.id]);
//     }
//     res.json(rows);
//   } catch (e) {
//     res.status(500).json({ message: '查询失败', error: String(e) });
//   } finally { db.close(); }
// });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Demo 已启动：http://localhost:${PORT}`));