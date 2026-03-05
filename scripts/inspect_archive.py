from pathlib import Path
import re

archive = Path('plc-version-platform-demo.rar')
if not archive.exists():
    raise SystemExit('archive not found')

b = archive.read_bytes()
print('size_bytes:', len(b))
print('header:', b[:8])
if b.startswith(b'Rar!\x1a\x07\x01\x00'):
    print('format: RAR5')

paths = set()
for s in re.findall(rb'[ -~]{10,}', b):
    t = s.decode('latin1', 'ignore')
    if 'plc-version-platform-demo/' in t and '.' in t:
        idx = t.find('plc-version-platform-demo/')
        t = t[idx:]
        if len(t) < 200:
            paths.add(t)

try:
    for p in sorted(paths):
        if p.count('/') <= 3:
            print(p)
except BrokenPipeError:
    pass
