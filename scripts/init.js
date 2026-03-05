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
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

  const db = openDb();
  try {
    await run(db, `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT,
        dept TEXT,
        role TEXT,
        enabled INTEGER
      )
    `);

    // Machine(沿用 devices 表名)
    await run(db, `
      CREATE TABLE IF NOT EXISTS devices (
        device_sn TEXT PRIMARY KEY,
        name TEXT,
        model TEXT,
        series TEXT,
        product_line TEXT,
        production_unit TEXT,
        customer_name TEXT,
        dept TEXT,
        status TEXT,
        created_by TEXT,
        created_at TEXT
      )
    `);

    await run(db, `
      CREATE TABLE IF NOT EXISTS device_pointers (
        device_sn TEXT PRIMARY KEY,
        current_version_id TEXT,
        baseline_version_id TEXT,
        sealed_version_id TEXT,
        baseline_locked INTEGER,
        updated_at TEXT
      )
    `);

    await run(db, `
      CREATE TABLE IF NOT EXISTS plc_versions (
        plc_version_id TEXT PRIMARY KEY,
        device_sn TEXT,
        version_no TEXT,
        user_label TEXT,
        version_type TEXT,         -- B/P/F/A
        version_seq INTEGER,
        source_type TEXT,          -- upload/manual/merge/after_sale
        change_span TEXT,
        file_ref TEXT,
        file_hash TEXT,
        approval_status TEXT,
        approved_by TEXT,
        approved_at TEXT,
        created_by TEXT,
        created_at TEXT
      )
    `);

    await run(db, `
      CREATE TABLE IF NOT EXISTS debug_archives (
        archive_id TEXT PRIMARY KEY,
        device_sn TEXT,
        owner_user_id TEXT,
        plc_draft_version_id TEXT,
        approval_status TEXT,      -- DRAFT/SUBMITTED/APPROVED/REJECTED
        approver_user_id TEXT,
        approve_comment TEXT,
        approved_at TEXT,
        created_at TEXT,
        updated_at TEXT
      )
    `);

    await run(db, `
      CREATE TABLE IF NOT EXISTS change_records (
        change_id TEXT PRIMARY KEY,
        device_sn TEXT,
        plc_version_id TEXT,
        function_domain TEXT,
        change_date TEXT,
        changer_user_id TEXT,
        change_reason TEXT,
        change_summary TEXT,
        impact_inspection INTEGER,
        is_backfilled INTEGER,
        created_at TEXT
      )
    `);

    await run(db, `
      CREATE TABLE IF NOT EXISTS checklist_templates (
        template_id TEXT PRIMARY KEY,
        name TEXT,
        owner_user_id TEXT,
        review_status TEXT,
        created_at TEXT
      )
    `);

    await run(db, `
      CREATE TABLE IF NOT EXISTS checklist_template_items (
        item_id TEXT PRIMARY KEY,
        template_id TEXT,
        item_code TEXT,
        item_name TEXT,
        is_required INTEGER,
        created_at TEXT
      )
    `);

    await run(db, `
      CREATE TABLE IF NOT EXISTS checklist_frozen_versions (
        frozen_version_id TEXT PRIMARY KEY,
        template_id TEXT,
        version_no TEXT,
        status TEXT,
        created_by TEXT,
        created_at TEXT
      )
    `);

    await run(db, `
      CREATE TABLE IF NOT EXISTS checklist_frozen_items (
        frozen_item_id TEXT PRIMARY KEY,
        frozen_version_id TEXT,
        item_code TEXT,
        item_name TEXT,
        is_required INTEGER,
        created_at TEXT
      )
    `);

    await run(db, `
      CREATE TABLE IF NOT EXISTS inspection_tasks (
        task_id TEXT PRIMARY KEY,
        device_sn TEXT,
        frozen_version_id TEXT,
        item_code TEXT,
        item_name TEXT,
        is_required INTEGER,
        result TEXT,               -- PENDING/PASS/FAIL
        remark TEXT,
        evidence_ref TEXT,
        qa_user_id TEXT,
        qa_signed_at TEXT,
        created_at TEXT
      )
    `);

    await run(db, `
      CREATE TABLE IF NOT EXISTS inspection_reports (
        report_id TEXT PRIMARY KEY,
        device_sn TEXT,
        frozen_version_id TEXT,
        report_ref TEXT,
        created_by TEXT,
        created_at TEXT
      )
    `);

    await run(db, `
      CREATE TABLE IF NOT EXISTS after_sale_changes (
        as_change_id TEXT PRIMARY KEY,
        device_sn TEXT,
        reason TEXT,
        impact_scope TEXT,
        authorized_by TEXT,
        status TEXT,
        created_by TEXT,
        created_at TEXT
      )
    `);

    await run(db, `
      CREATE TABLE IF NOT EXISTS regression_verifies (
        verify_id TEXT PRIMARY KEY,
        as_change_id TEXT,
        result TEXT,
        evidence_ref TEXT,
        verified_by TEXT,
        created_at TEXT
      )
    `);

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

    const users = [
      { id: 'admin', name: '管理员', dept: 'HQ', role: 'admin', enabled: 1 },
      { id: 'lead01', name: '部门负责人', dept: 'MT', role: 'dept_lead', enabled: 1 },
      { id: 'test001', name: '测试员工', dept: 'MT', role: 'user', enabled: 1 },
      { id: 'dbg01', name: '调试工程师', dept: 'MT', role: 'debugger', enabled: 1 },
      { id: 'sup01', name: '电气主管', dept: 'MT', role: 'supervisor', enabled: 1 },
      { id: 'qa01', name: '质检员', dept: 'MT', role: 'qa', enabled: 1 },
      { id: 'gov01', name: '流控管理员', dept: 'HQ', role: 'process_admin', enabled: 1 },
    ];
    for (const u of users) {
      await run(db, `INSERT INTO users (id, name, dept, role, enabled) VALUES (?, ?, ?, ?, ?)`, [u.id, u.name, u.dept, u.role, u.enabled]);
    }

    const deviceSn = 'SN-DEMO-001';
    await run(db, `
      INSERT INTO devices (device_sn, name, model, series, product_line, production_unit, customer_name, dept, status, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [deviceSn, '演示机床-001', 'M-800', 'S-A', 'PL-MT', 'MT-Plant-1', 'DemoCustomer', 'MT', 'DEBUGGING', 'dbg01', nowIso()]);

    await run(db, `
      INSERT INTO device_pointers (device_sn, current_version_id, baseline_version_id, sealed_version_id, baseline_locked, updated_at)
      VALUES (?, NULL, NULL, NULL, 0, ?)
    `, [deviceSn, nowIso()]);

    const uploadDir = path.join(__dirname, '..', 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
    const dummyPath = path.join(uploadDir, `seed-${Date.now()}-baseline.plc`);
    fs.writeFileSync(dummyPath, 'DEMO PLC BASELINE CONTENT\n');

    const baselineId = uuidv4();
    const baselineLabel = '初始基线';
    const baselineNo = makeVersionNo({ deviceSn, userLabel: baselineLabel, code: 'B' });
    await run(db, `
      INSERT INTO plc_versions (
        plc_version_id, device_sn, version_no, user_label, version_type, version_seq,
        source_type, change_span, file_ref, file_hash,
        approval_status, approved_by, approved_at, created_by, created_at
      ) VALUES (?, ?, ?, ?, 'B', 0, 'upload', NULL, ?, NULL, 'PENDING', NULL, NULL, ?, ?)
    `, [baselineId, deviceSn, baselineNo, baselineLabel, dummyPath, 'dbg01', nowIso()]);

    const archiveId = uuidv4();
    await run(db, `
      INSERT INTO debug_archives (
        archive_id, device_sn, owner_user_id, plc_draft_version_id, approval_status,
        approver_user_id, approve_comment, approved_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'APPROVED', ?, 'seed', ?, ?, ?)
    `, [archiveId, deviceSn, 'dbg01', baselineId, 'sup01', nowIso(), nowIso(), nowIso()]);

    const audits = [
      { action: '登录', user: 'admin', dept: 'HQ', deviceId: null, ver: null, detail: 'role=admin' },
      { action: 'DEBUG_ARCHIVE_APPROVED', user: 'sup01', dept: 'MT', deviceId: deviceSn, ver: baselineId, detail: `archive=${archiveId}` },
      { action: 'PLC_BASELINE_SUBMIT', user: 'dbg01', dept: 'MT', deviceId: deviceSn, ver: baselineId, detail: `versionNo=${baselineNo}` },
    ];
    for (const a of audits) {
      await run(db, `
        INSERT INTO audit_logs (id, action, user_id, dept, device_id, plc_version_id, detail, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [uuidv4(), a.action, a.user, a.dept, a.deviceId, a.ver, a.detail, nowIso()]);
    }

    console.log('✅ 初始化完成：已创建数据库与演示数据');
    console.log('演示账号：admin/lead01/test001/dbg01/sup01/qa01/gov01');
    console.log(`演示设备：${deviceSn}（已审批调试档案）`);
  } catch (e) {
    console.error('初始化失败：', e);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();
