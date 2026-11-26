#!/usr/bin/python3 -I
import os
import shutil
import signal
import socket
import sys
from pathlib import Path

group = os.getpid()
if os.getsid(0) != group:
    sys.exit("Owned E2E services require a dedicated session")

groups = Path(os.environ["E2E_SERVICE_GROUPS"])
with socket.socket(socket.AF_UNIX) as owner:
    owner.connect(str(groups / "owner"))
    (groups / str(group)).touch()
    watcher = os.fork()
    if watcher == 0:
        # Why: staying in the session pins its ID while a stopped service group needs an external signal.
        os.setpgid(0, 0)
        os.dup2(owner.fileno(), 0)
        os.closerange(1, max(5, owner.fileno() + 1))
        try:
            os.read(0, 1)
        finally:
            try:
                os.killpg(group, signal.SIGKILL)
            except ProcessLookupError:
                pass
            shutil.rmtree(groups, ignore_errors=True)
        os._exit(0)
    os.setpgid(watcher, watcher)

for name in ("SIGPIPE", "SIGXFZ", "SIGXFSZ"):
    if hasattr(signal, name):
        signal.signal(getattr(signal, name), signal.SIG_DFL)
executable = os.environ["E2E_SERVICE_EXECUTABLE"]
os.execvp(executable, [executable, *sys.argv[1:]])
