// Arrangement C, the trusted side. Usage:
// trusted fifo|shm SANDBOX HIDE_DIR STUDENT_HOST VERDICTS VISIBLE
#include <cstdlib>
#include <fcntl.h>
#include <string>
#include <sys/stat.h>
#include <sys/wait.h>
#include "../hidden/hidden_tests.h"
#include "channel.h"

int main(int, char** argv) {
    std::string mode = argv[1];
    const char *sandbox = argv[2], *hide = argv[3], *host = argv[4], *verdicts = argv[5], *visible = argv[6];
    char dir[] = "/tmp/rpc-XXXXXX";
    if (!::mkdtemp(dir)) return 1;
    ::chmod(dir, 0755);
    std::string down = std::string(dir) + "/down", up = std::string(dir) + "/up", shm = "/dev/shm/rpc-" + std::to_string(::getpid());
    if (mode == "fifo") {
        for (auto& p : {down, up}) ::mkfifo(p.c_str(), 0666), ::chmod(p.c_str(), 0666);
    } else {
        int fd = ::open(shm.c_str(), O_RDWR | O_CREAT | O_TRUNC, 0666);
        ::fchmod(fd, 0666);
        if (::ftruncate(fd, 8 << 20) != 0) return 1;
        ::close(fd);
    }
    pid_t child = ::fork();
    if (child == 0) {
        int out = ::open(visible, O_WRONLY | O_CREAT | O_TRUNC, 0644);
        ::dup2(out, 1), ::dup2(out, 2);
        int devnull = ::open("/dev/null", O_RDONLY);
        ::dup2(devnull, 0);
        const char* enc = std::getenv("LEAK_ENCODING");
        std::string env_enc = std::string("LEAK_ENCODING=") + (enc ? enc : "plain");
        std::string env_path = std::string("PATH=") + std::getenv("PATH");
        char* envp[] = {env_path.data(), env_enc.data(), nullptr};
        if (mode == "fifo") {
            const char* args[] = {sandbox, hide, "--", host, "fifo", down.c_str(), up.c_str(), nullptr};
            ::execve(sandbox, const_cast<char**>(args), envp);
        } else {
            const char* args[] = {sandbox, hide, "--", host, "shm", shm.c_str(), nullptr};
            ::execve(sandbox, const_cast<char**>(args), envp);
        }
        std::_Exit(127);
    }
    rpc::Transport* t;
    if (mode == "fifo") t = new rpc::FifoTransport(up.c_str(), down.c_str(), false);
    else t = new rpc::ShmTransport(shm.c_str());
    rpc::Channel channel(*t, {
        {rpc::WEIGHT, [](const rpc::Values& v) { return rpc::Values{weight(v.at(0))}; }},
        {rpc::WEIGHT_MANY, [](const rpc::Values& v) { return weight_many(v); }},
    });
    std::FILE* v = std::fopen(verdicts, "w");
    run_tests([&](const std::vector<std::int64_t>& xs) {
        auto r = channel.call(rpc::SOLVE, xs);
        if (!r) throw std::runtime_error("the student process ended");
        return r->at(0);
    }, v);
    std::fclose(v);
    t->close();
    int status;
    ::waitpid(child, &status, 0);
    if (mode == "shm") ::unlink(shm.c_str());
}
