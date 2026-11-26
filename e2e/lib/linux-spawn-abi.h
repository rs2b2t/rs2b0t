/* Why: Bun slim ships libc without development headers. These are the Linux x86_64/aarch64 ABIs. */
#if !defined(__x86_64__) && !defined(__aarch64__)
#error Unsupported Linux ABI
#endif

typedef int pid_t;
typedef struct { unsigned long bits[16]; } sigset_t;
typedef struct { unsigned long opaque[64]; } posix_spawnattr_t;
typedef struct { unsigned long opaque[16]; } posix_spawn_file_actions_t;
typedef struct {
    int si_signo, si_errno, si_code, pad;
    pid_t si_pid;
    unsigned int si_uid;
    int si_status;
    int reserved[25];
} __attribute__((aligned(8))) siginfo_t;

#define O_RDONLY 0
#define F_SETFD 2
#define FD_CLOEXEC 1
#define POSIX_SPAWN_SETSIGDEF 4
#define POSIX_SPAWN_SETSIGMASK 8
#define POSIX_SPAWN_SETSID 128
#define P_PID 1
#define WNOHANG 1
#define WEXITED 4
#define WNOWAIT 0x01000000
#define CLD_EXITED 1
#define EINTR 4
#define errno (*__errno_location())

int *__errno_location(void);
int pipe(int *);
int close(int);
int fcntl(int, int, ...);
int sigfillset(sigset_t *);
int sigemptyset(sigset_t *);
int posix_spawnattr_init(posix_spawnattr_t *);
int posix_spawnattr_destroy(posix_spawnattr_t *);
int posix_spawnattr_setflags(posix_spawnattr_t *, short);
int posix_spawnattr_setsigdefault(posix_spawnattr_t *, const sigset_t *);
int posix_spawnattr_setsigmask(posix_spawnattr_t *, const sigset_t *);
int posix_spawn_file_actions_init(posix_spawn_file_actions_t *);
int posix_spawn_file_actions_destroy(posix_spawn_file_actions_t *);
int posix_spawn_file_actions_addopen(posix_spawn_file_actions_t *, int, const char *, int, unsigned int);
int posix_spawn_file_actions_adddup2(posix_spawn_file_actions_t *, int, int);
int posix_spawn(pid_t *, const char *, const posix_spawn_file_actions_t *, const posix_spawnattr_t *, char *const *, char *const *);
int waitid(int, unsigned int, siginfo_t *, int);
pid_t waitpid(pid_t, int *, int);
