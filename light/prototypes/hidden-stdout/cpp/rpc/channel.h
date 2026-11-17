// The RPC frame of common/SPEC.md over one of two transports: two FIFOs, or
// one shared-memory mailbox with a futex (the floor: no syscall per message
// while the other side answers within the spin).
#pragma once
#include <atomic>
#include <cstdint>
#include <cstring>
#include <fcntl.h>
#include <functional>
#include <immintrin.h>
#include <linux/futex.h>
#include <map>
#include <optional>
#include <stdexcept>
#include <string>
#include <sys/mman.h>
#include <sys/syscall.h>
#include <sys/uio.h>
#include <unistd.h>
#include <vector>

namespace rpc {
enum : std::uint8_t { CALL = 1, RETURN = 2, ERROR = 3 };
enum : std::uint8_t { SOLVE = 1, WEIGHT = 2, WEIGHT_MANY = 3 };
using Values = std::vector<std::int64_t>;
using Handler = std::function<Values(const Values&)>;

struct Header {
    std::uint8_t kind, fn;
    std::uint16_t zero;
    std::uint32_t count;
};

/** Moves whole frames; recv returns false at the end of the stream. */
struct Transport {
    virtual ~Transport() = default;
    virtual void send(const Header& h, const std::int64_t* values) = 0;
    virtual bool recv(Header& h, Values& values) = 0;
    virtual void close() = 0;
};

class FifoTransport final : public Transport {
    int r_ = -1, w_ = -1;
    std::vector<char> buf_ = std::vector<char>(1 << 16);
    size_t start_ = 0, end_ = 0;

    bool take(void* dst, size_t n) {
        char* out = static_cast<char*>(dst);
        while (n > 0) {
            if (start_ == end_) {
                ssize_t got = ::read(r_, buf_.data(), buf_.size());
                if (got <= 0) return false;
                start_ = 0, end_ = static_cast<size_t>(got);
            }
            size_t k = std::min(n, end_ - start_);
            std::memcpy(out, buf_.data() + start_, k);
            start_ += k, out += k, n -= k;
        }
        return true;
    }

public:
    FifoTransport(const char* read_path, const char* write_path, bool read_first) {
        // Both FIFOs block on open until the other end opens them.
        if (read_first) r_ = ::open(read_path, O_RDONLY), w_ = ::open(write_path, O_WRONLY);
        else w_ = ::open(write_path, O_WRONLY), r_ = ::open(read_path, O_RDONLY);
        if (r_ < 0 || w_ < 0) throw std::runtime_error("cannot open the FIFOs");
    }
    void send(const Header& h, const std::int64_t* values) override {
        iovec iov[2] = {{const_cast<Header*>(&h), sizeof h}, {const_cast<std::int64_t*>(values), 8 * size_t{h.count}}};
        size_t left = iov[0].iov_len + iov[1].iov_len;
        int first = 0;
        while (left > 0) {
            ssize_t n = ::writev(w_, iov + first, 2 - first);
            if (n < 0) throw std::runtime_error("write failed");
            left -= static_cast<size_t>(n);
            while (first < 2 && static_cast<size_t>(n) >= iov[first].iov_len) n -= static_cast<ssize_t>(iov[first++].iov_len);
            if (first < 2) iov[first].iov_base = static_cast<char*>(iov[first].iov_base) + n, iov[first].iov_len -= static_cast<size_t>(n);
        }
    }
    bool recv(Header& h, Values& values) override {
        if (!take(&h, sizeof h)) return false;
        values.resize(h.count);
        return take(values.data(), 8 * size_t{h.count});
    }
    void close() override { ::close(w_); }
};

/** One mailbox for both directions: only one message is ever in flight,
 *  because whoever sent last is waiting. seq counts messages; a side waits
 *  until seq is no longer the one it wrote. */
class ShmTransport final : public Transport {
    struct Box {
        alignas(64) std::atomic<std::uint32_t> seq;
        alignas(64) std::atomic<std::uint32_t> sleeping;
        std::atomic<std::uint32_t> closed;
        alignas(64) Header h;
        std::int64_t values[];
    };
    static constexpr size_t SIZE = 8 << 20;
    Box* box_;
    std::uint32_t mine_ = 0;

