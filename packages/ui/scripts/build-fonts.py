"""生成可复现的中文 WOFF2 子集；普通应用构建无需 Python 或联网。"""

import argparse
import copy
from concurrent.futures import ProcessPoolExecutor
import hashlib
import io
import json
from pathlib import Path
import urllib.request

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'fonts'
UPSTREAM = 'https://raw.githubusercontent.com/adobe-fonts/source-han-sans/2.005R/Variable/WOFF2/TTF/SourceHanSansSC-VF.ttf.woff2'
SOURCE_HASH = 'cfec773cdc2ea964de8713471c6fd20774bc40617f5567f92efeeccaca6604b0'
RANGES = [(0x2000, 0x206F), (0x2E80, 0x31FF), (0x3400, 0x9FFF),
          (0xF900, 0xFAFF), (0xFE10, 0xFE1F), (0xFE30, 0xFE4F),
          (0xFF00, 0xFFEF), (0x20000, 0x323AF)]


def unicode_ranges(points):
    runs = []
    for point in sorted(points):
        if runs and runs[-1][1] + 1 == point:
            runs[-1][1] = point
        else:
            runs.append([point, point])
    return ','.join(f'U+{a:X}' if a == b else f'U+{a:X}-{b:X}' for a, b in runs)


FONT = None

def prepare_worker(data):
    global FONT
    FONT = TTFont(io.BytesIO(data), recalcTimestamp=False)

def build_subset(group):
    label, chars = group
    part = copy.deepcopy(FONT)
    options = subset.Options()
    options.layout_features = ['*']
    options.name_IDs = ['*']
    options.name_languages = ['*']
    options.name_legacy = True
    worker = subset.Subsetter(options=options)
    worker.populate(unicodes=chars)
    worker.subset(part)
    # 在小子集上裁掉产品不用的极细 / 极粗 masters，保留实际的连续 400–700 字重。
    instantiateVariableFont(part, {'wght': (400, 400, 700)}, inplace=True)
    part.flavor = 'woff2'
    buffer = io.BytesIO()
    part.save(buffer)
    binary = buffer.getvalue()
    digest = hashlib.sha256(binary).hexdigest()
    filename = f'han-sans-{label}-{digest[:12]}.woff2'
    (OUTPUT / filename).write_bytes(binary)
    ranges = unicode_ranges(chars)
    return label, filename, digest, len(binary), ranges


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, help='已下载的官方 WOFF2 文件')
    args = parser.parse_args()
    data = args.source.read_bytes() if args.source else urllib.request.urlopen(UPSTREAM, timeout=60).read()
    if hashlib.sha256(data).hexdigest() != SOURCE_HASH:
        raise ValueError('Unexpected upstream font checksum')
    font = TTFont(io.BytesIO(data), recalcTimestamp=False)
    # 保留官方可变字重与字形；CSS 只声明产品使用的区间，并在每份文件嵌入完整授权。
    license_text = (OUTPUT / 'LICENSE.txt').read_text()
    for record in font['name'].names:
        if record.nameID == 13:
            record.string = license_text.encode(record.getEncoding())
    for record in font['name'].names:
        if record.nameID in (1, 3, 4, 6, 16, 25) or record.nameID >= 265:
            value = 'VelinHanSans' if record.nameID in (3, 6, 25) or record.nameID >= 265 else 'Velin Han Sans'
            record.string = value.encode(record.getEncoding())
    points = {point for point in font.getBestCmap()
              if any(start <= point <= end for start, end in RANGES)}
    common = points & {ord(char) for char in (OUTPUT / 'common-characters.txt').read_text()}
    # GB2312 一级字用于正文常见字缓存；不用按 Unicode 分片让一篇短文命中几十份文件。
    core = set()
    for lead in range(0xB0, 0xD8):
        for trail in range(0xA1, 0xFF):
            try:
                core.add(ord(bytes([lead, trail]).decode('gb2312')))
            except UnicodeDecodeError:
                pass
    core = (core & points) - common
    groups = [('common', common), ('reading', core)]
    remaining = sorted(points - common - core)
    # 每份最多 512 个字，字符范围互斥；罕见字也保留，不能只保留仓库里的文字。
    groups += [(f'{index // 512:03}', set(remaining[index:index + 512]))
               for index in range(0, len(remaining), 512)]
    css = ['/* 由 scripts/build-fonts.py 生成；字体来自 Adobe Source Han Sans SC 2.005，修改版遵循 OFL 1.1。 */']
    manifest = {'upstream': UPSTREAM, 'sourceSha256': SOURCE_HASH, 'family': 'Velin Han Sans',
                'weight': [400, 700], 'subsets': []}
    source = io.BytesIO()
    font.flavor = None
    font.save(source)
    with ProcessPoolExecutor(max_workers=4, initializer=prepare_worker,
                             initargs=(source.getvalue(),)) as pool:
        for label, filename, digest, size, ranges in pool.map(build_subset, groups):
            css.append(f'''@font-face {{
  font-family: 'Velin Han Sans';
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url('./fonts/{filename}') format('woff2');
  unicode-range: {ranges};
}}''')
            manifest['subsets'].append({'file': filename, 'sha256': digest, 'bytes': size,
                                        'unicodeRange': ranges})
            print(f'{label}: {size} bytes', flush=True)
    keep = {part['file'] for part in manifest['subsets']}
    for old in OUTPUT.glob('han-sans-*.woff2'):
        if old.name not in keep:
            old.unlink()
    # CSS 位于 src，资源与授权位于共享包；两端 bundler 自动生成各自的带哈希 URL。
    (ROOT / 'src/chinese-fonts.css').write_text('\n\n'.join(css).replace("./fonts/", "../fonts/") + '\n')
    (OUTPUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(f'Total: {sum(part["bytes"] for part in manifest["subsets"])} bytes')


if __name__ == '__main__':
    main()
