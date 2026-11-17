// What the student's code links against in a split run: the same
// functions, each one a call to the trusted process.
#include "../include/hidden_lib.h"
#include "channel.h"

extern rpc::Channel* stub_channel;

static rpc::Values call(std::uint8_t fn, const rpc::Values& v) {
    auto r = stub_channel->call(fn, v);
    if (!r) throw std::runtime_error("the grader went away");
    return *r;
}

std::int64_t weight(std::int64_t n) { return call(rpc::WEIGHT, {n}).at(0); }
std::vector<std::int64_t> weight_many(const std::vector<std::int64_t>& xs) { return call(rpc::WEIGHT_MANY, xs); }
