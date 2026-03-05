# 技术方案说明（v1）

## 1. 信息架构（IA）

- Dashboard
- Devices
- Debug Logs
- Programs
- Checklists
- Inspections
- Deliveries
- After-sales (v2)
- Users/Roles (v2)
- Settings (v2)

## 2. 核心实体

- Device（`device_sn` 唯一）
- ProgramVersion（baseline/process/final）
- DebugChangeLog（含修改发生时间与补录时间）
- InspectionTask / InspectionResult

## 3. 状态机（DeviceStatus）

- `debugging`
- `pending_inspection`
- `inspected`
- `delivered`
- `frozen`

### 3.1 状态迁移约束

1. 建档后默认 `debugging`
2. 提交检验：`debugging -> pending_inspection`
3. 满足以下三条件自动转 `inspected`：
   - 工程检验必选项全通过
   - 最终版本已封存（`final + sealed=true`）
   - 资料齐全（`documents_ready=true`）
4. 手工交付：`inspected -> delivered`
5. 冻结：`delivered -> frozen`

## 4. 关键业务规则（已在代码落地）

- 必须有 baseline 才允许提交检验
- 调试日志允许先改后补录，但超过 24h 补录视为逾期，逾期设备不可提交检验
- `inspected/frozen` 状态禁止继续提交非 final 程序版本
- final 版本必须 sealed

## 5. v2 扩展建议

- 接入数据库（PostgreSQL）
- RBAC（debugger / owner / admin）
- 审批流（基线审批、最终封存审批）
- 售后变更闭环（已交付后变更单驱动）
- Dashboard 指标与风险看板
