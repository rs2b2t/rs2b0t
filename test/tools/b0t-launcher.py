import json
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
        for name in ('tools', 'bin', 'node_modules', 'desktop/node_modules/electron', 'desktop/node_modules/proper-lockfile', 'desktop/node_modules/.bin', 'out', 'public-bot', 'processes'):
            (self.root / name).mkdir(parents=True)
        shutil.copy2(ROOT / 'tools/b0t.sh', self.root / 'tools/b0t.sh')
        for name in ('collision.lcnav.gz', 'worldmap-basemap.manifest.json', 'botclient.js'):
            (self.root / 'out' / name).write_text('existing build')
        for name in ('bot.html', 'multibox.html'):
            (self.root / 'public-bot' / name).write_text('original page')
        (self.root / 'source').write_text('original source')
        (self.root / 'events').touch()
        self.env = os.environ | {'PATH': str(self.root / 'bin') + ':' + os.environ['PATH'], 'FIXTURE': str(self.root), 'FAILURE': '', 'B0T_VIEWER': 'none', 'PORT': '18081', 'XDG_STATE_HOME': str(self.root / 'state')}
        for key in ('RS2B2T_WS', 'B0T_NO_OPEN', 'B0T_PROFILE_DIR'):
            self.env.pop(key, None)
        (self.root / 'bin/curl').write_text('''#!/usr/bin/env python3
import os,sys,pathlib
root=pathlib.Path(os.environ['FIXTURE']); url=sys.argv[-1]
with (root/'events').open('a') as f: f.write('curl '+url+'\\n')
if '/client/client.js' in url:
    mismatch = os.environ['FAILURE']=='keys2' and 'w2.' in url
    print('const rsa='+('2' if mismatch else '1')*309)
    sys.exit(0)
sys.exit(0 if os.environ['FAILURE']=='port' else 7)
''')
        (self.root / 'bin/bun').write_text('''#!/usr/bin/env python3
import json,os,sys,pathlib,time,signal,socket
root=pathlib.Path(os.environ['FIXTURE'])
with (root/'events').open('a') as f: f.write('bun '+str(os.environ.get('TARGET'))+' '+' '.join(sys.argv[1:])+'\\n')
if sys.argv[1:]==['run','build:bot']:
    out=pathlib.Path(os.environ.get('B0T_OUT_DIR',root/'out')); out.mkdir(parents=True,exist_ok=True)
    (out/'botclient.js').write_text((root/'source').read_text())
    sys.exit(0)
assert sys.argv[1:]==['tools/live-proxy.ts'],sys.argv
port=int(os.environ['PORT']); listener=socket.socket()
while True:
    try:
        listener.bind(('127.0.0.1',port)); break
    except OSError:
        if os.environ.get('B0T_AUTO_PORT')!='1': raise
        port+=1
listener.listen()
path=root/'processes'/f'proxy-{os.getpid()}.json'
path.write_text(json.dumps({'port':port,'root':os.environ.get('B0T_INSTANCE_DIR'),'pid':os.getpid()}))
if os.environ.get('B0T_PORT_FILE'): pathlib.Path(os.environ['B0T_PORT_FILE']).write_text(str(port))
running=True
def stop(*args):
    global running
    running=False
signal.signal(signal.SIGTERM,stop)
while running: time.sleep(.02)
path.unlink(missing_ok=True)
''')
        (self.root / 'bin/uname').write_text('#!/bin/sh\necho Darwin\n')
        (self.root / 'desktop/node_modules/.bin/electron').write_text('''#!/usr/bin/env python3
import json,os,pathlib,signal,time,sys
root=pathlib.Path(os.environ['FIXTURE']); path=root/'processes'/f'viewer-{os.getpid()}.json'
path.write_text(json.dumps({'args':sys.argv[1:],'profile':os.environ.get('B0T_PROFILE_DIR'),'pid':os.getpid()}))
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

    def start(self, extra=None, auto_port=False):
        env = self.env | (extra or {})
        if auto_port:
            env.pop('PORT', None)
        child = subprocess.Popen(['sh', 'tools/b0t.sh'], cwd=self.root, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
        self.addCleanup(self.stop, child)
        return child

    def stop(self, child):
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
        try:
            return child.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.communicate()
            raise

    def processes(self, kind):
        return [json.loads(path.read_text()) for path in (self.root / 'processes').glob(f'{kind}-*.json')]

    def wait_for_viewers(self, child, count):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if child.poll() is not None:
                self.fail(child.communicate())
            if len(self.processes('viewer')) == count:
                return self.processes('viewer')
            time.sleep(.02)
        self.fail(f'timed out waiting for {count} viewers')

    def run_failure(self, failure='', extra=None):
        child = self.start({'FAILURE': failure} | (extra or {}))
        out, err = child.communicate(timeout=5)
        return subprocess.CompletedProcess(child.args, child.returncode, out, err), (self.root / 'events').read_text()

    def test_mismatched_world_keys_fail_before_build(self):
        result, events = self.run_failure('keys2')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('w1.rs2b2t.com/client/client.js', events)
        self.assertIn('w2.rs2b2t.com/client/client.js', events)
        self.assertNotIn('build:bot', events)

    def test_explicit_busy_port_prevents_build(self):
        result, events = self.run_failure('port')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('build:bot', events)

    def test_custom_upstream_rejected_before_build(self):
        result, events = self.run_failure(extra={'RS2B2T_WS': 'wss://custom.example'})
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('build:bot', events)

    def test_retired_world_rejected_before_build(self):
        result, events = self.run_failure('keys2', {'RS2B2T_WS': 'wss://w3.rs2b2t.com'})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('RS2B2T_WS', result.stderr)
        self.assertEqual(events, '')

    def test_second_instance_gets_new_build_without_changing_first(self):
        lock = self.root / '.b0t-launch.lock'
        lock.mkdir()
        (lock / 'owner.pid').write_text('12345')
        first = self.start({'B0T_VIEWER': 'electron'}, auto_port=True)
        first_viewer, = self.wait_for_viewers(first, 1)
        first_proxy, = self.processes('proxy')
        first_root = Path(first_proxy['root'])
        (self.root / 'source').write_text('edited source')
        (self.root / 'public-bot/multibox.html').write_text('edited page')
        second = self.start({'B0T_VIEWER': 'electron'}, auto_port=True)
        viewers = self.wait_for_viewers(second, 2)
        second_viewer, = [item for item in viewers if item['pid'] != first_viewer['pid']]
        second_proxy, = [item for item in self.processes('proxy') if item['pid'] != first_proxy['pid']]
        second_root = Path(second_proxy['root'])
        self.assertNotEqual(first_proxy['port'], second_proxy['port'])
        self.assertEqual(first_viewer['profile'], second_viewer['profile'])
        self.assertIsNone(first_viewer['profile'])
        self.assertNotEqual(first_root, second_root)
        self.assertEqual((first_root / 'out/botclient.js').read_text(), 'original source')
        self.assertEqual((first_root / 'public-bot/multibox.html').read_text(), 'original page')
        self.assertEqual((second_root / 'out/botclient.js').read_text(), 'edited source')
        self.assertEqual((second_root / 'public-bot/multibox.html').read_text(), 'edited page')
        self.assertEqual((self.root / 'out/botclient.js').read_text(), 'existing build')
        self.stop(second)
        self.assertFalse(second_root.exists())
        self.assertTrue(first_root.exists())
        self.assertIsNone(first.poll())
        self.assertEqual(self.processes('viewer'), [first_viewer])
        self.assertEqual(self.processes('proxy'), [first_proxy])
        self.stop(first)
        self.assertFalse(first_root.exists())
        self.assertTrue(lock.exists())

    def test_explicit_port_and_profile_are_preserved(self):
        profile = str(self.root / 'custom profile')
        child = self.start({'B0T_VIEWER': 'electron', 'RS2B2T_WS': 'wss://w2.rs2b2t.com:443/', 'B0T_PROFILE_DIR': profile})
        viewer, = self.wait_for_viewers(child, 1)
        proxy, = self.processes('proxy')
        self.assertEqual(proxy['port'], 18081)
        self.assertEqual(viewer['profile'], profile)
        self.assertIn('--server=http://localhost:18081/multibox.html?world=2', viewer['args'])
        self.stop(child)
        events = (self.root / 'events').read_text()
        self.assertEqual(events.count('bun proxy run build:bot'), 1)
        self.assertEqual(events.count('tools/live-proxy.ts'), 1)
        self.assertEqual(events.count('viewer started'), 1)
        self.assertNotIn('w3.rs2b2t.com', events)
        self.assertEqual(self.processes('proxy'), [])
        self.assertEqual(self.processes('viewer'), [])
        self.assertFalse(Path(proxy['root']).exists())


if __name__ == '__main__':
    unittest.main()
