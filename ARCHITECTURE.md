# 方案简述（1页）

## 架构（本地 Demo）
浏览器（React + Ant Design via CDN）
  ↓  HTTP/JSON
Node.js + Express（单进程）
  ↓
SQLite（database.db）
  ↓
本地目录 uploads/（模拟对象存储）

## 鉴权/登录（模拟SSO）
- 登录页输入工号 userId
- 后端读取 users 表（id/name/dept/role/enabled）
- enabled=1 才允许登录，返回 token（内存会话）
- 前端后续请求带 Authorization: Bearer <token>

## 权限模型（后端强制）
角色：
- admin：全量设备/全量审计/用户管理
- dept_lead：本部门设备与审计
- user：仅本人创建的设备与相关记录

规则：
- 设备部门 = 创建设备人部门
- 员工不可看同部门其他设备

实现：
- devices 表：dept, created_by
- 所有 deviceId 相关 API 均先加载设备并调用 canAccessDevice(user, device)
- audit_logs 表带 dept/device_id，避免 LIKE，提高可控性