const { useEffect, useMemo, useRef, useState } = React;
const {
  Layout, Typography, Button, Form, Input, Card, Space, message, Table, Tag,
  Statistic, Row, Col, Modal, Upload, Timeline, Divider, Select, Switch,
  Tabs, DatePicker, Drawer, Badge
} = antd;

const { Header, Content } = Layout;
const { Title, Text } = Typography;

function apiFetch(path, { method = 'GET', body, headers = {}, isForm = false } = {}) {
  const token = localStorage.getItem('token');
  const h = Object.assign({}, headers);
  if (token) h['Authorization'] = `Bearer ${token}`;
  if (!isForm) h['Content-Type'] = 'application/json';
  return fetch(path, {
    method,
    headers: h,
    body: isForm ? body : (body ? JSON.stringify(body) : undefined)
  });
}

function formatTs(ts) {
  try { return dayjs(ts).format('YYYY-MM-DD HH:mm:ss'); } catch { return ts; }
}

function StatusTag({ status }) {
  const map = {
    '未上传': { color: 'default' },
    '待设基线': { color: 'orange' },
    '已设基线': { color: 'green' }
  };
  const m = map[status] || { color: 'blue' };
  return React.createElement(Tag, { color: m.color }, status || '-');
}

function App() {
  const [me, setMe] = useState(null);
  const [route, setRoute] = useState('login'); // login | employee | lead | admin

  async function loadMe() {
    const res = await apiFetch('/api/me');
    if (!res.ok) return null;
    const u = await res.json();
    setMe(u);
    setRoute(u.role === 'admin' ? 'admin' : (u.role === 'dept_lead' ? 'lead' : 'employee'));
    return u;
  }

  useEffect(() => { loadMe(); }, []);

  async function logout() {
    try { await apiFetch('/api/auth/logout', { method: 'POST' }); } catch {}
    localStorage.removeItem('token');
    setMe(null);
    setRoute('login');
  }

  return React.createElement(Layout, { className: 'app' },
    React.createElement(Header, { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
      React.createElement(Space, { size: 12 },
        React.createElement(Title, { level: 4, style: { color: 'white', margin: 0 } }, 'PLC程序版本与功能检验平台（一期 Demo）'),
        me ? React.createElement(Tag, { color: 'geekblue' }, `${me.role} / ${me.dept}`) : null
      ),
      React.createElement(Space, null,
        me ? React.createElement(Text, { style: { color: 'rgba(255,255,255,0.85)' } }, `${me.name} (${me.id})`) : null,
        me ? React.createElement(Button, { onClick: logout }, '退出') : null
      )
    ),
    React.createElement(Content, { className: 'content' },
      route === 'login'
        ? React.createElement(LoginPage, { onLogin: async () => { await loadMe(); } })
        : route === 'employee'
          ? React.createElement(EmployeeDashboard, { me })
          : route === 'lead'
            ? React.createElement(DeptLeadDashboard, { me })
            : React.createElement(AdminConsole, { me })
    )
  );
}

function LoginPage({ onLogin }) {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  async function submit(values) {
    setSubmitting(true);
    try {
      const res = await apiFetch('/api/auth/login', { method: 'POST', body: { userId: values.userId } });
      const data = await res.json();
      if (!res.ok) { message.error(data.message || '登录失败'); return; }
      localStorage.setItem('token', data.token);
      message.success(`登录成功：${data.user.role}`);
      onLogin();
    } finally { setSubmitting(false); }
  }

  return React.createElement(Row, { justify: 'center', style: { marginTop: 60 } },
    React.createElement(Col, { xs: 22, sm: 16, md: 10, lg: 8 },
      React.createElement(Card, { title: '登录（模拟SSO）', bordered: false },
        React.createElement(Text, { type: 'secondary' }, '输入工号，后端读取 users 表确定 role/dept/enabled。'),
        React.createElement(Divider, null),
        React.createElement(Form, { form, layout: 'vertical', onFinish: submit, initialValues: { userId: 'test001' } },
          React.createElement(Form.Item, { label: '工号（userId）', name: 'userId', rules: [{ required: true, message: '请输入工号' }] },
            React.createElement(Input, { placeholder: '例如：admin / lead01 / test001' })
          ),
          React.createElement(Button, { type: 'primary', htmlType: 'submit', loading: submitting, block: true }, '登录')
        ),
        React.createElement(Divider, null),
        React.createElement(Text, { type: 'secondary' }, '演示账号：admin（admin/HQ），lead01（dept_lead/MT），test001（user/MT）')
      )
    )
  );
}

function EmployeeDashboard({ me }) {
  const [kpi, setKpi] = useState({ deviceCount: 0, versionCount: 0, needBaselineCount: 0 });
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(false);

  const [createForm] = Form.useForm();
  const [createModal, setCreateModal] = useState(false);
  const [detailId, setDetailId] = useState(null);

  async function refresh() {
    setLoading(true);
    try {
      const k = await (await apiFetch('/api/kpi/employee')).json();
      setKpi(k);
      const d = await (await apiFetch('/api/devices')).json();
      setDevices(d);
    } finally { setLoading(false); }
  }

  useEffect(() => { refresh(); }, []);

  async function createDevice(values) {
    const deviceSn = (values.deviceSn || '').trim();
    const userLabel = (values.userLabel || '').trim();
    const name = (values.name || '').trim();

    const fileList = values.baselineFile || [];
    const fileObj = fileList?.[0]?.originFileObj;

    if (!deviceSn) return message.error('deviceSn 必填（出厂编号）');
    if (!userLabel) return message.error('userLabel 必填（用户自定义名）');
    if (!fileObj) return message.error('baselineFile 必传（Baseline PLC 程序）');

    const fd = new FormData();
    fd.append('deviceSn', deviceSn);
    fd.append('userLabel', userLabel);
    fd.append('name', name || deviceSn);
    fd.append('baselineFile', fileObj);

    const res = await apiFetch('/api/devices', { method: 'POST', body: fd, isForm: true });
    const data = await res.json();
    if (!res.ok) return message.error(data.message || '创建失败');

    message.success('创建成功：已提交 Baseline 待审批');
    setCreateModal(false);
    createForm.resetFields();
    await refresh();
  }

  const columns = [
    { title: '设备名称', dataIndex: 'name', key: 'name', render: (t) => React.createElement(Text, { strong: true }, t) },
    { title: '设备SN', dataIndex: 'device_sn', key: 'device_sn', width: 160, render: (t) => React.createElement(Text, { className: 'mono' }, t) },
    { title: '部门', dataIndex: 'dept', key: 'dept', width: 90, render: (t) => React.createElement(Tag, null, t) },
    { title: '创建人', dataIndex: 'created_by', key: 'created_by', width: 100 },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at', width: 170, render: (t) => formatTs(t) },
    {
      title: '操作', key: 'op', width: 120,
      render: (_, r) => React.createElement(Button, { type: 'link', onClick: () => setDetailId(r.device_sn) }, '查看详情')
    }
  ];

  return React.createElement(Space, { direction: 'vertical', size: 12, style: { width: '100%' } },
    React.createElement(Row, { gutter: 12 },
      React.createElement(Col, { xs: 24, md: 8 }, React.createElement(Card, { className: 'kpi-card' }, React.createElement(Statistic, { title: '我的设备数', value: kpi.deviceCount }))),
      React.createElement(Col, { xs: 24, md: 8 }, React.createElement(Card, { className: 'kpi-card' }, React.createElement(Statistic, { title: '我的版本数', value: kpi.versionCount }))),
      React.createElement(Col, { xs: 24, md: 8 }, React.createElement(Card, { className: 'kpi-card' }, React.createElement(Statistic, { title: '待设基线设备数', value: kpi.needBaselineCount })))
    ),
    React.createElement(Card, {
      title: '我的设备',
      extra: React.createElement(Space, null,
        React.createElement(Button, { onClick: refresh }, '刷新'),
        React.createElement(Button, { type: 'primary', onClick: () => setCreateModal(true) }, '创建设备')
      )
    },
      React.createElement(Table, { rowKey: 'device_sn', columns, dataSource: devices, loading, pagination: { pageSize: 8 } })
    ),
    React.createElement(Modal, {
      title: '创建设备（建档并提交 Baseline）',
      open: createModal,
      onCancel: () => { setCreateModal(false); createForm.resetFields(); },
      footer: null
    },
      React.createElement(Form, {
        form: createForm,
        layout: 'vertical',
        onFinish: createDevice
      },
        React.createElement(Form.Item, {
          label: '出厂编号（deviceSn）',
          name: 'deviceSn',
          rules: [{ required: true, message: 'deviceSn 必填（出厂编号）' }]
        }, React.createElement(Input, { placeholder: '例如：SN-2026-0001' })),

        React.createElement(Form.Item, {
          label: '用户自定义名（用于版本号）',
          name: 'userLabel',
          rules: [{ required: true, message: 'userLabel 必填（用于版本号）' }]
        }, React.createElement(Input, { placeholder: '例如：初始基线 / V1 / 调试版' })),

        React.createElement(Form.Item, {
          label: 'Baseline PLC 程序文件（必传）',
          name: 'baselineFile',
          valuePropName: 'fileList',
          getValueFromEvent: (e) => (Array.isArray(e) ? e : e?.fileList),
          rules: [{
            validator: (_, fileList) => {
              if (fileList && fileList.length > 0) return Promise.resolve();
              return Promise.reject(new Error('Baseline 文件必传'));
            }
          }]
        },
          React.createElement(Upload, { beforeUpload: () => false, maxCount: 1 },
            React.createElement(Button, null, '选择文件')
          )
        ),

        React.createElement(Form.Item, {
          label: '设备名称',
          name: 'name',
          rules: [{ required: true, message: '请输入设备名称' }]
        }, React.createElement(Input, { placeholder: '例如：测试机床-001' })),

        React.createElement(Button, { type: 'primary', htmlType: 'submit', block: true }, '保存并提交 Baseline')
      )
    ),
    detailId ? React.createElement(DeviceDetailDrawer, { deviceId: detailId, onClose: () => setDetailId(null), role: me.role }) : null
  );
}


function DeptLeadDashboard({ me }) {
  const [kpi, setKpi] = useState({ deviceCount: 0, uploadedCount: 0, baselineCount: 0, needBaseline: 0 });
  const [devices, setDevices] = useState([]);
  const [audit, setAudit] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ created_by: '', status: '' });
  const [detailId, setDetailId] = useState(null);

  async function refresh() {
    setLoading(true);
    try {
      const k = await (await apiFetch('/api/kpi/dept')).json();
      setKpi(k);
      const d = await (await apiFetch('/api/devices')).json();
      setDevices(d);
      const a = await (await apiFetch('/api/audit')).json();
      setAudit(a);
    } finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  const createdByOptions = useMemo(() => {
    const s = new Set(devices.map(d => d.created_by));
    return Array.from(s).filter(Boolean);
  }, [devices]);

  const filteredDevices = useMemo(() => {
    return devices.filter(d => {
      if (filters.created_by && d.created_by !== filters.created_by) return false;
      return true;
    });
  }, [devices, filters]);

  const columns = [
    { title: '设备名称', dataIndex: 'name', key: 'name', render: (t) => React.createElement(Text, { strong: true }, t) },
    { title: '创建人', dataIndex: 'created_by', key: 'created_by', width: 120 },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at', width: 170, render: (t) => formatTs(t) },
    { title: '操作', key: 'op', width: 120, render: (_, r) => React.createElement(Button, { type: 'link', onClick: () => setDetailId(r.id) }, '查看详情') }
  ];

  const auditColumns = [
    { title: '时间', dataIndex: 'created_at', key: 'created_at', width: 170, render: (t) => formatTs(t) },
    { title: '动作', dataIndex: 'action', key: 'action', width: 140, render: (t) => React.createElement(Tag, null, t) },
    { title: '用户', dataIndex: 'user_id', key: 'user_id', width: 120 },
    { title: '设备', dataIndex: 'device_id', key: 'device_id', width: 160, render: (t) => t ? React.createElement(Text, { className: 'mono' }, t.slice(0, 8) + '...') : '-' },
    { title: '详情', dataIndex: 'detail', key: 'detail' }
  ];

  return React.createElement(Space, { direction: 'vertical', size: 12, style: { width: '100%' } },
    React.createElement(Row, { gutter: 12 },
      React.createElement(Col, { xs: 24, md: 6 }, React.createElement(Card, { className: 'kpi-card' }, React.createElement(Statistic, { title: '本部门设备总数', value: kpi.deviceCount }))),
      React.createElement(Col, { xs: 24, md: 6 }, React.createElement(Card, { className: 'kpi-card' }, React.createElement(Statistic, { title: '已上传设备数', value: kpi.uploadedCount }))),
      React.createElement(Col, { xs: 24, md: 6 }, React.createElement(Card, { className: 'kpi-card' }, React.createElement(Statistic, { title: '已设基线设备数', value: kpi.baselineCount }))),
      React.createElement(Col, { xs: 24, md: 6 }, React.createElement(Card, { className: 'kpi-card' }, React.createElement(Statistic, { title: '待设基线设备数', value: kpi.needBaseline })))
    ),
    React.createElement(Card, {
      title: `部门看板（${me.dept}）`,
      extra: React.createElement(Space, null,
        React.createElement(Select, {
          placeholder: '按创建人筛选',
          allowClear: true,
          style: { width: 180 },
          value: filters.created_by || undefined,
          onChange: (v) => setFilters(Object.assign({}, filters, { created_by: v || '' })),
          options: createdByOptions.map(x => ({ value: x, label: x }))
        }),
        React.createElement(Button, { onClick: refresh }, '刷新')
      )
    },
      React.createElement(Table, { rowKey: 'id', columns, dataSource: filteredDevices, loading, pagination: { pageSize: 8 } })
    ),
    React.createElement(Card, { title: '部门审计（最近500条）', extra: React.createElement(Button, { onClick: refresh }, '刷新') },
      React.createElement(Table, { rowKey: 'id', columns: auditColumns, dataSource: audit, loading, pagination: { pageSize: 8 } })
    ),
    detailId ? React.createElement(DeviceDetailDrawer, { deviceId: detailId, onClose: () => setDetailId(null), role: me.role }) : null
  );
}

