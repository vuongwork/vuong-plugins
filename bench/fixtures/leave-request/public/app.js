// Screen L01 – leave request: modes New / Edit / View (spec L01_DangKyNghiPhep.xlsx).
(function () {
  const L = window.Leave;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const user = params.get('user') || localStorage.getItem('user') || 'E001';
  const today = () => L.toDateString(new Date());

  let mode = params.get('id') ? (params.get('mode') === 'edit' ? 'edit' : 'view') : 'new';
  let leave = null;
  let balance = null;
  let part = 'full';
  let dirty = false;

  async function call(method, path, body) {
    const res = await fetch('/api' + path, {
      method, headers: { 'X-User': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.code || String(res.status)), { code: data.code, status: res.status });
    return data;
  }

  let snackTimer = null;
  function snack(text, isError) {
    const s = $('snackbar');
    s.textContent = text;
    s.className = 'snackbar' + (isError ? ' error' : '');
    s.hidden = false;
    clearTimeout(snackTimer);
    snackTimer = setTimeout(() => { s.hidden = true; }, 3000);
  }

  function confirmBox(title, code) {
    return new Promise((resolve) => {
      $('dlg-title').textContent = title;
      $('dlg-text').textContent = L.message(code);
      $('dialog').hidden = false;
      const done = (v) => { $('dialog').hidden = true; $('dlg-yes').onclick = $('dlg-no').onclick = null; resolve(v); };
      $('dlg-yes').onclick = () => done(true);
      $('dlg-no').onclick = () => done(false);
    });
  }

  function values() {
    return { type: $('type').value, from: $('from').value, to: $('to').value, part: L.normalizePart($('from').value, $('to').value, part), reason: $('reason').value };
  }

  function recalc() {
    const v = values();
    const single = v.from && v.from === v.to;
    if (!single) part = 'full';
    $('part').classList.toggle('locked', !single || mode === 'view');
    for (const b of $('part').children) b.classList.toggle('on', b.dataset.part === part);
    $('days').textContent = L.formatDays(L.workingDays(v.from, v.to, part));
    const n = v.reason.length;
    $('counter').textContent = n + '/' + L.REASON_MAX;
    $('counter').classList.toggle('over', n > L.REASON_MAX);
  }

  function showErrors(errors) {
    for (const f of ['type', 'from', 'to', 'reason', 'days']) {
      const e = errors.find((x) => x.field === f);
      const el = $('err-' + f);
      el.hidden = !e;
      el.textContent = e ? L.message(e.code, e.vars) : '';
      const box = $('box-' + f);
      if (box) box.classList.toggle('err', !!e);
    }
  }

  function render() {
    $('title').textContent = { new: 'Tạo đơn nghỉ phép', edit: 'Sửa đơn nghỉ phép', view: 'Chi tiết đơn nghỉ phép' }[mode];
    const ro = mode === 'view';
    for (const id of ['type', 'from', 'to', 'reason']) $(id).disabled = ro;
    for (const id of ['box-type', 'box-from', 'box-to', 'box-reason']) $(id).classList.toggle('ro', ro);
    $('row-head').hidden = mode === 'new';
    $('field-balance').hidden = ro;
    if (leave) {
      $('leave-id').textContent = leave.id;
      $('status').textContent = L.STATUS[leave.status];
      $('status').className = 'pill ' + leave.status;
    }
    const status = leave && leave.status;
    $('btn-save').hidden = $('btn-submit').hidden = ro;
    $('btn-edit').hidden = !(ro && status === 'draft');
    $('btn-cancel').hidden = !(mode !== 'new' && status !== 'approved');
    recalc();
  }

  function fill(l) {
    $('type').value = l.type;
    $('from').value = l.from;
    $('to').value = l.to;
    $('reason').value = l.reason || '';
    part = l.part || 'full';
  }

  function setMode(m) {
    mode = m;
    const q = new URLSearchParams({ id: leave.id });
    if (m === 'edit') q.set('mode', 'edit');
    history.replaceState(null, '', '/?' + q);
    dirty = false;
    showErrors([]);
    render();
  }

  async function loadBalance() {
    try { balance = await call('GET', '/leave-balance'); $('balance').textContent = L.formatDays(balance.remaining); } catch (e) { $('balance').textContent = '–'; }
  }

  async function persist() {
    const v = values();
    leave = leave ? await call('PUT', '/leaves/' + leave.id, v) : await call('POST', '/leaves', v);
    return leave;
  }

  async function onSave() {
    const errors = L.validate(values(), today());
    showErrors(errors);
    if (errors.length) return;
    try { await persist(); snack(L.message('LV-I01')); setMode('edit'); } catch (e) { snack(L.message(e.code), true); }
  }

  async function onSubmit() {
    const v = values();
    const errors = L.validate(v, today());
    const days = L.workingDays(v.from, v.to, v.part);
    if (v.type === 'annual' && balance && days > balance.remaining) errors.push({ field: 'days', code: 'LV-E04', vars: { n: L.formatDays(balance.remaining) } });
    showErrors(errors);
    if (errors.length) return;
    if (!(await confirmBox('Xác nhận gửi duyệt', 'LV-C01'))) return;
    try {
      await persist();
      leave = await call('POST', '/leaves/' + leave.id + '/submit');
      snack(L.message('LV-I02'));
      setMode('view');
    } catch (e) { snack(L.message(e.code), true); }
  }

  async function onCancel() {
    if (!(await confirmBox('Xác nhận huỷ đơn', 'LV-C02'))) return;
    try { leave = await call('POST', '/leaves/' + leave.id + '/cancel'); snack(L.message('LV-I03')); setMode('view'); } catch (e) { snack(L.message(e.code), true); }
  }

  async function onBack() {
    if (dirty && !(await confirmBox('Bỏ thay đổi', 'LV-C03'))) return;
    history.back();
  }

  function bind() {
    for (const id of ['type', 'from', 'to', 'reason']) $(id).addEventListener('input', () => { dirty = true; recalc(); });
    for (const b of $('part').children) b.addEventListener('click', () => {
      if ($('part').classList.contains('locked')) return;
      part = b.dataset.part; dirty = true; recalc();
    });
    $('btn-save').onclick = onSave;
    $('btn-submit').onclick = onSubmit;
    $('btn-cancel').onclick = onCancel;
    $('btn-edit').onclick = () => setMode('edit');
    $('btn-back').onclick = $('btn-back2').onclick = onBack;
  }

  async function start() {
    bind();
    if (params.get('id')) {
      try { leave = await call('GET', '/leaves/' + encodeURIComponent(params.get('id'))); } catch (e) {
        $('form').hidden = true;
        $('notice').hidden = false;
        $('notice').textContent = L.message(e.code);
        for (const id of ['btn-save', 'btn-submit', 'btn-edit', 'btn-cancel']) $(id).hidden = true;
        return;
      }
      fill(leave);
      if (mode === 'edit' && leave.status !== 'draft') mode = 'view';
    }
    render();
    if (mode !== 'view') await loadBalance();
  }

  start();
})();
