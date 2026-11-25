// Leave request rules, shared by the browser (window.Leave) and the server (require).
(function (root) {
  const TYPES = { annual: 'Phép năm', sick: 'Nghỉ ốm', personal: 'Việc riêng', other: 'Khác' };
  const PARTS = { full: 'Cả ngày', am: 'Sáng', pm: 'Chiều' };
  const STATUS = { draft: 'Nháp', pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối', cancelled: 'Đã huỷ' };
  const REASON_MAX = 255;

  const MESSAGES = {
    'LV-E01': 'Vui lòng chọn loại nghỉ.',
    'LV-E02': 'Ngày bắt đầu phải từ hôm nay trở đi.',
    'LV-E03': 'Ngày kết thúc phải sau hoặc bằng ngày bắt đầu.',
    'LV-E04': 'Số ngày nghỉ vượt quá số dư phép năm (còn {n} ngày).',
    'LV-E05': 'Vui lòng nhập lý do.',
    'LV-E06': 'Lý do tối đa ' + REASON_MAX + ' ký tự.',
    'LV-E403': 'Bạn không có quyền xem đơn này.',
    'LV-E404': 'Không tìm thấy đơn nghỉ phép.',
    'LV-E409': 'Đơn không còn ở trạng thái cho phép thao tác này.',
    'LV-I01': 'Đã lưu nháp.',
    'LV-I02': 'Đã gửi đơn cho quản lý duyệt.',
    'LV-I03': 'Đã huỷ đơn.',
    'LV-C01': 'Gửi đơn cho quản lý duyệt?',
    'LV-C02': 'Bạn chắc chắn muốn huỷ đơn này?',
    'LV-C03': 'Bỏ các thay đổi chưa lưu?',
  };

  function message(code, vars) {
    let m = MESSAGES[code] || code;
    for (const k in vars || {}) m = m.replace('{' + k + '}', vars[k]);
    return m;
  }

  // 'YYYY-MM-DD' -> Date at local midnight
  function parseDate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }

  function toDateString(d) {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function isWeekend(d) {
    const day = d.getDay();
    return day === 0 || day === 7;
  }

  // Working days from `from` to `to`, both included; a half day (am / pm) on a single day counts 0.5.
  function workingDays(from, to, part) {
    const a = parseDate(from), b = parseDate(to);
    if (!a || !b || b < a) return 0;
    if (from === to && (part === 'am' || part === 'pm')) return isWeekend(a) ? 0 : 0.5;
    let n = 0;
    for (const d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) if (!isWeekend(d)) n++;
    return n;
  }

  function formatDays(n) {
    return Number(n || 0).toFixed(1);
  }

  // Field errors in display order. `today` is 'YYYY-MM-DD'.
  function validate(input, today) {
    const errors = [];
    const v = input || {};
    if (!TYPES[v.type]) errors.push({ field: 'type', code: 'LV-E01' });
    if (!parseDate(v.from) || (today && v.from < today)) errors.push({ field: 'from', code: 'LV-E02' });
    if (!parseDate(v.to) || (parseDate(v.from) && v.to < v.from)) errors.push({ field: 'to', code: 'LV-E03' });
    const reason = String(v.reason || '');
    if (v.type === 'other' && !reason.trim()) errors.push({ field: 'reason', code: 'LV-E05' });
    if (reason.length > REASON_MAX) errors.push({ field: 'reason', code: 'LV-E06' });
    return errors;
  }

  // Part is only selectable on a single day; across days it is always full.
  function normalizePart(from, to, part) {
    return from && from === to && PARTS[part] ? part : 'full';
  }

  const api = { TYPES, PARTS, STATUS, REASON_MAX, MESSAGES, message, parseDate, toDateString, workingDays, formatDays, validate, normalizePart };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Leave = api;
})(typeof window !== 'undefined' ? window : globalThis);
