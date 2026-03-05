from datetime import datetime, timedelta

from app.domain import DebugChangeLog, InspectionResult, VersionType
from app.workflow import DeviceWorkflowService


def main() -> None:
    service = DeviceWorkflowService()

    device = service.create_device(
        device_sn="SN-DEMO-001",
        product_line="Line-A",
        model="Model-X",
        owner_debugger="alice",
        baseline_file_name="baseline_v1.plc",
        created_by="alice",
    )
    print(f"[1] 建档完成: {device.device_sn}, status={device.status.value}")

    ontime_log = DebugChangeLog(
        function_domain="axis",
        object_name="x_limit",
        reason="optimize",
        summary="调整X轴限位保护",
        changed_by="alice",
        changed_at=datetime.utcnow() - timedelta(hours=2),
        logged_at=datetime.utcnow(),
    )
    service.add_debug_log("SN-DEMO-001", ontime_log)
    print("[2] 已记录调试修改日志（24h内补录）")

    task = service.submit_for_inspection(
        "SN-DEMO-001",
        created_by="alice",
        checklist_codes=["C-AXIS", "C-INTERLOCK"],
    )
    print(f"[3] 已提交检验: {task.task_id}, status={service.get_device('SN-DEMO-001').status.value}")

    service.sign_inspection(
        "SN-DEMO-001",
        signed_by="qa-bob",
        results=[
            InspectionResult(item_code="C-AXIS", required=True, passed=True),
            InspectionResult(item_code="C-INTERLOCK", required=True, passed=True),
        ],
    )
    print(f"[4] 检验签署完成，当前状态={service.get_device('SN-DEMO-001').status.value}（仍待最终封存+资料）")

    service.add_program_version(
        "SN-DEMO-001",
        version_no="v1.0.9",
        version_type=VersionType.FINAL,
        file_name="final_v1.plc",
        uploaded_by="owner",
        sealed=True,
        note="最终交付版本",
    )
    service.mark_documents_ready("SN-DEMO-001", True)
    print(f"[5] 最终版本封存+资料齐全，状态={service.get_device('SN-DEMO-001').status.value}")

    service.deliver("SN-DEMO-001")
    print(f"[6] 交付完成，状态={service.get_device('SN-DEMO-001').status.value}")

    service.freeze("SN-DEMO-001")
    print(f"[7] 冻结完成，状态={service.get_device('SN-DEMO-001').status.value}")


if __name__ == "__main__":
    main()
