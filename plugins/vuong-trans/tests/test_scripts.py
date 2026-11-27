"""Regression tests for vuong-trans scripts. Synthetic files only (no customer documents).

Run:  python3 -m unittest discover -s tests -v      (from the plugin folder; needs python-pptx, lxml, Pillow, openpyxl)
"""
import io, json, os, re, shutil, subprocess, sys, tempfile, unittest, zipfile

SK = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'skills', 'vuong-trans', 'scripts')
sys.path.insert(0, SK)


def run(*args):
    r = subprocess.run([sys.executable, *args], capture_output=True, text=True, encoding='utf-8')
    return r


class Tmp(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp(prefix='vt_test_')
        self.addCleanup(shutil.rmtree, self.d, True)
        os.environ['VTRANS_DATA'] = os.path.join(self.d, 'data')

    def p(self, *n):
        return os.path.join(self.d, *n)


class XlsxTests(Tmp):
    def test_sheet_rename_does_not_touch_longer_sheet_name(self):
        import openpyxl
        wb = openpyxl.Workbook()
        ws = wb.active; ws.title = '一覧'; ws['A1'] = '見出し'
        w2 = wb.create_sheet('機能一覧'); w2['A1'] = '項目'
        ws['B1'] = '=機能一覧!A1'; ws['C1'] = '=一覧!A1'; ws['D1'] = "='機能一覧'!A1&一覧!A1"
        wb.save(self.p('in.xlsx'))
        json.dump({'一覧': 'List', '機能一覧': 'FuncList', '見出し': 'Heading', '項目': 'Item'},
                  open(self.p('m.json'), 'w', encoding='utf-8'), ensure_ascii=False)
        r = run(f'{SK}/apply_xlsx.py', self.p('in.xlsx'), '--maps', self.p('m.json'), '--out', self.p('out.xlsx'), '--target', 'en')
        self.assertEqual(r.returncode, 0, r.stderr)
        f = re.findall(r'<f>(.*?)</f>', zipfile.ZipFile(self.p('out.xlsx')).read('xl/worksheets/sheet1.xml').decode())
        self.assertEqual(f, ["'FuncList'!A1", "'List'!A1", "'FuncList'!A1&amp;'List'!A1"])

    def test_formula_literals_are_decoded(self):
        import openpyxl
        from extract import xlsx_formula_literals
        wb = openpyxl.Workbook(); ws = wb.active
        ws['A1'] = '【HTアプリ】'; ws['B1'] = '=IF(A1="【HTアプリ】","x","y")'
        wb.save(self.p('lit.xlsx'))
        self.assertIn('【HTアプリ】', xlsx_formula_literals(self.p('lit.xlsx')))
        self.assertFalse(any('&#' in x for x in xlsx_formula_literals(self.p('lit.xlsx'))))

    def test_loc_map(self):
        import openpyxl
        from extract import xlsx_locations
        wb = openpyxl.Workbook(); ws = wb.active; ws.title = '概要'; ws['C5'] = '入荷検品'
        wb.save(self.p('loc.xlsx'))
        loc = xlsx_locations(self.p('loc.xlsx'))
        self.assertEqual(loc['入荷検品'][0]['cell'], 'C5')
        self.assertEqual(loc['入荷検品'][0]['sheet'], '概要')
        self.assertEqual(loc['概要'][0]['kind'], 'sheetname')


class PptxTests(Tmp):
    def test_line_break_round_trip(self):
        from pptx import Presentation
        from pptx.util import Inches
        from extract import pptx_strings
        prs = Presentation(); s = prs.slides.add_slide(prs.slide_layouts[6])
        p = s.shapes.add_textbox(Inches(1), Inches(1), Inches(4), Inches(1)).text_frame.paragraphs[0]
        p.add_run().text = '入荷検品'; p.add_line_break(); p.add_run().text = '出荷検品'
        prs.save(self.p('br.pptx'))
        self.assertEqual(list(pptx_strings(self.p('br.pptx'))), ['入荷検品\n出荷検品'])
        json.dump({'入荷検品\n出荷検品': 'Receiving inspection\nShipping inspection'}, open(self.p('m.json'), 'w'))
        r = run(f'{SK}/apply_pptx.py', self.p('br.pptx'), '--maps', self.p('m.json'), '--out', self.p('o.pptx'), '--target', 'en')
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(list(pptx_strings(self.p('o.pptx'))), ['Receiving inspection\nShipping inspection'])

    def test_master_text_box_is_translated(self):
        from pptx import Presentation
        from pptx.util import Inches
        from extract import pptx_strings
        prs = Presentation()
        sl = prs.slides.add_slide(prs.slide_layouts[6])
        tb = sl.shapes.add_textbox(Inches(0), Inches(0), Inches(3), Inches(1))
        tb.text_frame.text = '整理番号'
        prs.slide_master.shapes._spTree.append(tb._element)          # python-pptx cannot add to a master directly
        prs.save(self.p('m.pptx'))
        self.assertIn('整理番号', list(pptx_strings(self.p('m.pptx'))))
        json.dump({'整理番号': 'Reference No.'}, open(self.p('m.json'), 'w', encoding='utf-8'), ensure_ascii=False)
        run(f'{SK}/apply_pptx.py', self.p('m.pptx'), '--maps', self.p('m.json'), '--out', self.p('o.pptx'), '--target', 'en')
        self.assertIn('Reference No.', list(pptx_strings(self.p('o.pptx'))))
        self.assertNotIn('整理番号', list(pptx_strings(self.p('o.pptx'))))

    def test_master_text_in_other_language_is_left_alone(self):
        from pptx import Presentation
        from pptx.util import Inches
        from extract import pptx_strings
        prs = Presentation()
        sl = prs.slides.add_slide(prs.slide_layouts[6])
        sl.shapes.add_textbox(Inches(1), Inches(3), Inches(3), Inches(1)).text_frame.text = '入荷検品の流れ'
        for t in ('整理番号', 'Copyright © Example Corp. All rights reserved.'):     # deck template: one JA, one EN
            tb = sl.shapes.add_textbox(Inches(0), Inches(0), Inches(3), Inches(1))
            tb.text_frame.text = t
            prs.slide_master.shapes._spTree.append(tb._element)
        prs.save(self.p('t.pptx'))
        got = list(pptx_strings(self.p('t.pptx')))
        self.assertIn('整理番号', got)
        self.assertNotIn('Copyright © Example Corp. All rights reserved.', got)

    def test_extract_images_dedup_icons_and_meta(self):
        from pptx import Presentation
        from pptx.util import Inches
        from PIL import Image
        Image.new('RGB', (400, 300), 'white').save(self.p('big.png'))
        Image.new('RGB', (32, 32), 'red').save(self.p('icon.png'))
        prs = Presentation()
        for _ in range(2):                                   # same picture on two slides, placed small (5 % width)
            s = prs.slides.add_slide(prs.slide_layouts[6])
            s.shapes.add_picture(self.p('big.png'), Inches(1), Inches(1), width=Inches(0.5))
            s.shapes.add_picture(self.p('icon.png'), Inches(3), Inches(1))
        prs.save(self.p('img.pptx'))
        r = run(f'{SK}/extract_images.py', self.p('img.pptx'), '--out', self.p('img'))
        self.assertEqual(r.returncode, 0, r.stderr)
        meta = json.load(open(self.p('img', 'meta.json')))
        self.assertEqual([m['name'] for m in meta], ['s001_1', 's002_1'])      # small-on-slide picture kept, icons skipped
        self.assertEqual(meta[1].get('dup_of'), 's001_1')
        self.assertFalse(os.path.exists(self.p('img', 's002_1.png')))


class TmTests(Tmp):
    def test_polysemy_rules(self):
        import tm
        long_s = '入荷検品を実施する'
        tm._write('P', 'vi', {
            long_s: [{'t': 'Thực hiện receiving inspection', 'file': 'a'}],
            '対象': [{'t': 'Đối tượng', 'file': 'a'}],                                  # short -> hint only
            '表示する画面': [{'t': 'Màn hình hiển thị', 'file': 'a'}, {'t': 'Hiển thị màn hình', 'file': 'b'}],  # 2 meanings
        })
        reuse, hints, todo = tm.split([long_s, '対象', '表示する画面', '新規'], 'P', 'vi')
        self.assertEqual(reuse, {long_s: 'Thực hiện receiving inspection'})
        self.assertEqual(set(hints), {'対象', '表示する画面'})
        self.assertEqual(todo, ['対象', '表示する画面', '新規'])
        self.assertEqual(tm.split([long_s], 'OTHER', 'vi')[0], {})                     # other project: nothing

    def test_save_new_meaning_vs_correction(self):
        import tm
        json.dump({'在庫を確認する': 'Kiểm tra tồn kho'}, open(self.p('vi_chunk_1.json'), 'w', encoding='utf-8'), ensure_ascii=False)
        tm.save('P', 'vi', self.p('vi_chunk_*.json'), 'doc1')
        json.dump({'在庫を確認する': 'Xác nhận tồn kho'}, open(self.p('vi_chunk_1.json'), 'w', encoding='utf-8'), ensure_ascii=False)
        tm.save('P', 'vi', self.p('vi_chunk_*.json'), 'doc1')                         # same doc -> correction
        self.assertEqual([v['t'] for v in tm.load('P', 'vi')['在庫を確認する']], ['Xác nhận tồn kho'])
        json.dump({'在庫を確認する': 'Đối chiếu tồn kho'}, open(self.p('vi_chunk_1.json'), 'w', encoding='utf-8'), ensure_ascii=False)
        tm.save('P', 'vi', self.p('vi_chunk_*.json'), 'doc2')                         # other doc -> new meaning
        self.assertEqual(len(tm.load('P', 'vi')['在庫を確認する']), 2)
        self.assertIn('在庫を確認する', tm.split(['在庫を確認する'], 'P', 'vi')[1])

    def test_extract_with_project_skips_known_strings(self):
        import openpyxl, tm
        wb = openpyxl.Workbook(); ws = wb.active; ws.title = '一覧'; ws['A1'] = '入荷検品を実施する'; ws['A2'] = '新しい要件の説明'
        wb.save(self.p('t.xlsx'))
        tm._write('P', 'vi', {'入荷検品を実施する': [{'t': 'Thực hiện receiving inspection', 'file': 'a'}]})
        r = run(f'{SK}/extract.py', self.p('t.xlsx'), '--out', self.p('w'), '--target', 'vi', '--project', 'P')
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.load(open(self.p('w', 'chunk_1.json'), encoding='utf-8')), ['新しい要件の説明', '一覧'])
        self.assertIn('入荷検品を実施する', json.load(open(self.p('w', 'vi_chunk_0_tm.json'), encoding='utf-8')))

    def test_default_project_skips_date_and_language_folders(self):
        import tm
        self.assertEqual(tm.default_project('/x/AcmeCorp/26-10-2026/a.pptx'), 'AcmeCorp')
        self.assertEqual(tm.default_project('/x/Beta_Demo/VN/a.pptx'), 'Beta_Demo')


