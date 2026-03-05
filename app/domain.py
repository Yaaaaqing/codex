from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import List, Optional


class DeviceStatus(str, Enum):
    DEBUGGING = "debugging"
    PENDING_INSPECTION = "pending_inspection"
    INSPECTED = "inspected"
    DELIVERED = "delivered"
    FROZEN = "frozen"


class VersionType(str, Enum):
    BASELINE = "baseline"
    PROCESS = "process"
    FINAL = "final"


@dataclass
class ProgramVersion:
    version_no: str
    version_type: VersionType
    file_name: str
    uploaded_by: str
    uploaded_at: datetime
    note: str = ""
    sealed: bool = False
    inspection_id: Optional[str] = None


@dataclass
class DebugChangeLog:
    function_domain: str
    object_name: str
    reason: str
    summary: str
    changed_by: str
    changed_at: datetime
    logged_at: datetime

    @property
    def delayed_over_24h(self) -> bool:
        return self.logged_at - self.changed_at > timedelta(hours=24)


@dataclass
class InspectionResult:
    item_code: str
    required: bool
    passed: bool
    comment: str = ""


@dataclass
class InspectionTask:
    task_id: str
    device_sn: str
    created_at: datetime
    created_by: str
    results: List[InspectionResult] = field(default_factory=list)
    signed_by: Optional[str] = None
    signed_at: Optional[datetime] = None

    def all_required_passed(self) -> bool:
        required_items = [r for r in self.results if r.required]
        return bool(required_items) and all(r.passed for r in required_items)


@dataclass
class Device:
    device_sn: str
    product_line: str
    model: str
    owner_debugger: str
    created_at: datetime
    status: DeviceStatus = DeviceStatus.DEBUGGING
    program_versions: List[ProgramVersion] = field(default_factory=list)
    change_logs: List[DebugChangeLog] = field(default_factory=list)
    inspection_task: Optional[InspectionTask] = None
    documents_ready: bool = False

    def latest_version(self) -> Optional[ProgramVersion]:
        if not self.program_versions:
            return None
        return sorted(self.program_versions, key=lambda x: x.uploaded_at)[-1]

    def has_baseline(self) -> bool:
        return any(v.version_type == VersionType.BASELINE for v in self.program_versions)

    def has_final_sealed(self) -> bool:
        return any(v.version_type == VersionType.FINAL and v.sealed for v in self.program_versions)

    def has_overdue_logs(self) -> bool:
        return any(log.delayed_over_24h for log in self.change_logs)
