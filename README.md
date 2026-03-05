# PLC程序版本与功能检验平台（一期）本地端到端 Demo

这是一个**可演示、可验收**的一期闭环本地 Demo，满足：
- 平台结构：登录 → 不同角色进入不同工作台
- 后端强制数据权限：user/部门负责人/admin
- PLC文件上传（本地 ./uploads 模拟对象存储）
- 版本记录、当前/基线指针、变更/检验记录（文本）、审计日志
- UI：Ant Design（卡片+表格+标签+时间线）

## 一键运行

### 1) 安装依赖
```bash
npm install
```

### 2) 初始化数据（建库 + 演示账号 + 演示设备/版本/审计）
```bash
npm run init
```

### 3) 启动
```bash
npm run dev
```

打开：
- http://localhost:3000

## 演示账号（必须提供）
- admin：`admin`（HQ / admin / enabled=1）
- dept_lead：`lead01`（MT / dept_lead / enabled=1）
- user：`test001`（MT / user / enabled=1）

> 登录方式：登录页输入工号（模拟SSO），后端读取 users 表决定 role/dept/enabled。

## 验收点（按你的清单）
- test001 登录后：看不到 lead01/admin 的设备（接口也拿不到）
- lead01：看得到 MT 部门所有设备；看不到 HQ/其他部门
- admin：全量可见
- 上传生成版本记录（display_no 含时间戳）
- 可设当前/基线并明显展示
- 时间线能看到“上传/切换/记录”等事件
- 审计页按范围正确过滤
- UI 有卡片+表格+标签+时间线

## 结构说明（简要）
- 后端：Node.js + Express + SQLite
- 前端：单页应用（React/Ant Design 通过 CDN），由 Express 静态托管
- 鉴权：登录后返回 token（内存会话），前端以 `Authorization: Bearer <token>` 调用 API
- 数据权限：后端按 role 强制过滤（不可仅靠前端隐藏）

## 3分钟演示脚本（建议）
1. 用 test001 登录 → 员工工作台：KPI + 我的设备列表（仅我创建）
2. 进入设备详情 → 上传一个文件 → 自动生成版本 + 时间线出现“上传”
3. 设为基线/当前 → 时间线出现“设基线/设当前”，指针卡片变化
4. 新增检验/变更记录 → 时间线出现记录
5. 切换到 lead01 → 看部门看板（MT全部设备状态）
6. 切换到 admin → 用户管理（改 enabled/role）+ 全量审计