    static long futex(std::atomic<std::uint32_t>* addr, int op, std::uint32_t val) {
        return ::syscall(SYS_futex, reinterpret_cast<std::uint32_t*>(addr), op, val, nullptr, nullptr, 0);
    }

public:
    static constexpr size_t MAX_VALUES = (SIZE - sizeof(Box)) / 8;
    explicit ShmTransport(const char* path) {
        int fd = ::open(path, O_RDWR);
        if (fd < 0) throw std::runtime_error("cannot open the shared memory");
        void* p = ::mmap(nullptr, SIZE, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
        ::close(fd);
        if (p == MAP_FAILED) throw std::runtime_error("cannot map the shared memory");
        box_ = static_cast<Box*>(p);
    }
    void send(const Header& h, const std::int64_t* values) override {
        if (h.count > MAX_VALUES) throw std::runtime_error("frame too large for the mailbox");
        box_->h = h;
        std::memcpy(box_->values, values, 8 * size_t{h.count});
        mine_ = box_->seq.load(std::memory_order_relaxed) + 1;
        box_->seq.store(mine_, std::memory_order_seq_cst);
        if (box_->sleeping.load(std::memory_order_seq_cst)) futex(&box_->seq, FUTEX_WAKE, 1);
    }
    bool recv(Header& h, Values& values) override {
        for (int i = 0; box_->seq.load(std::memory_order_acquire) == mine_; i++) {
            if (box_->closed.load(std::memory_order_acquire)) return false;
            if (i < 20000) {
                _mm_pause();
                continue;
            }
            box_->sleeping.store(1, std::memory_order_seq_cst);
            if (box_->seq.load(std::memory_order_seq_cst) == mine_ && !box_->closed.load()) futex(&box_->seq, FUTEX_WAIT, mine_);
            box_->sleeping.store(0, std::memory_order_seq_cst);
        }
        if (box_->closed.load(std::memory_order_acquire)) return false;
        h = box_->h;
        values.assign(box_->values, box_->values + h.count);
        mine_ = box_->seq.load(std::memory_order_relaxed);  // read it: now we may write
        return true;
    }
    void close() override {
        box_->closed.store(1);
        box_->seq.fetch_add(0x80000000u);
        futex(&box_->seq, FUTEX_WAKE, 1);
    }
};

class Channel {
    Transport& t_;
    std::map<int, Handler> handlers_;

public:
    Channel(Transport& t, std::map<int, Handler> handlers) : t_(t), handlers_(std::move(handlers)) {}

    std::optional<Values> call(std::uint8_t fn, const Values& values) {
        t_.send({CALL, fn, 0, static_cast<std::uint32_t>(values.size())}, values.data());
        return wait();
    }

    /** Serve calls until a return arrives; nullopt at the end of the stream. */
    std::optional<Values> wait() {
        Header h{};
        Values values;
        for (;;) {
            if (!t_.recv(h, values)) return std::nullopt;
            if (h.kind == CALL) {
                Values result;
                try {
                    result = handlers_.at(h.fn)(values);
                } catch (const std::exception& e) {
                    std::fprintf(stderr, "error: %s\n", e.what());
                    t_.send({ERROR, h.fn, 0, 0}, nullptr);
                    continue;
                }
                t_.send({RETURN, h.fn, 0, static_cast<std::uint32_t>(result.size())}, result.data());
            } else if (h.kind == RETURN) {
                return values;
            } else {
                throw std::runtime_error("the call failed on the other side");
            }
        }
    }
};
}  // namespace rpc
