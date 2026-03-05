# 机床电气调试与程序版本全流程管理平台（JavaScript 可视化原型）

该版本已对齐“首次上电建档 → 调试留痕 → 冻结清单检验 → 最终封存 → 交付状态管控 → 售后扩展”的主线。

## 已实现能力

- 登录界面（仅登录）+ 会话鉴权
- **不提供注册功能**：注册需走工单申请，由管理员统一创建账号
- 三角色界面差异（`debugger` / `owner` / `admin`）
- 角色权限强约束（后端校验，不仅是前端按钮）
- 基线审批门槛（未审批不能提交检验）
- 冻结清单模板自动生成检验任务（按产线匹配）
- `inspected` 放行门槛：
  - 必选检验项通过
  - 最终版本封存
  - 资料齐全
  - 检验报告归档
  - 技术文件审批完成
- 状态机：`debugging -> pending_inspection -> inspected -> delivered -> frozen`

## 目录

- `web/workflow.js`：核心业务规则 + 状态机 + 权限
- `web/server.js`：Node.js HTTP API + 登录鉴权 + 静态页面
- `web/public/index.html`：登录页 + 业务页
- `web/public/main.js`：前端交互逻辑
- `web/tests/workflow.test.js`：业务规则自动化测试

## 运行方式

```bash
cd web
npm start
```

浏览器访问：`http://localhost:3000`

## 登录说明

- 演示账号：
  - `alice / alice123`（debugger）
  - `bob / bob123`（owner）
  - `admin / admin123`（admin）
- 账号注册：不在系统前端开放，必须通过工单申请后由管理员创建

## 测试

```bash
cd web
npm test
```
