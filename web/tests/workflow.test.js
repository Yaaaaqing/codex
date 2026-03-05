const assert = require('assert');
const { DeviceWorkflowService, WorkflowError } = require('../workflow');

function testRolePermission() {
  const svc = new DeviceWorkflowService();
  svc.createDevice({ deviceSn: 'SN1', productLine: 'L1', model: 'M1', ownerDebugger: 'alice', baselineFileName: 'b.plc' }, 'debugger', 'alice');
  let denied = false;
  try {
    svc.signInspection('SN1', [], 'debugger', 'alice');
  } catch (e) {
    denied = e instanceof WorkflowError;
  }
  assert.strictEqual(denied, true);
}

function testBaselineApprovalRequired() {
  const svc = new DeviceWorkflowService();
  svc.createDevice({ deviceSn: 'SN2', productLine: 'L1', model: 'M2', ownerDebugger: 'alice', baselineFileName: 'b.plc' }, 'debugger', 'alice');
  assert.throws(() => svc.submitInspection('SN2', 'debugger', 'alice'), /baseline approval required/);
  svc.approveBaseline('SN2', 'owner', 'bob', true);
  svc.submitInspection('SN2', 'debugger', 'alice');
  assert.strictEqual(svc.getDevice('SN2').status, 'pending_inspection');
}

function testInspectionNeedsAllReleaseGates() {
  const svc = new DeviceWorkflowService();
  svc.createDevice({ deviceSn: 'SN3', productLine: 'L1', model: 'M3', ownerDebugger: 'alice', baselineFileName: 'b.plc' }, 'debugger', 'alice');
  svc.approveBaseline('SN3', 'owner', 'bob', true);
  svc.submitInspection('SN3', 'debugger', 'alice');
  svc.signInspection('SN3', [
    { itemCode: 'C-AXIS', required: true, passed: true },
    { itemCode: 'C-INTERLOCK', required: true, passed: true },
    { itemCode: 'C-ALARM', required: true, passed: true },
  ], 'owner', 'bob');
  svc.addProgramVersion('SN3', { versionNo: 'v1', versionType: 'final', fileName: 'f.plc', sealed: true }, 'owner', 'bob');
  svc.setDocumentsReady('SN3', true, 'owner');
  assert.strictEqual(svc.getDevice('SN3').status, 'pending_inspection');

  svc.archiveInspectionReport('SN3', 'owner');
  svc.approveTechDocs('SN3', 'owner');
  assert.strictEqual(svc.getDevice('SN3').status, 'inspected');
}

testRolePermission();
testBaselineApprovalRequired();
testInspectionNeedsAllReleaseGates();
console.log('workflow tests passed');
