/**
 * Go's body: what a host loads when the language is first used
 * (Light imports it with the page): the sample project, whose files
 * refer to each other on purpose, the server's settings and the build
 * settings, of which there are none.
 */
import { NO_PROPERTIES, type PackLanguageBody } from '../std/index.ts';

/** Go's body: the files of a new project, its server's settings and its build settings. */
const GO: PackLanguageBody = {
	sample: {
		'go.mod': `module example.com/geometry

go 1.27
`,
		'go.env': `# The target Run and Test build for. With nothing set it is WebAssembly
# (GOOS=wasip1, GOARCH=wasm), run in the browser. A Linux target runs
# under QEMU: uncomment both lines, with GOARCH one of amd64, arm64 or
# riscv64.
# GOOS=linux
# GOARCH=arm64
`,
		'main.go': `// Command geometry prints the distance between two points.
package main

import (
	"fmt"

	"example.com/geometry/point"
)

func main() {
	a := point.Point{X: 0, Y: 0}
	b := point.Point{X: 3, Y: 4}
	fmt.Printf("%v to %v: %v\\n", a, b, point.Distance(a, b))
	fmt.Println(b.Norm())
}
`,
		'point/point.go': `// Package point is about points in the plane.
package point

import (
	"fmt"
	"math"
)

// Point is a point in the plane.
type Point struct {
	X, Y float64
}

// Norm is the distance from the origin.
func (p Point) Norm() float64 {
	return math.Hypot(p.X, p.Y)
}

// String writes p as (x, y).
func (p Point) String() string {
	return fmt.Sprintf("(%g, %g)", p.X, p.Y)
}

// Distance is the Euclidean distance between a and b.
func Distance(a, b Point) float64 {
	return Point{a.X - b.X, a.Y - b.Y}.Norm()
}
`,
		'point/point_test.go': `package point

import (
	"fmt"
	"testing"
	"testing/quick"
)

func TestNorm(t *testing.T) {
	tests := []struct {
		p    Point
		want float64
	}{
		{Point{0, 0}, 0},
		{Point{3, 4}, 5},
		{Point{-3, 4}, 5},
	}
	for _, tt := range tests {
		if got := tt.p.Norm(); got != tt.want {
			t.Errorf("%v.Norm() = %v, want %v", tt.p, got, tt.want)
		}
	}
}

// A property: quick.Check tries it on 100 random pairs of points.
func TestDistanceIsSymmetric(t *testing.T) {
	symmetric := func(a, b Point) bool { return Distance(a, b) == Distance(b, a) }
	if err := quick.Check(symmetric, nil); err != nil {
		t.Error(err)
	}
}

func ExampleDistance() {
	fmt.Println(Distance(Point{0, 0}, Point{3, 4}))
	// Output: 5
}
`,
	},
	serverSettings: {},
	properties: NO_PROPERTIES,
	configFiles: [],
};

/** Every language of the package's body, by key. */
export const BODIES = { go: GO } as const;
