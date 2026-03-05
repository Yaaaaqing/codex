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

function testHappyPath() {
  const svc = new DeviceWorkflowService();
  svc.createDevice({ deviceSn: 'SN2', productLine: 'L1', model: 'M2', ownerDebugger: 'alice', baselineFileName: 'b.plc' }, 'debugger', 'alice');
  svc.submitInspection('SN2', ['C1'], 'debugger', 'alice');
  svc.signInspection('SN2', [{ itemCode: 'C1', required: true, passed: true }], 'owner', 'bob');
  svc.addProgramVersion('SN2', { versionNo: 'v1', versionType: 'final', fileName: 'f.plc', sealed: true }, 'owner', 'bob');
  svc.setDocumentsReady('SN2', true, 'owner');
  assert.strictEqual(svc.getDevice('SN2').status, 'inspected');
}

testRolePermission();
testHappyPath();
console.log('workflow tests passed');
