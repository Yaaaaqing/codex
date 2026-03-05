# 机床电气调试与程序版本全流程管理平台（v1 本地验证）

本仓库提供一个 **核心业务流转原型**，用于本地验证以下闭环：

- 调试建档（含 baseline 程序）
- 调试过程修改留痕（含 24h 补录约束）
- 提交待检验与检验签署
- 最终版本封存 + 资料齐全校验
- 交付与冻结状态迁移

## 目录

- `app/domain.py`：领域实体与状态枚举
- `app/workflow.py`：业务流程服务与状态迁移规则
- `app/demo.py`：可直接运行的流程演示脚本
- `tests/test_workflow.py`：核心流程单元测试

## 如何运行并查看结果

### 1) 运行自动化测试（验证规则正确性）

```bash
python -m unittest discover -s tests -p 'test_*.py'
```

预期输出包含：

- `Ran 3 tests ...`
- `OK`

### 2) 运行演示脚本（查看状态流转过程）

```bash
python -m app.demo
```

你会看到 1~7 步输出，按顺序展示状态从：

`debugging -> pending_inspection -> inspected -> delivered -> frozen`

## 当前实现边界

- v1 为内存存储（未接数据库）
- v1 角色权限仅通过接口调用方约定（未实现 RBAC）
- 检验报告 PDF、附件归档等先保留接口位

详见：`docs/technical-spec.md`
