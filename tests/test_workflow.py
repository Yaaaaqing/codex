import unittest
from datetime import datetime, timedelta

from app.domain import DebugChangeLog, DeviceStatus, InspectionResult, VersionType
from app.workflow import DeviceWorkflowService, WorkflowError


class DeviceWorkflowServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.service = DeviceWorkflowService()
        self.device = self.service.create_device(
            device_sn="SN-001",
            product_line="L1",
            model="M1",
            owner_debugger="alice",
            baseline_file_name="baseline.plc",
            created_by="alice",
        )

    def test_create_device_has_baseline(self) -> None:
        self.assertEqual(self.device.status, DeviceStatus.DEBUGGING)
        self.assertTrue(self.device.has_baseline())

    def test_submit_reject_overdue_log(self) -> None:
        log = DebugChangeLog(
            function_domain="axis",
            object_name="x_limit",
            reason="adjust",
            summary="changed max speed",
            changed_by="alice",
            changed_at=datetime.utcnow() - timedelta(hours=26),
            logged_at=datetime.utcnow(),
        )
        self.service.add_debug_log("SN-001", log)
        with self.assertRaises(WorkflowError):
            self.service.submit_for_inspection("SN-001", created_by="alice", checklist_codes=["C1"])

    def test_happy_path_to_frozen(self) -> None:
        self.service.submit_for_inspection("SN-001", created_by="alice", checklist_codes=["C1", "C2"])
        self.service.sign_inspection(
            "SN-001",
            signed_by="qa",
            results=[
                InspectionResult(item_code="C1", required=True, passed=True),
                InspectionResult(item_code="C2", required=True, passed=True),
            ],
        )
        # still pending: final sealed + docs required
        self.assertEqual(self.service.get_device("SN-001").status, DeviceStatus.PENDING_INSPECTION)

        self.service.add_program_version(
            "SN-001",
            version_no="v1.0.9",
            version_type=VersionType.FINAL,
            file_name="final.plc",
            uploaded_by="owner",
            sealed=True,
        )
        self.service.mark_documents_ready("SN-001", True)
        self.assertEqual(self.service.get_device("SN-001").status, DeviceStatus.INSPECTED)

        self.service.deliver("SN-001")
        self.assertEqual(self.service.get_device("SN-001").status, DeviceStatus.DELIVERED)
        self.service.freeze("SN-001")
        self.assertEqual(self.service.get_device("SN-001").status, DeviceStatus.FROZEN)


if __name__ == "__main__":
    unittest.main()