class EntityTests(Tmp):
    def test_generic_words_filtered_names_kept(self):
        from find_entities import candidates
        g, latin, _ = candidates(['業務グループ', '仕様は同様です', '様式A', '患者様', 'ABC金属様の倉庫', 'XYZ Co., Ltd',
                                  'contact@acme.co.jp', 'MFA必須', 'Zeta様担当'])
        self.assertEqual(set(g['STRONG']), {'ABC金属', 'Zeta'})
        self.assertIn('XYZ Co., Ltd', g['EN'])
        self.assertIn('acme', g['DOMAIN'])
        self.assertNotIn('MFA', latin)
        self.assertIn('Zeta', latin)


class ImageGateTests(Tmp):
    def test_one_real_label_passes_ocr_noise_does_not(self):
        from langcheck import worth_translating
        box = lambda t, c: {'text': t, 'conf': c, 'src': True}
        self.assertTrue(worth_translating([box('倉庫', 0.9)]))                  # single real label
        self.assertFalse(worth_translating([box('鷺', 0.0)]))                   # noise seen on a sample deck
        self.assertFalse(worth_translating([box('井', 0.9)]))                   # one kanji
        self.assertFalse(worth_translating([box('く〉', 0.51)]))
        self.assertTrue(worth_translating([box('a', 0.1), box('b', 0.1)]))     # >= 2 boxes as before


