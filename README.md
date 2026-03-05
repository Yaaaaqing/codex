# 机床电气调试与程序版本全流程管理平台（JavaScript 可视化原型）

现在提供的是一个**可直接操作的前后端可视化原型**，用于验证你提出的完整业务逻辑，并且区分三类角色界面与权限。

## 1. 已实现内容

- 前端可视化页面（设备列表 + 操作面板 + 实时结果输出）
- 后端 API（内存存储）
- 角色权限控制（`debugger` / `owner` / `admin`）
- 核心状态机流转：
  `debugging -> pending_inspection -> inspected -> delivered -> frozen`
- 关键约束：
  - baseline 必须存在
  - 超 24h 补录日志不可提交检验
  - final 版本必须 sealed
  - debugger 不能执行检验签署/最终封存/交付冻结

## 2. 目录

- `web/server.js`：Node.js HTTP 服务与 API
- `web/workflow.js`：核心业务规则与权限校验
- `web/public/index.html`：前端页面
- `web/public/main.js`：前端交互逻辑
- `web/public/styles.css`：页面样式
- `web/tests/workflow.test.js`：JS 业务逻辑测试

## 3. 如何运行（你和别人都可直接上手）

```bash
cd web
npm start
```

启动后访问：

- `http://localhost:3000`

## 4. 如何验证三类角色

页面左侧可切换：

- `debugger`
- `owner`
- `admin`

### debugger 可做

- 新建设备
- 新增调试日志
- 上传过程版本
- 提交待检验

### owner 可做

- 检验签署
- 封存最终版本
- 标记资料齐全
- 交付与冻结

### admin 可做

- 全部操作（用于系统验证）

## 5. 本地测试

```bash
cd web
npm test
```

会验证：

- 权限拦截是否生效
- happy path 是否能进入 `inspected`

---

> 说明：之前的 Python 文件仍保留在仓库中作为早期原型；当前推荐使用 `web/` 下的 JavaScript 可视化版本进行演示与验收。
