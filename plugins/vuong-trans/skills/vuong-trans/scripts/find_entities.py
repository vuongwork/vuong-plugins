#!/usr/bin/env python3
"""List proper-noun candidates (company/site/person names) from src.json for the glossary step.
Output is grouped: STRONG (explicit company/site markers) first, then LATIN+JA (e.g. ABC金属…, usually a
company name followed by ordinary words — trim to the name when building the glossary), plain katakana names (e.g. 〇〇ン) are only caught via 様/社 — skim the cover slide for others."""
import json, re, sys
from collections import Counter

J = r'一-鿿ァ-ヿー'
# Tech acronyms that are not names when glued to Japanese (AMR搬送, LAN配線…)
TECH = set('AC AGV AMR API CDC CPU CSV DB DC EDI ERP HT ID IO IT LAN MES OS PC PLC QR RCS RFID SS UI USB WCS WES WMS WIFI'.split())
NOT_NAME = ('仕', '客', '同', '多', '模', '各', '皆', '有')
GROUPS = [
    ('STRONG', [
        rf'[{J}A-Za-z0-9]+(?=株式会社|\(株\)|（株）)',      # 〇〇株式会社
        rf'(?<=株式会社)[{J}A-Za-z0-9]+',                  # 株式会社〇〇
        rf'[{J}A-Za-z0-9]{{2,}}(?=様|殿|御中)',             # 〇〇様 (2+ chars; 仕様/同様… filtered below)
        rf'[{J}]+(?:工業|産業|商事|製作所|ホールディングス|グループ)',
        r'[一-鿿]{1,4}(?:工場|事業所|支店|営業所)',          # 〇〇工場
        r'[ァ-ヿー]{2,}社',                                # 〇〇社
    ]),
    ('LATIN+JA', [rf'\b([A-Za-z][A-Za-z0-9&.\-]*)\s*([一-鿿][{J}]*)']),   # ABC金属…
]
strings = json.load(open(sys.argv[1], encoding='utf-8'))
seen = set()
for name, pats in GROUPS:
    c = Counter()
    for s in strings:
        for p in pats:
            for m in re.finditer(p, s):
                if name == 'LATIN+JA':
                    if m.group(1).upper() in TECH or len(m.group(1)) < 2:
                        continue
                    k = m.group(1) + m.group(2)
                else:
                    k = m.group(0)
                    if k.endswith(NOT_NAME):   # 〇〇仕様, お客様, 同様…
                        continue
                c[k.strip()] += 1
    rows = [(k, n) for k, n in c.most_common() if k not in seen]
    if rows:
        print(f'## {name}')
        for k, n in rows:
            seen.add(k)
            print(f'{n}\t{k}')
