/**
 * Kotlin's body: what a host loads when the language is first used
 * (Light imports it with the page): the sample project, whose files
 * refer to each other on purpose, the server's settings and the build
 * settings, of which there are none.
 */
import { NO_PROPERTIES, type PackLanguageBody } from '../std/index.ts';

/** Kotlin's body: the files of a new project, its server's settings and its build settings. */
const KOTLIN: PackLanguageBody = {
	sample: {
		'src/main/kotlin/Main.kt': `fun main() {
    val a = Point(0.0, 0.0)
    val b = Point(3.0, 4.0)
    println("$a to $b: \${distance(a, b)}")
    println(b.norm())
}
`,
		'src/main/kotlin/Geometry.kt': `import kotlin.math.hypot

/** A point in the plane. */
data class Point(val x: Double, val y: Double) {
    /** Distance from the origin. */
    fun norm(): Double = hypot(x, y)
}

/** Euclidean distance between two points. */
fun distance(a: Point, b: Point): Double = hypot(a.x - b.x, a.y - b.y)
`,
		'src/test/kotlin/GeometryTest.kt': `import kotlin.test.Test
import kotlin.test.assertEquals

class GeometryTest {
    @Test
    fun normOfThreeFourIsFive() {
        assertEquals(5.0, Point(3.0, 4.0).norm())
    }

    @Test
    fun distanceIsSymmetric() {
        val a = Point(1.0, 2.0)
        val b = Point(-2.0, 6.0)
        assertEquals(distance(a, b), distance(b, a))
        assertEquals(5.0, distance(a, b))
    }

    @Test
    fun distanceToItselfIsZero() {
        val p = Point(1.5, -2.5)
        assertEquals(0.0, distance(p, p))
    }
}
`,
	},
	serverSettings: {},
	properties: NO_PROPERTIES,
	configFiles: [],
};

/** Every language of the package's body, by key. */
export const BODIES = { kotlin: KOTLIN } as const;
