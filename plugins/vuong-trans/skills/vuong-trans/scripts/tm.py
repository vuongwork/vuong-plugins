"""Translation memory (TM) per project: reuse earlier translations so a new version of a document only pays for new strings.

Measured on real decks/workbooks: the next version re-used 94-98 % of its characters (two deck versions, an
estimate workbook v2.0->v2.1) and a sibling file 45-48 %.

Storage: <vt_data>/projects/<project>/tm/<target>.json = {source: [{"t": translation, "file": doc, "ctx": context, "n": uses, "date": ...}]}
plus <project>/glossary_<target>.md and keep.txt (so the proper-noun table is not rebuilt every time).

Polysemy (one source, several meanings) — a translation is re-used automatically ONLY when all of these hold:
  1. exact match of the WHOLE string (paragraph / cell), never word by word;
  2. the source is longer than SHORT (4) characters — short labels are where meanings change with context;
  3. the project's TM holds exactly ONE distinct translation for it (two or more = context-dependent);
  4. same project only (another customer may use the term differently).
Everything else that the TM knows goes to the translators as a HINT ({source: [{t, file, ctx}]}): reuse the earlier
translation unless this document's context needs another meaning; a different choice is stored as a new variant, so
the string becomes "context-dependent" for later runs. Saving the SAME document again replaces its own entry
(a correction, not a new meaning).

CLI:
  tm.py project <source file>                          print the default project name for a file
  tm.py save   --project P --target vi --maps "GLOB" --file NAME [--ctx "1 line"] [--work WORKDIR]
  tm.py forget --project P --target vi --match REGEX   drop entries whose source or translation matches (term changed)
  tm.py stats  --project P --target vi
Lookup is done by extract.py / pdf_extract.py (--project) through split().
"""
import argparse, datetime, glob, json, os, re, shutil, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import project_dir

SHORT = 4
_SKIP_DIRS = re.compile(r'^(?:\d[\d\-_.]*|VN|EN|JP|input|output|from.*|to.*|archive|old.*|research|requirements?|requriements|docs?)$', re.I)


def default_project(path):
    """Project name from the source path: nearest parent folder that is not a date / language / generic folder."""
    d = os.path.dirname(os.path.abspath(path))
    while True:
        name = os.path.basename(d)
        parent = os.path.dirname(d)
        if not name or parent == d:
            return 'default'
        if not _SKIP_DIRS.match(name):
            return name
        d = parent


def tm_path(project, target):
    return os.path.join(project_dir(project), 'tm', f'{target}.json')


def load(project, target):
    try:
        return json.load(open(tm_path(project, target), encoding='utf-8'))
    except FileNotFoundError:
        return {}


def split(strings, project, target):
    """-> (reuse {src: translation}, hints {src: [variants]}, todo [src...]). todo keeps the input order and
    includes the hinted strings (they still go to translators, with the hint)."""
    tm = load(project, target)
    reuse, hints, todo = {}, {}, []
    for s in strings:
        variants = tm.get(s)
        distinct = list(dict.fromkeys(v['t'] for v in variants)) if variants else []
        if len(distinct) == 1 and len(s.strip()) > SHORT:
            reuse[s] = distinct[0]
            continue
        if variants:
            hints[s] = [{k: v[k] for k in ('t', 'file', 'ctx') if v.get(k)} for v in variants]
        todo.append(s)
    return reuse, hints, todo


