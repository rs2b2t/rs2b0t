import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]


class LauncherTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ('tools', 'bin', 'node_modules', 'desktop/node_modules/electron', 'desktop/node_modules/.bin', 'out'):
            (self.root / name).mkdir(parents=True)
        shutil.copy2(ROOT / 'tools/b0t.sh', self.root / 'tools/b0t.sh')
        for name in ('collision.lcnav.gz', 'worldmap-basemap.manifest.json'):
            (self.root / 'out' / name).write_text('fixture')
        (self.root / 'events').touch()
        self.env = os.environ | {'PATH': str(self.root / 'bin') + ':' + os.environ['PATH'], 'FIXTURE': str(self.root), 'FAILURE': '', 'B0T_VIEWER': 'none', 'PORT': '18081'}
        self.env.pop('RS2B2T_WS', None)
        self.env.pop('B0T_NO_OPEN', None)
        (self.root / 'bin/curl').write_text('''#!/usr/bin/env python3
import os,sys,pathlib
root=pathlib.Path(os.environ['FIXTURE']); url=sys.argv[-1]
with (root/'events').open('a') as f: f.write('curl '+url+'\\n')
if '/client/client.js' in url:
    mismatch = any(os.environ['FAILURE']==f'keys{world}' and f'w{world}.' in url for world in (2, 3))
    print('const rsa='+('2' if mismatch else '1')*309)
    sys.exit(0)
if os.environ['FAILURE']=='port': sys.exit(0)
sys.exit(0 if (root/'proxy.pid').exists() else 7)
''')
        (self.root / 'bin/bun').write_text('''#!/usr/bin/env python3
import os,sys,pathlib,time,signal
root=pathlib.Path(os.environ['FIXTURE'])
with (root/'events').open('a') as f: f.write('bun '+str(os.environ.get('TARGET'))+' '+' '.join(sys.argv[1:])+'\\n')
if sys.argv[1:]==['run','build:bot']: sys.exit(0)
assert sys.argv[1:]==['tools/live-proxy.ts'],sys.argv
pid=root/'proxy.pid'; pid.write_text(str(os.getpid()))
running=True
def stop(*args):
    global running
    running=False
signal.signal(signal.SIGTERM,stop)
while running: time.sleep(.02)
pid.unlink(missing_ok=True)
''')
        (self.root / 'bin/uname').write_text('#!/bin/sh\necho Darwin\n')
        (self.root / 'desktop/node_modules/.bin/electron').write_text('''#!/usr/bin/env python3
import os,pathlib,signal,time,sys
root=pathlib.Path(os.environ['FIXTURE']); path=root/'viewer.pid'; path.write_text(str(os.getpid()))
with (root/'events').open('a') as f: f.write('viewer started '+' '.join(sys.argv[1:])+'\\n')
running=True
def stop(*args):
    global running
    running=False
signal.signal(signal.SIGTERM,stop)
while running: time.sleep(.02)
path.unlink(missing_ok=True)
''')
        for path in [*(self.root / 'bin').iterdir(), self.root / 'desktop/node_modules/.bin/electron']:
            path.chmod(0o755)

    def run_failure(self, failure='', extra=None):
        child = subprocess.Popen(['sh', 'tools/b0t.sh'], cwd=self.root, env=self.env | {'FAILURE': failure} | (extra or {}), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
        try:
            out, err = child.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGTERM)
            child.communicate(timeout=5)
            raise
        result = subprocess.CompletedProcess(child.args, child.returncode, out, err)
        return result, (self.root / 'events').read_text()

    def test_mismatched_world_keys_fail_before_build_and_release_the_checkout_lock(self):
        for world in (2,):
            with self.subTest(world=world):
                result, events = self.run_failure(f'keys{world}')
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('w1.rs2b2t.com/client/client.js', events)
                self.assertIn(f'w{world}.rs2b2t.com/client/client.js', events)
                self.assertNotIn('build:bot', events)
                self.assertFalse((self.root / '.b0t-launch.lock').exists())

    def test_port_and_checkout_lock_prevent_any_build(self):
        result, events = self.run_failure('port')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('build:bot', events)
        lock = self.root / '.b0t-launch.lock'
        lock.mkdir()
        (lock / 'owner.pid').write_text('12345')
        result, events = self.run_failure()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('12345', result.stderr)
        self.assertNotIn('build:bot', events)
        self.assertTrue(lock.exists())

    def test_custom_upstream_rejected_before_build(self):
        result, events = self.run_failure(extra={'RS2B2T_WS': 'wss://custom.example'})
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('build:bot', events)

    def test_retired_world_rejected_before_build(self):
        result, events = self.run_failure('keys2', {'RS2B2T_WS': 'wss://w3.rs2b2t.com'})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('RS2B2T_WS', result.stderr)
        self.assertEqual(events, '')

    def test_one_proxy_build_and_viewer_are_owned_and_cleaned_up(self):
        child = subprocess.Popen(['sh', 'tools/b0t.sh'], cwd=self.root, env=self.env | {'B0T_VIEWER': 'electron', 'RS2B2T_WS': 'wss://w2.rs2b2t.com:443/'}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.addCleanup(lambda: child.poll() is not None or child.kill())
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline and not (self.root / 'viewer.pid').exists():
            if child.poll() is not None:
                self.fail(child.communicate())
            time.sleep(.02)
        self.assertTrue((self.root / 'viewer.pid').exists())
        child.terminate()
        child.communicate(timeout=5)
        events = (self.root / 'events').read_text()
        self.assertEqual(events.count('bun proxy run build:bot'), 1)
        self.assertEqual(events.count('tools/live-proxy.ts'), 1)
        self.assertEqual(events.count('viewer started'), 1)
        self.assertNotIn('w3.rs2b2t.com', events)
        self.assertIn('--server=http://localhost:18081/multibox.html?world=2', events)
        self.assertFalse((self.root / 'proxy.pid').exists())
        self.assertFalse((self.root / 'viewer.pid').exists())
        self.assertFalse((self.root / '.b0t-launch.lock').exists())


if __name__ == '__main__':
    unittest.main()
