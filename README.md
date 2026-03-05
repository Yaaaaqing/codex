# 机床电气调试与程序版本全流程管理平台（JavaScript 可视化原型）

该版本已对齐“首次上电建档 → 调试留痕 → 冻结清单检验 → 最终封存 → 交付状态管控 → 售后扩展”的主线。

## 已实现能力

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
- `web/server.js`：Node.js HTTP API + 静态页面
- `web/public/index.html`：前端页面（角色菜单与操作面板）
- `web/public/main.js`：前端交互逻辑
- `web/tests/workflow.test.js`：业务规则自动化测试

## 运行方式

```bash
cd web
npm start
```

浏览器访问：`http://localhost:3000`

## 快速验证建议

1. 切换 `debugger` 创建新设备（SN 自定义）
2. 尝试直接“提交待检验”会失败（未基线审批）
3. 切换 `owner` 先“审批基线”
4. 切回 `debugger` 记录修改并“提交待检验”
5. 切换 `owner` 完成“检验签署 + 封存最终版本 + 资料齐全 + 报告归档 + 技术文件审批”
6. 观察状态自动变为 `inspected`，再执行“交付/冻结”

## 测试

```bash
cd web
npm test
```
