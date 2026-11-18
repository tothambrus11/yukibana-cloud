/**
 * Python's body: what a host loads when the language is first used
 * (Light imports it with the page): the sample project, whose files
 * refer to each other on purpose, the server's settings and the build
 * settings, of which there are none.
 */
import { NO_PROPERTIES, type PackLanguageBody } from '../std/index.ts';

/** Python's body: the files of a new project, its server's settings and its build settings. */
const PYTHON: PackLanguageBody = {
	sample: {
		'main.py': `from geometry import Point, distance


def main() -> None:
    a = Point(0, 0)
    b = Point(3, 4)
    print(f"{a} to {b}: {distance(a, b)}")
    print(a.norm())


if __name__ == "__main__":
    main()
`,
		'geometry.py': `import math
from dataclasses import dataclass


@dataclass(frozen=True)
class Point:
    """A point in the plane."""

    x: float
    y: float

    def norm(self) -> float:
        """Distance from the origin."""
        return math.hypot(self.x, self.y)


def distance(a: Point, b: Point) -> float:
    """Euclidean distance between two points."""
    return math.hypot(a.x - b.x, a.y - b.y)
`,
		'tests/test_geometry.py': `import dataclasses
import math

import pytest
from hypothesis import given
from hypothesis import strategies as st

from geometry import Point, distance

points = st.builds(Point, st.floats(-1e9, 1e9), st.floats(-1e9, 1e9))


def test_norm_of_3_4_is_5() -> None:
    assert Point(3, 4).norm() == 5


@given(points, points)
def test_distance_is_symmetric(a: Point, b: Point) -> None:
    assert distance(a, b) == distance(b, a)


@pytest.mark.parametrize(("x", "y", "expected"), [(0, 0, 0.0), (5, 12, 13.0), (1, 1, math.sqrt(2))])
def test_norm(x: float, y: float, expected: float) -> None:
    assert Point(x, y).norm() == pytest.approx(expected)


def test_points_are_immutable() -> None:
    p = Point(0, 0)
    with pytest.raises(dataclasses.FrozenInstanceError):
        p.x = 1  # type: ignore[misc]
`,
	},
	serverSettings: { python: { analysis: { typeCheckingMode: 'standard', diagnosticMode: 'workspace' } } },
	properties: NO_PROPERTIES,
	configFiles: [],
};

/** Every language of the package's body, by key. */
export const BODIES = { python: PYTHON } as const;
