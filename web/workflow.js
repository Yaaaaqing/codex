class WorkflowError extends Error {}

const DeviceStatus = {
  DEBUGGING: 'debugging',
  PENDING_INSPECTION: 'pending_inspection',
  INSPECTED: 'inspected',
  DELIVERED: 'delivered',
  FROZEN: 'frozen',
};

const VersionType = {
  BASELINE: 'baseline',
  PROCESS: 'process',
  FINAL: 'final',
};

class DeviceWorkflowService {
  constructor() {
    this.devices = new Map();
    this.frozenTemplates = [
      { templateVersion: 'v1', productLine: 'L1', model: '*', items: ['C-AXIS', 'C-INTERLOCK', 'C-ALARM'] },
      { templateVersion: 'v1', productLine: 'L2', model: '*', items: ['C-SAFETY', 'C-I/O'] },
    ];
  }

  assertRole(role, allow) {
    if (!allow.includes(role)) throw new WorkflowError(`permission denied for role=${role}`);
  }

  createDevice(payload, role, user) {
    this.assertRole(role, ['debugger', 'admin']);
    const { deviceSn, productLine, model, ownerDebugger, baselineFileName } = payload;
    if (this.devices.has(deviceSn)) throw new WorkflowError('device already exists');
    const now = new Date().toISOString();
    const device = {
      deviceSn,
      productLine,
      model,
      ownerDebugger,
      status: DeviceStatus.DEBUGGING,
      documentsReady: false,
      inspectionReportArchived: false,
      techDocsApproved: false,
      createdAt: now,
      programVersions: [{
        versionNo: 'v1.0.0', versionType: VersionType.BASELINE, fileName: baselineFileName,
        uploadedBy: user, uploadedAt: now, note: 'baseline', sealed: false, approved: false,
      }],
      changeLogs: [],
      inspectionTask: null,
    };
    this.devices.set(deviceSn, device);
    return device;
  }

  approveBaseline(deviceSn, role, user, approved = true) {
    this.assertRole(role, ['owner', 'admin']);
    const device = this.getDevice(deviceSn);
    const baseline = device.programVersions.find(v => v.versionType === VersionType.BASELINE);
    if (!baseline) throw new WorkflowError('baseline missing');
    baseline.approved = !!approved;
    baseline.approvedBy = user;
    baseline.approvedAt = new Date().toISOString();
    return device;
  }

  addDebugLog(deviceSn, log, role, user) {
    this.assertRole(role, ['debugger', 'admin']);
    const device = this.getDevice(deviceSn);
    if (device.status !== DeviceStatus.DEBUGGING) throw new WorkflowError('only debugging devices can be modified');
    device.changeLogs.push({ ...log, changedBy: user });
    return device;
  }

  addProgramVersion(deviceSn, data, role, user) {
    this.assertRole(role, ['debugger', 'owner', 'admin']);
    const device = this.getDevice(deviceSn);
    if ((device.status === DeviceStatus.INSPECTED || device.status === DeviceStatus.FROZEN) && data.versionType !== VersionType.FINAL) {
      throw new WorkflowError('cannot add non-final version after inspected/frozen');
    }
    if (data.versionType === VersionType.FINAL && role === 'debugger') {
      throw new WorkflowError('debugger cannot seal final version');
    }
    if (data.versionType === VersionType.FINAL && !data.sealed) {
      throw new WorkflowError('final version must be sealed');
    }
    device.programVersions.push({ ...data, uploadedBy: user, uploadedAt: new Date().toISOString() });
    this.tryPromote(device);
    return device;
  }

