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
- `tests/test_workflow.py`：核心流程单元测试

## 快速运行

```bash
python -m unittest discover -s tests -p 'test_*.py'
```

## 当前实现边界

- v1 为内存存储（未接数据库）
- v1 角色权限仅通过接口调用方约定（未实现 RBAC）
- 检验报告 PDF、附件归档等先保留接口位

详见：`docs/technical-spec.md`
