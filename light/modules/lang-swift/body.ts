/**
 * Swift's body: what a host loads when the language is first used
 * (Light imports it with the page): the sample project, whose files
 * refer to each other on purpose, the server's settings and the build
 * settings (properties.ts).
 */
import type { PackLanguageBody } from '../std/index.ts';
import { SWIFT_MODEL } from './properties.ts';

/** Swift's body: the files of a new project, its server's settings and its build settings. */
const SWIFT: PackLanguageBody = {
	sample: {
		'swift.env': `# The target Run builds for. With nothing set it is WebAssembly, run in
# the browser; TARGET=x86_64-linux or TARGET=aarch64-linux builds a static
# Linux program with a larger compiler and runs it under QEMU.
# TARGET=aarch64-linux
`,
		'main.swift': `let a = Point(x: 0, y: 0)
let b = Point(x: 3, y: 4)
print("\\(a) to \\(b): \\(distance(a, b))")
print(b.norm())
`,
		'Geometry.swift': `/// A point in the plane.
struct Point: CustomStringConvertible {
    var x: Double
    var y: Double

    /// Distance from the origin.
    func norm() -> Double {
        (x * x + y * y).squareRoot()
    }

    var description: String { "(\\(x), \\(y))" }
}

/// Euclidean distance between two points.
func distance(_ a: Point, _ b: Point) -> Double {
    Point(x: a.x - b.x, y: a.y - b.y).norm()
}
`,
		'Tests/GeometryTests.swift': `import XCTest
@testable import App

final class GeometryTests: XCTestCase {
    func testNorm() {
        XCTAssertEqual(Point(x: 3, y: 4).norm(), 5)
    }

    func testDistanceIsSymmetric() {
        let a = Point(x: 1, y: 2)
        let b = Point(x: -2, y: 6)
        XCTAssertEqual(distance(a, b), distance(b, a), accuracy: 1e-12)
    }
}
`,
	},
	serverSettings: {},
	properties: SWIFT_MODEL,
	configFiles: [],
};

/** Every language of the package's body, by key. */
export const BODIES = { swift: SWIFT } as const;
