#!/usr/bin/python3 -I
import fcntl
import os
import shutil
import signal
import sys
from pathlib import Path

if os.getpgrp() != os.getpid():
    sys.exit("Owned E2E services require a dedicated process group")

runner_fd = os.environ.pop("E2E_RUNNER_LOCK_FD", None)
if runner_fd is not None:
    fd = int(runner_fd)
    fcntl.flock(fd, fcntl.LOCK_EX)
    os.close(fd)

groups = Path(os.environ["E2E_SERVICE_GROUPS"])
group = groups / str(os.getpid())
with (groups / "owner").open("rb") as owner:
    group.touch()
    mask = signal.pthread_sigmask(signal.SIG_BLOCK, [signal.SIGHUP, signal.SIGINT, signal.SIGQUIT, signal.SIGTERM])
    if os.fork() == 0:
        # Why: the watcher must release the harness output and Playwright's protocol pipes before waiting.
        os.dup2(owner.fileno(), 0)
        os.closerange(1, max(5, owner.fileno() + 1))
        fcntl.flock(0, fcntl.LOCK_SH)
        shutil.rmtree(groups, ignore_errors=True)
        os.killpg(0, signal.SIGKILL)
        os._exit(1)
    signal.pthread_sigmask(signal.SIG_SETMASK, mask)

for name in ("SIGPIPE", "SIGXFZ", "SIGXFSZ"):
    if hasattr(signal, name):
        signal.signal(getattr(signal, name), signal.SIG_DFL)
executable = os.environ["E2E_SERVICE_EXECUTABLE"]
try:
    os.execvp(executable, [executable, *sys.argv[1:]])
except OSError as error:
    group.with_suffix(".errno").write_text(str(error.errno))
    sys.exit(127)