def write_lookup(workdir, lang, reuse, hints):
    """reuse -> <lang>_chunk_0_tm.json (picked up by the same --maps glob as the translators' files); hints -> tm_hints.json."""
    if reuse:
        json.dump(reuse, open(os.path.join(workdir, f'{lang}_chunk_0_tm.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    if hints:
        json.dump(hints, open(os.path.join(workdir, 'tm_hints.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=0)


def restore_glossary(project, target, workdir):
    """Copy the project's saved glossary / keep.txt into a fresh work dir (never overwrites files already there)."""
    pd, got = project_dir(project), []
    for src, dst in ((f'glossary_{target}.md', 'glossary.md'), ('keep.txt', 'keep.txt')):
        s, d = os.path.join(pd, src), os.path.join(workdir, dst)
        if os.path.exists(s) and not os.path.exists(d):
            shutil.copyfile(s, d)
            got.append(dst)
    return got


def _write(project, target, tm):
    p = tm_path(project, target)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    json.dump(tm, open(p + '.tmp', 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    os.replace(p + '.tmp', p)


def save(project, target, maps, file, ctx=None, workdir=None):
    tm = load(project, target)
    today = datetime.date.today().isoformat()
    added = variants = corrected = 0
    for f in sorted(glob.glob(maps)):
        if f.endswith('_tm.json'):                   # re-used entries: just count the use
            for s, t in json.load(open(f, encoding='utf-8')).items():
                for v in tm.get(s, []):
                    if v['t'] == t:
                        v['n'] = v.get('n', 1) + 1
            continue
        for s, t in json.load(open(f, encoding='utf-8')).items():
            if '|' in s and re.match(r'^d\d+\|\d+\|', s):     # PDF page-specific override key: store the plain text
                s = s.split('|', 2)[2]
            lst = tm.setdefault(s, [])
            hit = next((v for v in lst if v['t'] == t), None)
            if hit:
                hit['n'] = hit.get('n', 1) + 1
                hit['date'] = today
                continue
            same_doc = next((v for v in lst if file and v.get('file') == file), None)
            if same_doc:                                # one document has one translation per string: a re-save
                same_doc.update(t=t, ctx=ctx or same_doc.get('ctx', ''), date=today)   # of it is a correction
                corrected += 1
                continue
            if lst:
                variants += 1
            else:
                added += 1
            lst.append({'t': t, 'file': file, 'ctx': ctx or '', 'n': 1, 'date': today})
    _write(project, target, tm)
    if workdir:
        pd = project_dir(project)
        for src, dst in (('glossary.md', f'glossary_{target}.md'), ('keep.txt', 'keep.txt')):
            if os.path.exists(os.path.join(workdir, src)):
                shutil.copyfile(os.path.join(workdir, src), os.path.join(pd, dst))
    ctxdep = sum(len({v['t'] for v in l}) > 1 for l in tm.values())
    print(f'TM {tm_path(project, target)}: {len(tm)} sources (+{added} new, +{variants} new meanings, {corrected} corrected); '
          f'{ctxdep} context-dependent (>1 translation)')


def forget(project, target, pattern):
    tm, rx = load(project, target), re.compile(pattern)
    out = {}
    for s, lst in tm.items():
        if rx.search(s):
            continue
        keep = [v for v in lst if not rx.search(v['t'])]
        if keep:
            out[s] = keep
    _write(project, target, out)
    print(f'removed {len(tm) - len(out)} source(s) / their translations matching {pattern!r}')


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('cmd', choices=['project', 'save', 'forget', 'stats'])
    ap.add_argument('path', nargs='?')
    ap.add_argument('--project'); ap.add_argument('--target', choices=['vi', 'en', 'ja'])
    ap.add_argument('--maps'); ap.add_argument('--file'); ap.add_argument('--ctx'); ap.add_argument('--work')
    ap.add_argument('--match')
    a = ap.parse_args()
    if a.cmd == 'project':
        print(default_project(a.path))
    elif a.cmd == 'save':
        save(a.project, a.target, a.maps, a.file or '', a.ctx, a.work)
    elif a.cmd == 'forget':
        forget(a.project, a.target, a.match)
    else:
        tm = load(a.project, a.target)
        print(f'{tm_path(a.project, a.target)}: {len(tm)} sources, '
              f'{sum(len({v["t"] for v in l}) > 1 for l in tm.values())} context-dependent')


if __name__ == '__main__':
    main()