  submitInspection(deviceSn, role, user) {
    this.assertRole(role, ['debugger', 'owner', 'admin']);
    const device = this.getDevice(deviceSn);
    if (device.status !== DeviceStatus.DEBUGGING) throw new WorkflowError('invalid status');
    const baseline = device.programVersions.find(v => v.versionType === VersionType.BASELINE);
    if (!baseline) throw new WorkflowError('baseline required');
    if (!baseline.approved) throw new WorkflowError('baseline approval required');
    if (device.changeLogs.some(l => (new Date(l.loggedAt) - new Date(l.changedAt)) / 36e5 > 24)) {
      throw new WorkflowError('overdue logs found');
    }

    const checklistCodes = this.generateChecklistItems(device.productLine, device.model);
    device.inspectionTask = {
      taskId: `insp-${deviceSn}-${Date.now()}`,
      createdBy: user,
      createdAt: new Date().toISOString(),
      signedBy: null,
      signedAt: null,
      templateVersion: this.matchTemplate(device.productLine, device.model).templateVersion,
      results: checklistCodes.map(code => ({ itemCode: code, required: true, passed: false, comment: '' })),
    };
    device.status = DeviceStatus.PENDING_INSPECTION;
    return device;
  }

  signInspection(deviceSn, results, role, user) {
    this.assertRole(role, ['owner', 'admin']);
    const device = this.getDevice(deviceSn);
    if (!device.inspectionTask) throw new WorkflowError('inspection task missing');
    device.inspectionTask.results = results;
    device.inspectionTask.signedBy = user;
    device.inspectionTask.signedAt = new Date().toISOString();
    this.tryPromote(device);
    return device;
  }

  setDocumentsReady(deviceSn, ready, role) {
    this.assertRole(role, ['owner', 'admin']);
    const device = this.getDevice(deviceSn);
    device.documentsReady = !!ready;
    this.tryPromote(device);
    return device;
  }

  archiveInspectionReport(deviceSn, role) {
    this.assertRole(role, ['owner', 'admin']);
    const device = this.getDevice(deviceSn);
    device.inspectionReportArchived = true;
    this.tryPromote(device);
    return device;
  }

  approveTechDocs(deviceSn, role) {
    this.assertRole(role, ['owner', 'admin']);
    const device = this.getDevice(deviceSn);
    device.techDocsApproved = true;
    this.tryPromote(device);
    return device;
  }

  deliver(deviceSn, role) {
    this.assertRole(role, ['owner', 'admin']);
    const device = this.getDevice(deviceSn);
    if (device.status !== DeviceStatus.INSPECTED) throw new WorkflowError('must be inspected');
    device.status = DeviceStatus.DELIVERED;
    return device;
  }

  freeze(deviceSn, role) {
    this.assertRole(role, ['owner', 'admin']);
    const device = this.getDevice(deviceSn);
    if (device.status !== DeviceStatus.DELIVERED) throw new WorkflowError('must be delivered');
    device.status = DeviceStatus.FROZEN;
    return device;
  }

  listDevices(role, user) {
    const all = [...this.devices.values()];
    if (role === 'debugger') return all.filter(d => d.ownerDebugger === user);
    return all;
  }

  getDevice(deviceSn) {
    const d = this.devices.get(deviceSn);
    if (!d) throw new WorkflowError('device not found');
    return d;
  }

  matchTemplate(productLine, model) {
    return this.frozenTemplates.find(t => t.productLine === productLine && (t.model === model || t.model === '*'))
      || this.frozenTemplates.find(t => t.productLine === productLine)
      || this.frozenTemplates[0];
  }

  generateChecklistItems(productLine, model) {
    return [...this.matchTemplate(productLine, model).items];
  }

  tryPromote(device) {
    const task = device.inspectionTask;
    if (!task) return;
    const required = task.results.filter(r => r.required);
    const passed = required.length > 0 && required.every(r => r.passed);
    const finalSealed = device.programVersions.some(v => v.versionType === VersionType.FINAL && v.sealed);
    if (passed && finalSealed && device.documentsReady && device.inspectionReportArchived && device.techDocsApproved) {
      device.status = DeviceStatus.INSPECTED;
    }
  }
}

module.exports = { DeviceWorkflowService, WorkflowError, DeviceStatus, VersionType };
