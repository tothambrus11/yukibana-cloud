// Arrangement C, the student's side, inside the sandbox, linked with the
// student's code and the stub. Usage: student_host fifo DOWN UP | shm PATH
#include <memory>
#include <string>
#include "../include/hidden_lib.h"
#include "channel.h"

rpc::Channel* stub_channel = nullptr;

int main(int, char** argv) {
    std::unique_ptr<rpc::Transport> t;
    if (std::string(argv[1]) == "fifo") t = std::make_unique<rpc::FifoTransport>(argv[2], argv[3], true);
    else t = std::make_unique<rpc::ShmTransport>(argv[2]);
    rpc::Channel channel(*t, {{rpc::SOLVE, [](const rpc::Values& xs) { return rpc::Values{solve(xs)}; }}});
    stub_channel = &channel;
    channel.wait();
    std::fflush(stdout);
}
