/**
 * Java's body: what a host loads when the language is first used
 * (Light imports it with the page): the sample project, whose files
 * refer to each other on purpose, the server's settings and the build
 * settings, of which there are none.
 */
import { NO_PROPERTIES, type PackLanguageBody } from '../std/index.ts';

/** Java's body: the files of a new project, its server's settings and its build settings. */
const JAVA: PackLanguageBody = {
	sample: {
		'src/main/java/geometry/Main.java': `package geometry;

public class Main {
    public static void main(String[] args) {
        var a = new Point(0, 0);
        var b = new Point(3, 4);
        System.out.println(a + " to " + b + ": " + Geometry.distance(a, b));
        System.out.println(b.norm());
    }
}
`,
		'src/main/java/geometry/Point.java': `package geometry;

/** A point in the plane. */
public record Point(double x, double y) {
    /** Distance from the origin. */
    public double norm() {
        return Math.hypot(x, y);
    }
}
`,
		'src/main/java/geometry/Geometry.java': `package geometry;

/** Functions of points. */
public final class Geometry {
    private Geometry() {}

    /** Euclidean distance between two points. */
    public static double distance(Point a, Point b) {
        return Math.hypot(a.x() - b.x(), a.y() - b.y());
    }
}
`,
		'src/test/java/geometry/GeometryTest.java': `package geometry;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class GeometryTest {
    @Test
    void normOfThreeFourIsFive() {
        assertEquals(5.0, new Point(3, 4).norm());
    }

    @Test
    void distanceIsSymmetric() {
        var a = new Point(1, 2);
        var b = new Point(-2, 6);
        assertEquals(Geometry.distance(a, b), Geometry.distance(b, a));
        assertEquals(5.0, Geometry.distance(a, b));
    }

    @Test
    void distanceToItselfIsZero() {
        var p = new Point(1.5, -2.5);
        assertEquals(0.0, Geometry.distance(p, p));
    }
}
`,
	},
	serverSettings: {},
	properties: NO_PROPERTIES,
	configFiles: [],
};

/** Every language of the package's body, by key. */
export const BODIES = { java: JAVA } as const;
