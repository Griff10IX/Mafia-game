"""Check if all lazy chunks in index.html exist on disk."""
import re
import os

html = open('/opt/mafia-app/build/index.html').read()
pairs = re.findall(r'(\d+):"([0-9a-f]{8})"', html)
missing = []
ok = 0
for sid, h in pairs[:150]:
    p = f'/opt/mafia-app/build/static/js/{sid}.{h}.chunk.js'
    if not os.path.isfile(p):
        missing.append(f'{sid}.{h}')
    else:
        ok += 1
print(f'Checked {len(pairs[:150])} lazy chunks: {ok} OK, {len(missing)} MISSING')
if missing:
    print('Missing:', missing[:30])

# Also check what CF might be serving
print()
print('index.html main chunk ref:', re.search(r'main\.([a-f0-9]+)\.chunk\.js', html).group(0) if re.search(r'main\.([a-f0-9]+)\.chunk\.js', html) else 'NOT FOUND')
print('Files on disk:')
for f in os.listdir('/opt/mafia-app/build/static/js'):
    if f.startswith('main.') and f.endswith('.chunk.js'):
        print(' ', f)
