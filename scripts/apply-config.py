#!/usr/bin/env python3
"""Replace (or add) the dsh-monitor entry in a DSH profile patch file.
usage: apply-config.py NEW_ENTRY.yml [PATCH_FILE]   (default ~/.dsh/profiles/web/cordis.patch.yml)"""
import re, sys, shutil, os, time
new = open(sys.argv[1]).read().rstrip('\n') + '\n'
path = sys.argv[2] if len(sys.argv) > 2 else os.path.expanduser('~/.dsh/profiles/web/cordis.patch.yml')
lines = open(path).read().split('\n')
out, i, removed = [], 0, 0
while i < len(lines):
    if re.match(r'^- id:\s*dsh-monitor\s*$', lines[i]):
        while out and re.match(r'^# (Append|Replace) |^# tailscale serve forwards', out[-1]): out.pop()   # our own header comments
        i += 1
        while i < len(lines) and not re.match(r'^- ', lines[i]): i += 1        # until next top-level item
        removed += 1
        continue
    out.append(lines[i]); i += 1
text = '\n'.join(out).rstrip('\n') + '\n'
if text.strip() == '[]' or not any(l.startswith('- ') for l in text.split('\n')):
    text = re.sub(r'^\[\]\s*$', '', text, flags=re.M)
shutil.copy(path, path + '.bak-' + time.strftime('%Y%m%d%H%M%S'))
open(path, 'w').write(text + new)
print(f'ok: replaced {removed} old dsh-monitor entr{"y" if removed==1 else "ies"}; backup saved next to {path}')
