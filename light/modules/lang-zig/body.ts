/**
 * Zig's body: what a host loads when the language is first used
 * (Light imports it with the page): the sample project, whose files
 * refer to each other on purpose, the server's settings and the build
 * settings, of which there are none.
 */
import { NO_PROPERTIES, type PackLanguageBody } from '../std/index.ts';

/** Zig's body: the files of a new project, its server's settings and its build settings. */
const ZIG: PackLanguageBody = {
	sample: {
		'zig.env': `# The target Run and Test build for. With nothing set it is WebAssembly
# (wasm32-wasi), run in the browser; TARGET=x86_64-linux builds an x86-64
# Linux program and runs it under QEMU. OPTIMIZE is Debug (the default),
# ReleaseSafe, ReleaseFast or ReleaseSmall.
# TARGET=x86_64-linux
# OPTIMIZE=ReleaseSafe
`,
		'main.zig': `const std = @import("std");
const geometry = @import("geometry.zig");

pub fn main(init: std.process.Init) !void {
    var buffer: [1024]u8 = undefined;
    var stdout_writer: std.Io.File.Writer = .init(.stdout(), init.io, &buffer);
    const out = &stdout_writer.interface;

    const a: geometry.Point = .{ .x = 0, .y = 0 };
    const b: geometry.Point = .{ .x = 3, .y = 4 };
    try out.print("{f} to {f}: {d}\\n", .{ a, b, geometry.distance(a, b) });
    try out.print("{d}\\n", .{b.norm()});
    try out.flush();
}

test {
    // \`zig test main.zig\` runs the tests of the files main.zig uses.
    _ = geometry;
}
`,
		'geometry.zig': `//! Points in the plane.
const std = @import("std");

/// A point in the plane.
pub const Point = struct {
    x: f64,
    y: f64,

    /// Distance from the origin.
    pub fn norm(self: Point) f64 {
        return std.math.hypot(self.x, self.y);
    }

    /// Writes the point as (x, y), for \`{f}\` in a format string.
    pub fn format(self: Point, writer: *std.Io.Writer) std.Io.Writer.Error!void {
        try writer.print("({d}, {d})", .{ self.x, self.y });
    }
};

/// Euclidean distance between two points.
pub fn distance(a: Point, b: Point) f64 {
    const d: Point = .{ .x = a.x - b.x, .y = a.y - b.y };
    return d.norm();
}

test "the norm of (3, 4) is 5" {
    const p: Point = .{ .x = 3, .y = 4 };
    try std.testing.expectEqual(5.0, p.norm());
}

test "distance is symmetric, for 100 random pairs of points" {
    var prng: std.Random.DefaultPrng = .init(42);
    const random = prng.random();
    for (0..100) |_| {
        const a: Point = .{ .x = random.float(f64) * 200 - 100, .y = random.float(f64) * 200 - 100 };
        const b: Point = .{ .x = random.float(f64) * 200 - 100, .y = random.float(f64) * 200 - 100 };
        try std.testing.expectEqual(distance(a, b), distance(b, a));
    }
}
`,
	},
	serverSettings: {},
	properties: NO_PROPERTIES,
	configFiles: [],
};

/** Every language of the package's body, by key. */
export const BODIES = { zig: ZIG } as const;