function AdminConsole({ me }) {
  const [users, setUsers] = useState([]);
  const [audit, setAudit] = useState([]);
  const [devices, setDevices] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const u = await (await apiFetch('/api/admin/users')).json();
      setUsers(u);
      const a = await (await apiFetch('/api/audit')).json();
      setAudit(a);
      const d = await (await apiFetch('/api/devices')).json();
      setDevices(d);
    } finally { setLoading(false); }
  }

  useEffect(() => { refresh(); }, []);

  function onSelectUser(id) {
    setSelectedId(id);
    const u = users.find(x => x.id === id);
    if (u) form.setFieldsValue(u);
  }

  async function saveUser(values) {
    const res = await apiFetch('/api/admin/users', { method: 'POST', body: values });
    const data = await res.json();
    if (!res.ok) { message.error(data.message || '保存失败'); return; }
    message.success('保存成功（权限即时生效）');
    refresh();
  }

  function exportAuditCsv() {
    const headers = ['created_at','action','user_id','dept','device_id','plc_version_id','detail'];
    const rows = audit.map(r => headers.map(h => (r[h] ?? '')).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'audit.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  const userOptions = users.map(u => ({ value: u.id, label: `${u.id} | ${u.dept} | ${u.role} | enabled=${u.enabled}` }));

  const auditColumns = [
    { title: '时间', dataIndex: 'created_at', key: 'created_at', width: 170, render: (t) => formatTs(t) },
    { title: '动作', dataIndex: 'action', key: 'action', width: 140, render: (t) => React.createElement(Tag, null, t) },
    { title: '用户', dataIndex: 'user_id', key: 'user_id', width: 120 },
    { title: '部门', dataIndex: 'dept', key: 'dept', width: 90, render: (t) => React.createElement(Tag, null, t) },
    { title: '设备', dataIndex: 'device_id', key: 'device_id', width: 160, render: (t) => t ? React.createElement(Text, { className: 'mono' }, t.slice(0,8)+'...') : '-' },
    { title: '详情', dataIndex: 'detail', key: 'detail' }
  ];

  const deviceColumns = [
    { title: '设备名称', dataIndex: 'name', key: 'name', render: (t) => React.createElement(Text, { strong: true }, t) },
    { title: '部门', dataIndex: 'dept', key: 'dept', width: 90, render: (t) => React.createElement(Tag, null, t) },
    { title: '创建人', dataIndex: 'created_by', key: 'created_by', width: 120 },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at', width: 170, render: (t) => formatTs(t) }
  ];

  return React.createElement(Space, { direction: 'vertical', size: 12, style: { width: '100%' } },
    React.createElement(Row, { gutter: 12 },
      React.createElement(Col, { xs: 24, md: 10 },
        React.createElement(Card, { title: '用户管理（选择用户→回填→保存）', extra: React.createElement(Button, { onClick: refresh }, '刷新') },
          React.createElement(Form, { form, layout: 'vertical', onFinish: saveUser, initialValues: { enabled: 1, role: 'user' } },
            React.createElement(Form.Item, { label: '选择已有用户', name: '_select' },
              React.createElement(Select, { allowClear: true, options: userOptions, onChange: onSelectUser, placeholder: '选择后自动回填下方表单' })
            ),
            React.createElement(Row, { gutter: 12 },
              React.createElement(Col, { span: 12 },
                React.createElement(Form.Item, { label: '工号 id', name: 'id', rules: [{ required: true, message: '必填' }] },
                  React.createElement(Input, { placeholder: '例如 test002' })
                )
              ),
              React.createElement(Col, { span: 12 },
                React.createElement(Form.Item, { label: '姓名 name', name: 'name' },
                  React.createElement(Input, { placeholder: '可选' })
                )
              )
            ),
            React.createElement(Row, { gutter: 12 },
              React.createElement(Col, { span: 12 },
                React.createElement(Form.Item, { label: '部门 dept', name: 'dept', rules: [{ required: true, message: '必填' }] },
                  React.createElement(Input, { placeholder: '例如 MT / HQ' })
                )
              ),
              React.createElement(Col, { span: 12 },
                React.createElement(Form.Item, { label: '角色 role', name: 'role', rules: [{ required: true, message: '必填' }] },
                  React.createElement(Select, { options: [
                    { value: 'user', label: 'user（员工）' },
                    { value: 'dept_lead', label: 'dept_lead（部门负责人）' },
                    { value: 'admin', label: 'admin（管理员）' }
                  ] })
                )
              )
            ),
            React.createElement(Form.Item, { label: 'enabled（默认1）', name: 'enabled', valuePropName: 'checked', getValueFromEvent: (v)=>v ? 1 : 0, getValueProps: (v)=>({checked: v===1}) },
              React.createElement(Switch, { checkedChildren: '启用', unCheckedChildren: '停用', defaultChecked: true })
            ),
            React.createElement(Button, { type: 'primary', htmlType: 'submit', block: true }, '保存（立即生效）')
          )
        )
      ),
      React.createElement(Col, { xs: 24, md: 14 },
        React.createElement(Card, { title: '全量设备（admin）' },
          React.createElement(Table, { rowKey: 'id', columns: deviceColumns, dataSource: devices, loading, pagination: { pageSize: 6 } })
        )
      )
    ),
    React.createElement(Card, { title: '全量审计（可导出CSV）', extra: React.createElement(Space, null,
      React.createElement(Button, { onClick: refresh }, '刷新'),
      React.createElement(Button, { onClick: exportAuditCsv }, '导出CSV')
    )},
      React.createElement(Table, { rowKey: 'id', columns: auditColumns, dataSource: audit, loading, pagination: { pageSize: 8 } })
    )
  );
}

function DeviceDetailDrawer({ deviceId, onClose, role }) {
  const [detail, setDetail] = useState(null);
  const [versions, setVersions] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [archive, setArchive] = useState(null);
  const [gate, setGate] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [recordModal, setRecordModal] = useState(false);
  const [recordForm] = Form.useForm();
  const [frozenVersionId, setFrozenVersionId] = useState('');

  async function refresh() {
    setLoading(true);
    try {
      const d = await (await apiFetch(`/api/devices/${deviceId}`)).json();
      setDetail(d);
      const v = await (await apiFetch(`/api/devices/${deviceId}/versions`)).json();
      setVersions(v);
      const t = await (await apiFetch(`/api/devices/${deviceId}/timeline`)).json();
      setTimeline(t);

      const aRes = await apiFetch(`/api/machines/${deviceId}/debugArchive`);
      if (aRes.ok) setArchive(await aRes.json());
      const gRes = await apiFetch(`/api/machines/${deviceId}/delivery-gate`);
      if (gRes.ok) setGate(await gRes.json());
      const taskRes = await apiFetch(`/api/machines/${deviceId}/inspection-tasks`);
      if (taskRes.ok) setTasks(await taskRes.json());
    } finally { setLoading(false); }
  }

  useEffect(() => { refresh(); }, [deviceId]);

  async function setPointer(vid, kind) {
    const url = kind === 'current'
      ? `/api/devices/${deviceId}/versions/${vid}/set-current`
      : `/api/devices/${deviceId}/versions/${vid}/set-baseline`;
    const res = await apiFetch(url, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) return message.error(data.message || '操作失败');
    message.success(kind === 'current' ? '已设为当前版本' : '已设为基线版本');
    refresh();
  }

  async function addRecord(values) {
    const res = await apiFetch(`/api/versions/${values.vid}/records`, {
      method: 'POST',
      body: { description: values.description, recordType: values.recordType }
    });
    const data = await res.json();
    if (!res.ok) return message.error(data.message || '保存失败');
    message.success('记录已保存');
    setRecordModal(false);
    recordForm.resetFields();
    refresh();
  }

  async function createArchive() {
    const res = await apiFetch('/api/debug-archives', { method: 'POST', body: { deviceSn: deviceId } });
    const data = await res.json();
    if (!res.ok) return message.error(data.message || '建档失败');
    message.success('建档成功');
    refresh();
  }

  async function submitArchive() {
    if (!archive?.archive_id) return;
    const res = await apiFetch(`/api/debug-archives/${archive.archive_id}/submit`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) return message.error(data.message || '提交失败');
    message.success('已提交审批');
    refresh();
  }

  async function approveArchive(ok) {
    if (!archive?.archive_id) return;
    const url = `/api/debug-archives/${archive.archive_id}/${ok ? 'approve' : 'reject'}`;
    const res = await apiFetch(url, { method: 'POST', body: { comment: ok ? '通过' : '驳回' } });
    const data = await res.json();
    if (!res.ok) return message.error(data.message || '操作失败');
    message.success(ok ? '已审批通过' : '已驳回');
    refresh();
  }

  async function generateTasks() {
    if (!frozenVersionId.trim()) return message.error('请输入冻结版本ID');
    const res = await apiFetch(`/api/machines/${deviceId}/inspection-tasks/generate`, { method: 'POST', body: { frozenVersionId } });
    const data = await res.json();
    if (!res.ok) return message.error(data.message || '生成失败');
    message.success(`已生成 ${data.generated || 0} 项任务`);
    refresh();
  }

  async function signTask(taskId, result) {
    const res = await apiFetch(`/api/inspection-tasks/${taskId}/result`, { method: 'POST', body: { result, remark: 'UI签署' } });
    const data = await res.json();
    if (!res.ok) return message.error(data.message || '签署失败');
    message.success('签署完成');
    refresh();
  }

  async function finalize(vid) {
    const res = await apiFetch(`/api/machines/${deviceId}/finalize-delivery`, { method: 'POST', body: { plcVersionId: vid } });
    const data = await res.json();
    if (!res.ok) return message.error(data.message || '封存失败');
    message.success('已封存最终版本并归档报告');
    refresh();
  }

  const versionColumns = [
    { title: 'display_no', dataIndex: 'display_no', key: 'display_no', render: (t) => React.createElement(Text, { className: 'mono' }, t) },
    { title: '文件', dataIndex: 'filename', key: 'filename' },
    { title: '时间', dataIndex: 'created_at', key: 'created_at', width: 170, render: (t) => formatTs(t) },
    {
      title: '操作', key: 'op', width: 360,
      render: (_, r) => React.createElement(Space, null,
        React.createElement(Button, { size: 'small', onClick: () => setPointer(r.id, 'current') }, '设为当前'),
        React.createElement(Button, { size: 'small', onClick: () => setPointer(r.id, 'baseline') }, '设为基线'),
        React.createElement(Button, { size: 'small', onClick: () => window.open(`/api/versions/${r.id}/download`, '_blank') }, '下载'),
        React.createElement(Button, { size: 'small', type: 'primary', onClick: () => finalize(r.id) }, '封存Final')
      )
    }
  ];

  const taskColumns = [
    { title: '项编码', dataIndex: 'item_code', key: 'item_code', width: 120 },
    { title: '项名称', dataIndex: 'item_name', key: 'item_name' },
    { title: '必选', dataIndex: 'is_required', key: 'is_required', width: 80, render: (v) => v ? React.createElement(Tag, { color: 'red' }, '必选') : React.createElement(Tag, null, '可选') },
    { title: '结果', dataIndex: 'result', key: 'result', width: 90 },
    { title: '签署人', dataIndex: 'qa_user_id', key: 'qa_user_id', width: 100 },
    {
      title: '签署', key: 'sign', width: 150,
      render: (_, r) => React.createElement(Space, null,
        React.createElement(Button, { size: 'small', onClick: () => signTask(r.task_id, 'PASS') }, '通过'),
        React.createElement(Button, { size: 'small', danger: true, onClick: () => signTask(r.task_id, 'FAIL') }, '不通过')
      )
    }
  ];

  const uploadProps = {
    name: 'file',
    multiple: false,
    action: `/api/devices/${deviceId}/versions`,
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    data: () => ({ versionLabel: 'P-调试版' }),
    onChange(info) {
      if (info.file.status === 'done') { message.success('上传成功'); refresh(); }
      else if (info.file.status === 'error') { message.error('上传失败'); }
    }
  };

  const timelineItems = timeline.map(e => ({
    children: React.createElement(Space, { direction: 'vertical', size: 0 },
      React.createElement(Text, { strong: true }, e.action),
      React.createElement(Text, { type: 'secondary' }, `${formatTs(e.created_at)} · ${e.user_id}${e.detail ? ` · ${e.detail}` : ''}`)
    )
  }));

  return React.createElement(Drawer, { title: '设备详情（工程履历）', open: true, width: 1100, onClose },
    detail ? React.createElement(Space, { direction: 'vertical', size: 12, style: { width: '100%' } },
      React.createElement(Card, { size: 'small', title: '调试档案审批门禁' },
        React.createElement(Space, { direction: 'vertical', style: { width: '100%' } },
          React.createElement(Text, null, `档案状态：${archive?.approval_status || '未建档'}`),
          React.createElement(Space, null,
            React.createElement(Button, { onClick: createArchive }, '创建调试档案'),
            React.createElement(Button, { onClick: submitArchive, disabled: !archive || archive.approval_status !== 'DRAFT' }, '提交审批'),
            React.createElement(Button, { type: 'primary', onClick: () => approveArchive(true), disabled: !archive || !['SUBMITTED', 'DRAFT'].includes(archive.approval_status) }, '审批通过'),
            React.createElement(Button, { danger: true, onClick: () => approveArchive(false), disabled: !archive || !['SUBMITTED', 'DRAFT'].includes(archive.approval_status) }, '审批驳回')
          )
        )
      ),
      React.createElement(Card, { size: 'small', title: '交付门禁检查' },
        gate ? React.createElement(Space, null,
          React.createElement(Tag, { color: gate.approvedArchive ? 'green' : 'orange' }, `建档审批:${gate.approvedArchive ? '通过' : '未通过'}`),
          React.createElement(Tag, { color: gate.requiredAllPassed ? 'green' : 'orange' }, `必选通过:${gate.requiredPassed}/${gate.requiredTotal}`),
          React.createElement(Tag, { color: gate.finalSealed ? 'green' : 'orange' }, `Final封存:${gate.finalSealed ? '是' : '否'}`),
          React.createElement(Tag, { color: gate.canDeliver ? 'green' : 'red' }, `可交付:${gate.canDeliver ? '是' : '否'}`)
        ) : React.createElement(Text, { type: 'secondary' }, '暂无数据')
      ),
      React.createElement(Card, { title: '上传过程版本', size: 'small' },
        React.createElement(Upload, uploadProps, React.createElement(Button, { type: 'primary' }, '选择文件并上传'))
      ),
      React.createElement(Card, { title: '版本列表', size: 'small' },
        React.createElement(Table, { rowKey: 'id', columns: versionColumns, dataSource: versions, loading, pagination: { pageSize: 5 } }),
        React.createElement(Divider, null),
        React.createElement(Button, { onClick: () => setRecordModal(true) }, '新增记录')
      ),
      React.createElement(Card, { title: '检验任务（冻结清单生成）', size: 'small' },
        React.createElement(Space, { style: { marginBottom: 10 } },
          React.createElement(Input, { style: { width: 320 }, placeholder: '输入 frozenVersionId', value: frozenVersionId, onChange: (e) => setFrozenVersionId(e.target.value) }),
          React.createElement(Button, { type: 'primary', onClick: generateTasks }, '生成检验任务')
        ),
        React.createElement(Table, { rowKey: 'task_id', columns: taskColumns, dataSource: tasks, pagination: { pageSize: 6 } })
      ),
      React.createElement(Card, { title: '时间线', size: 'small' },
        React.createElement(Timeline, { items: timelineItems.length ? timelineItems : [{ children: '暂无事件' }] })
      ),
      React.createElement(Modal, { title: '新增记录', open: recordModal, onCancel: () => setRecordModal(false), footer: null },
        React.createElement(Form, { form: recordForm, layout: 'vertical', onFinish: addRecord, initialValues: { recordType: '检验' } },
          React.createElement(Form.Item, { label: '选择版本', name: 'vid', rules: [{ required: true, message: '请选择版本' }] },
            React.createElement(Select, { options: versions.map(v => ({ value: v.id, label: v.display_no })) })
          ),
          React.createElement(Form.Item, { label: '记录类型', name: 'recordType', rules: [{ required: true }] },
            React.createElement(Select, { options: [{ value: '变更', label: '变更' }, { value: '检验', label: '检验' }] })
          ),
          React.createElement(Form.Item, { label: '说明', name: 'description', rules: [{ required: true, message: '请输入说明' }] },
            React.createElement(Input.TextArea, { rows: 4 })
          ),
          React.createElement(Button, { type: 'primary', htmlType: 'submit', block: true }, '保存')
        )
      )
    ) : React.createElement(Text, null, '加载中...')
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));