class ContactSheetTests(Tmp):
    def test_one_sheet_per_36_images(self):
        from PIL import Image
        from contact import sheets
        items = []
        for i in range(40):
            Image.new('RGB', (300 + i, 200), 'white').save(self.p(f'i{i}.png'))
            items.append((f'i{i}', self.p(f'i{i}.png')))
        pages = sheets(items, self.p('skipped'))
        self.assertEqual(len(pages), 2)
        self.assertEqual(Image.open(pages[0]).size[0], 1536)


class RunlogTests(Tmp):
    def test_report_counts_time_tokens_and_tm(self):
        os.makedirs(self.p('w'))
        json.dump(['入荷検品を実施する', '新規'], open(self.p('w', 'src.json'), 'w', encoding='utf-8'), ensure_ascii=False)
        json.dump(['新規'], open(self.p('w', 'chunk_1.json'), 'w', encoding='utf-8'), ensure_ascii=False)
        json.dump({'入荷検品を実施する': 'x'}, open(self.p('w', 'vi_chunk_0_tm.json'), 'w', encoding='utf-8'), ensure_ascii=False)
        r = run(f'{SK}/runlog.py', 'agent', self.p('w'), '--name', 'chunk_1', '--tokens', '1000', '--ms', '5000')
        self.assertEqual(r.returncode, 0, r.stderr)
        out = run(f'{SK}/runlog.py', 'report', self.p('w'), '--usd-per-mtok', '10').stdout
        self.assertIn('1,000 token', out)
        self.assertIn('0.01 USD', out)
        self.assertIn('bớt 82 %', out)            # 2 of 11 chars sent


class OverlayTests(Tmp):
    def test_check_sheet_is_smaller_than_output(self):
        from PIL import Image
        os.makedirs(self.p('img'))
        Image.new('RGB', (800, 600), 'white').save(self.p('img', 'a.png'))
        json.dump([{'box': [10, 10, 120, 40], 'text': 'Xin chào'}], open(self.p('img', 'vi_a.json'), 'w', encoding='utf-8'), ensure_ascii=False)
        r = run(f'{SK}/overlay.py', self.p('img'), '--lang', 'vi', 'a')
        if 'no font found' in r.stdout + r.stderr:
            self.skipTest('no Noto/DejaVu font on this machine')
        self.assertEqual(r.returncode, 0, r.stderr)
        out = Image.open(self.p('img', 'out', 'a.png')).size
        chk = Image.open(self.p('img', 'out', 'check_a.png')).size
        self.assertLess(chk[0] * chk[1], out[0] * out[1] * 0.2)


if __name__ == '__main__':
    unittest.main()
