"""docs/index.html, docs/admin.html 만들기. 사용: python3 src/build.py [API주소]"""
import base64, json, pathlib, sys
R = pathlib.Path(__file__).resolve().parent.parent
A = R / 'src' / 'assets'
SITE = 'https://deanlee1113.github.io/nakmat-bass-rank/'
API = (sys.argv[1] if len(sys.argv) > 1 else '').rstrip('/')
b64 = lambda p, mime: f'data:{mime};base64,' + base64.b64encode(p.read_bytes()).decode()
page = (R / 'src' / 'page.tpl.html').read_text(encoding='utf-8')
page = (page.replace('__DATA__', (A / 'rank_data.json').read_text(encoding='utf-8'))
            .replace('__LUNKER__', (A / 'lunker_meta.json').read_text(encoding='utf-8'))
            .replace('__LOGO__', b64(A / 'logo_white.png', 'image/png'))
            .replace('__STICKER__', b64(A / 'bass_sticker.webp', 'image/webp'))
            .replace('__SITE__', SITE).replace('__API__', API))
admin = (R / 'src' / 'admin.tpl.html').read_text(encoding='utf-8').replace('__API__', API)
for name, html in (('index.html', page), ('admin.html', admin)):
    assert '__' not in ''.join(t for t in html.split('"') if t.startswith('__') and t.endswith('__')), name
    (R / 'docs' / name).write_text(html, encoding='utf-8')
print('built', len(page), 'bytes; api =', API or '(none)')
