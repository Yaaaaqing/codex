// scripts/init.js
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { openDb, run, DB_PATH } = require('../db');

function nowIso() { return new Date().toISOString(); }

function tsYYYYMMDDHHmm() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function sanitizeLabel(label) {
  return String(label || 'NONAME')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/_+/g, '-')
    .replace(/[^\w\u4e00-\u9fa5-]/g, '');
}

function makeVersionNo({ deviceSn, userLabel, code }) {
  return `${deviceSn}_${sanitizeLabel(userLabel)}_${code}_${tsYYYYMMDDHHmm()}`;
}

async function main() {
  // delete db for clean init
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

  const db = openDb();
  try {
    // users
    await run(db, `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT,
        dept TEXT,
        role TEXT,
        enabled INTEGER
      )
    `);

    // devices (PK = device_sn)
    await run(db, `
      CREATE TABLE IF NOT EXISTS devices (
        device_sn TEXT PRIMARY KEY,
        name TEXT,
        dept TEXT,
        status TEXT,      -- DEBUGGING / INSPECTED / DELIVERABLE
        created_by TEXT,
        created_at TEXT
      )
    `);

    // pointers (PK = device_sn)
    await run(db, `
      CREATE TABLE IF NOT EXISTS device_pointers (
        device_sn TEXT PRIMARY KEY,
        current_version_id TEXT,
        baseline_version_id TEXT,
        sealed_version_id TEXT,
        baseline_locked INTEGER,   -- 0/1
        updated_at TEXT
      )
    `);

    // plc_versions
    await run(db, `
      CREATE TABLE IF NOT EXISTS plc_versions (
        plc_version_id TEXT PRIMARY KEY,
        device_sn TEXT,
        version_no TEXT,           -- deviceSn_userLabel_B/C/S/S1_YYYYMMDDHHmm
        user_label TEXT,
        version_type TEXT,         -- B / C / S
        version_seq INTEGER,       -- S0=0, S1=1...; B/C=0
        file_ref TEXT,             -- demo=uploads路径
        approval_status TEXT,      -- PENDING/APPROVED/REJECTED/NA
        approved_by TEXT,
        approved_at TEXT,
        created_by TEXT,
        created_at TEXT
      )
    `);

    // change_records (structured)
    await run(db, `
      CREATE TABLE IF NOT EXISTS change_records (
        change_id TEXT PRIMARY KEY,
        device_sn TEXT,
        plc_version_id TEXT,
        change_date TEXT,
        changer_user_id TEXT,
        change_reason TEXT,
        change_summary TEXT,
        impact_inspection INTEGER, -- 0/1
        created_at TEXT
      )
    `);

    /**
     * ✅ 关键修复点：
     * 你的 server.js 里 audit() 插入的是 audit_logs(device_id, plc_version_id, ...)
     * 所以这里必须建 device_id 字段（不能叫 device_sn），否则会报 “no column named device_id”
     */
    await run(db, `
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        action TEXT,
        user_id TEXT,
        dept TEXT,
        device_id TEXT,
        plc_version_id TEXT,
        detail TEXT,
        created_at TEXT
      )
    `);

    // Seed users
    const users = [
      { id: 'admin', name: '管理员', dept: 'HQ', role: 'admin', enabled: 1 },
      { id: 'lead01', name: '部门负责人', dept: 'MT', role: 'dept_lead', enabled: 1 },
      { id: 'test001', name: '测试员工', dept: 'MT', role: 'user', enabled: 1 },
    ];
    for (const u of users) {
      await run(
        db,
        `INSERT INTO users (id, name, dept, role, enabled) VALUES (?, ?, ?, ?, ?)`,
        [u.id, u.name, u.dept, u.role, u.enabled]
      );
    }

    // Seed one demo device (created by test001)
    const deviceSn = 'SN-DEMO-001';
    await run(db, `
      INSERT INTO devices (device_sn, name, dept, status, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [deviceSn, '演示机床-001', 'MT', 'DEBUGGING', 'test001', nowIso()]);

    await run(db, `
      INSERT INTO device_pointers (device_sn, current_version_id, baseline_version_id, sealed_version_id, baseline_locked, updated_at)
      VALUES (?, NULL, NULL, NULL, 0, ?)
    `, [deviceSn, nowIso()]);

    // Create a dummy file in uploads
    const uploadDir = path.join(__dirname, '..', 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
    const dummyPath = path.join(uploadDir, `seed-${Date.now()}-baseline.plc`);
    fs.writeFileSync(dummyPath, 'DEMO PLC BASELINE CONTENT\n');

    // Seed a baseline candidate (PENDING)
    const baselineId = uuidv4();
    const baselineLabel = '初始基线';
    const baselineNo = makeVersionNo({ deviceSn, userLabel: baselineLabel, code: 'B' });

    await run(db, `
      INSERT INTO plc_versions (
        plc_version_id, device_sn, version_no, user_label, version_type, version_seq,
        file_ref, approval_status, approved_by, approved_at, created_by, created_at
      ) VALUES (?, ?, ?, ?, 'B', 0, ?, 'PENDING', NULL, NULL, ?, ?)
    `, [baselineId, deviceSn, baselineNo, baselineLabel, dummyPath, 'test001', nowIso()]);

    // Seed one change record during debugging
    const changeId = uuidv4();
    await run(db, `
      INSERT INTO change_records (
        change_id, device_sn, plc_version_id, change_date, changer_user_id,
        change_reason, change_summary, impact_inspection, created_at
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)
    `, [changeId, deviceSn, nowIso(), 'test001', '调试优化', '调整I/O映射与报警阈值', 1, nowIso()]);

    // Seed audit logs（注意：这里写 device_id，用 deviceSn 填进去即可）
    const audits = [
      { action: '登录', user: 'admin', dept: 'HQ', deviceId: null, ver: null, detail: 'role=admin' },
      { action: '登录', user: 'lead01', dept: 'MT', deviceId: null, ver: null, detail: 'role=dept_lead' },
      { action: '登录', user: 'test001', dept: 'MT', deviceId: null, ver: null, detail: 'role=user' },
      { action: '创建设备', user: 'test001', dept: 'MT', deviceId: deviceSn, ver: null, detail: 'name=演示机床-001' },
      { action: 'PLC_BASELINE_SUBMIT', user: 'test001', dept: 'MT', deviceId: deviceSn, ver: baselineId, detail: `versionNo=${baselineNo}` },
      { action: 'CHANGE_RECORD_CREATE', user: 'test001', dept: 'MT', deviceId: deviceSn, ver: null, detail: 'impactInspection=1' },
    ];

    for (const a of audits) {
      await run(db, `
        INSERT INTO audit_logs (id, action, user_id, dept, device_id, plc_version_id, detail, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [uuidv4(), a.action, a.user, a.dept, a.deviceId, a.ver, a.detail, nowIso()]);
    }

    console.log('✅ 初始化完成：已创建数据库与演示数据');
    console.log('演示账号：admin / lead01 / test001');
    console.log(`演示设备：${deviceSn}（DEBUGGING，已提交Baseline待审批）`);
  } catch (e) {
    console.error('初始化失败：', e);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();