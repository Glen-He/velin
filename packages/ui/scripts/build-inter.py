"""生成 Inter 西文 WOFF2 子集；普通应用构建无需 Python 或联网。"""

import argparse
import hashlib
import io
import json
from pathlib import Path
import urllib.request
import zipfile

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'fonts'
UPSTREAM = 'https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip'
SOURCE_HASH = '9883fdd4a49d4fb66bd8177ba6625ef9a64aa45899767dde3d36aa425756b11e'
# 西文、组合重音、常用标点与货币符号；汉字和全角标点继续由中文字体承担。
RANGES = [(0x0000, 0x024F), (0x0300, 0x036F), (0x1E00, 0x1EFF),
          (0x2000, 0x206F), (0x20A0, 0x20CF), (0x2122, 0x2122)]


def unicode_ranges(points):
    runs = []
    for point in sorted(points):
        if runs and runs[-1][1] + 1 == point:
            runs[-1][1] = point
        else:
            runs.append([point, point])
    return ','.join(f'U+{a:X}' if a == b else f'U+{a:X}-{b:X}' for a, b in runs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, help='已下载的官方 Inter-4.1.zip')
    args = parser.parse_args()
    data = args.source.read_bytes() if args.source else urllib.request.urlopen(UPSTREAM, timeout=60).read()
    if hashlib.sha256(data).hexdigest() != SOURCE_HASH:
        raise ValueError('Unexpected upstream font checksum')
    archive = zipfile.ZipFile(io.BytesIO(data))
    license_text = archive.read('LICENSE.txt').decode('utf-8')
    (OUTPUT / 'INTER-LICENSE.txt').write_text(license_text)
    css = ['/* 由 scripts/build-inter.py 生成；Inter 4.1 西文子集遵循 OFL 1.1。 */']
    manifest = {'upstream': UPSTREAM, 'sourceSha256': SOURCE_HASH,
                'family': 'Velin Inter', 'weight': [400, 700],
                'opticalSize': [14, 32], 'subsets': []}
    for style, source in [('normal', 'web/InterVariable.woff2'),
                          ('italic', 'web/InterVariable-Italic.woff2')]:
        font = TTFont(io.BytesIO(archive.read(source)), recalcTimestamp=False)
        for record in font['name'].names:
            if record.nameID == 13:
                record.string = license_text.encode(record.getEncoding())
            elif record.nameID in (1, 3, 4, 6, 16, 25):
                # 正体和斜体保留独立 PostScript / unique 名称，诊断与字体工具可准确识别。
                prefix = 'VelinInterItalic' if style == 'italic' else 'VelinInter'
                value = prefix if record.nameID in (3, 6, 25) else 'Velin Inter'
                if record.nameID == 4 and style == 'italic':
                    value += ' Italic'
                record.string = value.encode(record.getEncoding())
        # 内部名称与实例名称一并更新；不把裁剪后的字体伪装成原始完整发行版。
        for instance in font['fvar'].instances:
            if instance.postscriptNameID != 0xFFFF:
                for record in font['name'].names:
                    if record.nameID == instance.postscriptNameID:
                        value = 'VelinInter-' + record.toUnicode().split('-')[-1]
                        record.string = value.encode(record.getEncoding())
        points = {point for point in font.getBestCmap()
                  if any(start <= point <= end for start, end in RANGES)}
        options = subset.Options()
        options.layout_features = ['*']
        options.name_IDs = ['*']
        options.name_languages = ['*']
        options.name_legacy = True
        worker = subset.Subsetter(options=options)
        worker.populate(unicodes=points)
        worker.subset(font)
        # 保留真实斜体与全部光学尺寸，仅裁掉产品不用的极细 / 极粗字重。
        instantiateVariableFont(font, {'wght': (400, 400, 700)}, inplace=True)
        font.flavor = 'woff2'
        buffer = io.BytesIO()
        font.save(buffer)
        binary = buffer.getvalue()
        digest = hashlib.sha256(binary).hexdigest()
        filename = f'inter-latin-{style}-{digest[:12]}.woff2'
        (OUTPUT / filename).write_bytes(binary)
        ranges = unicode_ranges(points)
        css.append(f'''@font-face {{
  font-family: 'Velin Inter';
  font-style: {style};
  font-weight: 400 700;
  font-display: swap;
  src: url('../fonts/{filename}') format('woff2');
  unicode-range: {ranges};
}}''')
        manifest['subsets'].append({'file': filename, 'style': style,
                                    'sha256': digest, 'bytes': len(binary),
                                    'unicodeRange': ranges})
        print(f'{style}: {len(binary)} bytes', flush=True)
    keep = {part['file'] for part in manifest['subsets']}
    for old in OUTPUT.glob('inter-latin-*.woff2'):
        if old.name not in keep:
            old.unlink()
    (ROOT / 'src/latin-fonts.css').write_text('\n\n'.join(css) + '\n')
    (OUTPUT / 'inter-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')


if __name__ == '__main__':
    main()
