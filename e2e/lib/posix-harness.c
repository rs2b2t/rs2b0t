#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <spawn.h>
#include <sys/wait.h>
#include <unistd.h>

static int output_pipe(posix_spawn_file_actions_t *actions, int fds[2], int target) {
    if (pipe(fds) < 0) return errno;
    if (fcntl(fds[0], F_SETFD, FD_CLOEXEC) < 0 || fcntl(fds[1], F_SETFD, FD_CLOEXEC) < 0) return errno;
    return posix_spawn_file_actions_adddup2(actions, fds[1], target);
}

int launch(const char *path, char **argv, char **env, int reads[2]) {
    posix_spawnattr_t attr;
    posix_spawn_file_actions_t actions;
    int err = posix_spawnattr_init(&attr);
    if (err) return -err;
    err = posix_spawn_file_actions_init(&actions);
    if (err) {
        posix_spawnattr_destroy(&attr);
        return -err;
    }

    pid_t pid = 0;
    int out[2] = {-1, -1}, log[2] = {-1, -1};
    sigset_t defaults, mask;
    sigfillset(&defaults);
    sigemptyset(&mask);
    err = posix_spawnattr_setsigdefault(&attr, &defaults);
    if (!err) err = posix_spawnattr_setsigmask(&attr, &mask);
    if (!err) err = posix_spawnattr_setflags(&attr, POSIX_SPAWN_SETSID | POSIX_SPAWN_SETSIGDEF | POSIX_SPAWN_SETSIGMASK);
    if (!err) err = posix_spawn_file_actions_addopen(&actions, 0, "/dev/null", O_RDONLY, 0);
    if (!err) err = output_pipe(&actions, out, 1);
    if (!err) err = output_pipe(&actions, log, 2);
    if (!err) err = posix_spawn(&pid, path, &actions, &attr, argv, env);
    posix_spawn_file_actions_destroy(&actions);
    posix_spawnattr_destroy(&attr);
    if (out[1] >= 0) close(out[1]);
    if (log[1] >= 0) close(log[1]);
    if (err) {
        if (out[0] >= 0) close(out[0]);
        if (log[0] >= 0) close(log[0]);
        return -err;
    }
    reads[0] = out[0];
    reads[1] = log[0];
    return pid;
}

int harness_status(int pid) {
    siginfo_t info = {0};
    while (waitid(P_PID, pid, &info, WEXITED | WNOHANG | WNOWAIT) < 0) {
        if (errno != EINTR) return -errno;
    }
    if (!info.si_pid) return 256;
    return info.si_code == CLD_EXITED ? info.si_status : 128 + info.si_status;
}

int reap(int pid) {
    int result;
    do { result = waitpid(pid, 0, WNOHANG); } while (result < 0 && errno == EINTR);
    return result;
}
