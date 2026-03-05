from __future__ import annotations

from datetime import datetime
from typing import Dict, Iterable, List

from app.domain import (
    DebugChangeLog,
    Device,
    DeviceStatus,
    InspectionResult,
    InspectionTask,
    ProgramVersion,
    VersionType,
)


class WorkflowError(ValueError):
    """Raised when business constraints are violated."""


class DeviceWorkflowService:
    """Core workflow service for v1 local validation."""

    def __init__(self) -> None:
        self._devices: Dict[str, Device] = {}

    def create_device(
        self,
        device_sn: str,
        product_line: str,
        model: str,
        owner_debugger: str,
        baseline_file_name: str,
        created_by: str,
    ) -> Device:
        if device_sn in self._devices:
            raise WorkflowError(f"device already exists: {device_sn}")
        now = datetime.utcnow()
        device = Device(
            device_sn=device_sn,
            product_line=product_line,
            model=model,
            owner_debugger=owner_debugger,
            created_at=now,
        )
        device.program_versions.append(
            ProgramVersion(
                version_no="v1.0.0",
                version_type=VersionType.BASELINE,
                file_name=baseline_file_name,
                uploaded_by=created_by,
                uploaded_at=now,
                note="baseline",
            )
        )
        self._devices[device_sn] = device
        return device

    def add_program_version(
        self,
        device_sn: str,
        version_no: str,
        version_type: VersionType,
        file_name: str,
        uploaded_by: str,
        note: str = "",
        sealed: bool = False,
        inspection_id: str | None = None,
    ) -> ProgramVersion:
        device = self.get_device(device_sn)
        if device.status in {DeviceStatus.INSPECTED, DeviceStatus.FROZEN} and version_type != VersionType.FINAL:
            raise WorkflowError("inspected/frozen devices cannot add non-final versions in v1")

        if version_type == VersionType.FINAL and not sealed:
            raise WorkflowError("final version must be sealed")

        version = ProgramVersion(
            version_no=version_no,
            version_type=version_type,
            file_name=file_name,
            uploaded_by=uploaded_by,
            uploaded_at=datetime.utcnow(),
            note=note,
            sealed=sealed,
            inspection_id=inspection_id,
        )
        device.program_versions.append(version)
        self._try_promote_to_inspected(device)
        return version

    def add_debug_log(self, device_sn: str, log: DebugChangeLog) -> None:
        device = self.get_device(device_sn)
        if device.status != DeviceStatus.DEBUGGING:
            raise WorkflowError("debug logs can only be added while debugging")
        device.change_logs.append(log)

    def submit_for_inspection(self, device_sn: str, created_by: str, checklist_codes: Iterable[str]) -> InspectionTask:
        device = self.get_device(device_sn)
        if device.status != DeviceStatus.DEBUGGING:
            raise WorkflowError("only debugging devices can submit inspection")
        if not device.has_baseline():
            raise WorkflowError("baseline version required")
        if device.has_overdue_logs():
            raise WorkflowError("device has overdue (>24h) debug logs")

        task = InspectionTask(
            task_id=f"insp-{device.device_sn}-{int(datetime.utcnow().timestamp())}",
            device_sn=device.device_sn,
            created_by=created_by,
            created_at=datetime.utcnow(),
            results=[InspectionResult(item_code=code, required=True, passed=False) for code in checklist_codes],
        )
        device.inspection_task = task
        device.status = DeviceStatus.PENDING_INSPECTION
        return task

    def sign_inspection(self, device_sn: str, signed_by: str, results: List[InspectionResult]) -> None:
        device = self.get_device(device_sn)
        task = device.inspection_task
        if not task:
            raise WorkflowError("inspection task not found")

        task.results = results
        task.signed_by = signed_by
        task.signed_at = datetime.utcnow()
        self._try_promote_to_inspected(device)

    def mark_documents_ready(self, device_sn: str, ready: bool = True) -> None:
        device = self.get_device(device_sn)
        device.documents_ready = ready
        self._try_promote_to_inspected(device)

    def deliver(self, device_sn: str) -> None:
        device = self.get_device(device_sn)
        if device.status != DeviceStatus.INSPECTED:
            raise WorkflowError("only inspected devices can be delivered")
        device.status = DeviceStatus.DELIVERED

    def freeze(self, device_sn: str) -> None:
        device = self.get_device(device_sn)
        if device.status != DeviceStatus.DELIVERED:
            raise WorkflowError("only delivered devices can be frozen")
        device.status = DeviceStatus.FROZEN

    def get_device(self, device_sn: str) -> Device:
        if device_sn not in self._devices:
            raise WorkflowError(f"device not found: {device_sn}")
        return self._devices[device_sn]

    def _try_promote_to_inspected(self, device: Device) -> None:
        task = device.inspection_task
        if not task:
            return
        if task.all_required_passed() and device.has_final_sealed() and device.documents_ready:
            device.status = DeviceStatus.INSPECTED
