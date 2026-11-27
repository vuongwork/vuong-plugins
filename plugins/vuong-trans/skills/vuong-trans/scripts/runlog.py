#!/usr/bin/env python3
"""Run statistics for the final report: time, model cost, effectiveness.

Scripts call `track(dir, step)` once after parsing arguments; the elapsed time is appended to <dir>/run.jsonl when the
script exits (exit code included). Model work is invisible to scripts, so the main session records every subagent
from the usage line of its result (total tokens, duration):

  python3 runlog.py agent $W --step text --name chunk_1 --tokens 41234 --ms 183000
  python3 runlog.py report $W [--usd-per-mtok 6.0]          # table for the user; USD only when a price is given

Effectiveness numbers are read from the work files themselves (src.json, chunk_*.json, *_chunk_0_tm.json,
img*/meta.json + todo.json, check*.json), so the counting rules live here only.
"""
import argparse, atexit, glob, json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: F401  (UTF-8 stdout on Windows)


def _append(d, rec):
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, 'run.jsonl'), 'a', encoding='utf-8') as f:
        f.write(json.dumps(rec, ensure_ascii=False) + '\n')


def track(d, step):
    """Time this script run; written to <d>/run.jsonl at exit. Never lets logging break the script."""
    t0, code = time.time(), {'v': 0}
    real_exit, real_hook = sys.exit, sys.excepthook

    def _exit(c=0):
        code['v'] = c if isinstance(c, int) else 1
        real_exit(c)

    def _hook(*exc):
        code['v'] = 1
        real_hook(*exc)
    sys.exit, sys.excepthook = _exit, _hook

    def _write():
        try:
            _append(d, {'kind': 'script', 'step': step, 'sec': round(time.time() - t0, 1), 'start': round(t0),
                        'exit': code['v']})
        except OSError:
            pass
    atexit.register(_write)


def _load(w):
    recs = []
    for p in glob.glob(os.path.join(w, '**', 'run.jsonl'), recursive=True):
        recs += [json.loads(l) for l in open(p, encoding='utf-8') if l.strip()]
    return recs


def _j(p, default=None):
    try:
        return json.load(open(p, encoding='utf-8'))
    except (OSError, ValueError):
        return default


def effectiveness(w):
    out = {}
    src = _j(os.path.join(w, 'src.json'))
    if src is not None:
        todo = [s for p in glob.glob(os.path.join(w, 'chunk_*.json')) for s in _j(p, [])]
        reused = {k: v for p in glob.glob(os.path.join(w, '*_chunk_0_tm.json')) for k, v in _j(p, {}).items()}
        total = sum(map(len, src))
        out['text'] = {'unique': len(src), 'chars': total, 'sent': len(todo), 'sent_chars': sum(map(len, todo)),
                       'tm_reused': len(reused), 'tm_chars': sum(map(len, reused))}
    imgs = {'total': 0, 'dup': 0, 'missing': 0, 'ocr': 0, 'todo': 0}
    for meta in glob.glob(os.path.join(w, '**', 'meta.json'), recursive=True):
        m = _j(meta, [])
        if not isinstance(m, list):
            continue
        d = os.path.dirname(meta)
        imgs['total'] += len(m)
        imgs['dup'] += sum(1 for x in m if x.get('dup_of'))
        imgs['missing'] += sum(1 for x in m if x.get('missing'))
        imgs['ocr'] += len(glob.glob(os.path.join(d, 'ocr_*.json')))
        imgs['todo'] += len(_j(os.path.join(d, 'todo.json'), []))
    if imgs['total']:
        out['images'] = imgs
    checks = {}
    for p in glob.glob(os.path.join(w, 'check*.json')):
        c = _j(p, {})
        if isinstance(c, dict):
            for k in ('left', 'review', 'overflow', 'missing'):
                if isinstance(c.get(k), list):
                    checks[k] = checks.get(k, 0) + len(c[k])
    if checks:
        out['checks'] = checks
    return out


def report(w, usd_per_mtok=None):
    recs = _load(w)
    lines = ['| Bước | Loại | Số lần | Thời gian | Token |', '|---|---|---|---|---|']
    steps = {}
    for r in recs:
        k = (r['step'], r['kind'])
        s = steps.setdefault(k, {'n': 0, 'sec': 0.0, 'tok': 0, 'fail': 0})
        s['n'] += 1
        s['sec'] += r.get('sec', 0)
        s['tok'] += r.get('tokens', 0)
        s['fail'] += 1 if r.get('exit') else 0
    for (step, kind), s in steps.items():
        fail = f" ({s['fail']} lỗi)" if s['fail'] else ''
        tok_col = f"{s['tok']:,}" if kind == 'agent' else '–'
        lines.append(f"| {step} | {kind} | {s['n']}{fail} | {s['sec']:.0f}s | {tok_col} |")
    tok = sum(r.get('tokens', 0) for r in recs)
    script_sec = sum(r.get('sec', 0) for r in recs if r['kind'] == 'script')
    agent_sec = sum(r.get('sec', 0) for r in recs if r['kind'] == 'agent')
    ends = [r['start'] + r.get('sec', 0) for r in recs if 'start' in r]
    wall = (max(ends) - min(r['start'] for r in recs if 'start' in r)) if ends else 0
    lines += ['', f'Thời gian: {wall / 60:.1f} phút từ đầu đến cuối (script {script_sec:.0f}s, agent cộng dồn {agent_sec:.0f}s — '
                  'agent chạy song song nên cộng dồn > thời gian thực).',
              f'Chi phí model: {tok:,} token qua {sum(1 for r in recs if r["kind"] == "agent")} subagent'
              + (f' ≈ {tok / 1e6 * usd_per_mtok:.2f} USD (giá {usd_per_mtok} USD / 1M token do người dùng cung cấp)' if usd_per_mtok else
                 ' (chưa tính token của phiên chính).')]
    e = effectiveness(w)
    if 'text' in e:
        t = e['text']
        pct = 100 * (1 - t['sent_chars'] / t['chars']) if t['chars'] else 0
        lines.append(f"Chữ: {t['unique']:,} chuỗi duy nhất / {t['chars']:,} ký tự; gửi model {t['sent']:,} chuỗi / "
                     f"{t['sent_chars']:,} ký tự (bớt {pct:.0f} %); lấy từ TM {t['tm_reused']:,} chuỗi / {t['tm_chars']:,} ký tự.")
    if 'images' in e:
        i = e['images']
        lines.append(f"Ảnh: {i['total']} ảnh, trùng {i['dup']}, OCR {i['ocr']}, giao agent {i['todo']}"
                     + (f", không đọc được {i['missing']}" if i['missing'] else '') + '.')
    if 'checks' in e:
        c = e['checks']
        lines.append('Kiểm tra: ' + ', '.join(f'{k.upper()} {v}' for k, v in c.items()) + ' (LEFT/REVIEW phải = 0 hoặc đã được duyệt).')
    return '\n'.join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['agent', 'report'])
    ap.add_argument('work')
    ap.add_argument('--step', default='text')
    ap.add_argument('--name', default='')
    ap.add_argument('--tokens', type=int, default=0)
    ap.add_argument('--ms', type=int, default=0)
    ap.add_argument('--usd-per-mtok', type=float)
    a = ap.parse_args()
    if a.cmd == 'agent':
        _append(a.work, {'kind': 'agent', 'step': a.step, 'name': a.name, 'tokens': a.tokens, 'sec': round(a.ms / 1000, 1),
                         'start': round(time.time() - a.ms / 1000)})
    else:
        print(report(a.work, a.usd_per_mtok))


if __name__ == '__main__':
    main()
