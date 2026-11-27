#!/usr/bin/env python3
"""List proper-noun candidates (company / site / person names) from src.json for the glossary step.

Usage: find_entities.py WORKDIR/src.json [--plain]
  --plain  one candidate per line, no counts / groups (e.g. to seed a name list such as pii-words.txt).
Groups, strongest first:
  STRONG    explicit Japanese markers: 株式会社, (株), 〇〇様/殿/御中, 〇〇工業/産業/商事…, 〇〇工場/支店, 〇〇社
  EN        English company suffixes: X Co., Ltd / Inc / Corp / Pte. Ltd / JSC / LLC / K.K.
  DOMAIN    names inside e-mail addresses and URLs (contact@abc.co.jp -> abc)
  LATIN+JA  a Latin word glued to Japanese (ABC金属, Zeta様): grouped by the Latin word, with examples. Noisy by
            nature (14 % real names on 5 real samples) — scan it, don't trust it.
Plain katakana names without a marker are not caught — skim the cover / signature slides for those.
"""
import json, os, re, sys
from collections import Counter, defaultdict
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: F401  (UTF-8 stdout: the output is Japanese, Windows consoles default to cp1252)

J = r'一-鿿ァ-ヿー'
# Latin words that are technology / document vocabulary, not names, when glued to Japanese (AMR搬送, MFA必須…)
TECH = set('''AC AD AGV AI AMR API APP AWS AZ BE CART CD CDC CI CPU CSV DB DC DOC DOS EDI EOL ERP EXCEL FE GW HT HTTP HTTPS
ID IF IO IOS IT KMS KPI LAN LLM MES MFA NDA NO NULL OCR OS PC PDF PG PL PLC PR QA QR RCS RDS RFID RFP RTO SA SKU SLA SQL
SS SSL SV TLS UI UX URL USB VPN WCS WEB WES WIFI WMS ANDROID BLUETOOTH MARKDOWN APPENDIX GATEWAY LOTNO HANDY NON-AI
AS-IS TO-BE'''.split())
# Japanese words that end like a name but are generic (seen as false hits on real samples)
GENERIC_END = ('仕', '客', '同', '多', '模', '各', '皆', '有', '者', '企業', '会社', 'メンバー', 'チーム', '各位', '担当', '部門')
GENERIC_WORD = {'業務', '各', '現行', '開発', '運用', '管理', '全', '関連', '当', '弊', '御', '貴'}
STRONG = [
    rf'[{J}A-Za-z0-9]+(?=株式会社|\(株\)|（株）|有限会社)',      # 〇〇株式会社
    rf'(?<=株式会社|有限会社)[{J}A-Za-z0-9]+',                  # 株式会社〇〇
    rf'[{J}A-Za-z0-9]{{2,}}(?=(?:様|殿|御中)(?![式子相]))',     # 〇〇様 (not 様式 / 様子 / 様相)
    rf'[{J}]+(?:工業|産業|商事|製作所|ホールディングス|グループ)',
    r'[一-鿿]{1,4}(?:工場|事業所|支店|営業所)',
    r'[ァ-ヿー]{2,}社',
]
EN = re.compile(r"\b([A-Z][\w&.\-]*(?:\s+[A-Z][\w&.\-]*){0,4}),?\s+(?:Co\.,?\s*Ltd\.?|Company Limited|Corporation|Corp\.?"
                r"|Inc\.?|Pte\.?\s*Ltd\.?|Ltd\.?|LLC|JSC|K\.K\.|GmbH)(?![\w])")
DOMAIN = re.compile(r'[\w.+\-]+@([\w\-]+)\.|(?:https?://|www\.)(?:www\.)?([\w\-]+)\.')
LATIN_JA = re.compile(rf'\b([A-Za-z][A-Za-z0-9&.\-]*)\s*([一-鿿][{J}]*)')
COMMON_HOSTS = {'google', 'drive', 'docs', 'github', 'microsoft', 'youtube', 'gmail', 'outlook', 'example'}


def generic(name):
    core = re.sub(r'(?:工業|産業|商事|製作所|ホールディングス|グループ|工場|事業所|支店|営業所|社)$', '', name)
    return name.endswith(GENERIC_END) or core in GENERIC_WORD or not core


def candidates(strings):
    groups = {'STRONG': Counter(), 'EN': Counter(), 'DOMAIN': Counter()}
    latin, examples = Counter(), defaultdict(Counter)
    for s in strings:
        for p in STRONG:
            for m in re.finditer(p, s):
                k = m.group(0).strip('・')
                if not generic(k):
                    groups['STRONG'][k] += 1
        for m in EN.finditer(s):
            groups['EN'][m.group(0).strip()] += 1
        for m in DOMAIN.finditer(s):
            d = m.group(1) or m.group(2)
            if d and d.lower() not in COMMON_HOSTS:
                groups['DOMAIN'][d] += 1
        for m in LATIN_JA.finditer(s):
            w = m.group(1).rstrip('.')
            if len(w) < 2 or w.upper() in TECH or re.fullmatch(r'[A-Z]?\d+[A-Z]?|[A-Z]\d+', w):
                continue
            latin[w] += 1
            examples[w][w + m.group(2)] += 1
    return groups, latin, examples


def main():
    args = [x for x in sys.argv[1:] if not x.startswith('--')]
    plain = '--plain' in sys.argv
    groups, latin, examples = candidates(json.load(open(args[0], encoding='utf-8')))
    seen = set()
    for name, c in groups.items():
        rows = [(k, n) for k, n in c.most_common() if k not in seen]
        if rows and not plain:
            print(f'## {name}')
        for k, n in rows:
            seen.add(k)
            print(k if plain else f'{n}\t{k}')
    rows = [(w, n) for w, n in latin.most_common() if w not in seen]
    if rows and not plain:
        print('## LATIN+JA (grouped by the Latin word)')
    for w, n in rows:
        print(w if plain else f'{n}\t{w}\t' + ', '.join(e for e, _ in examples[w].most_common(3)))


if __name__ == '__main__':
    main()
