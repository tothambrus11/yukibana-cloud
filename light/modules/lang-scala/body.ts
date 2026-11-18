/**
 * Scala's body: what a host loads when the language is first used
 * (Light imports it with the page): the sample project, whose files
 * refer to each other on purpose, the server's settings and the build
 * settings (properties.ts).
 */
import type { PackLanguageBody } from '../std/index.ts';
import { SCALA_MODEL } from './properties.ts';

/** Scala's body: the files of a new project, its server's settings and its build settings. */
const SCALA: PackLanguageBody = {
	sample: {
		'Main.scala': `@main def run(): Unit =
  val a = Point(0, 0)
  val b = Point(3, 4)
  println(s"$a to $b: \${distance(a, b)}")
  println(List(a, b).map(_.norm).sum)
`,
		'Geometry.scala': `/** A point in the plane. */
case class Point(x: Double, y: Double):
  /** Distance from the origin. */
  def norm: Double = math.hypot(x, y)

/** Euclidean distance between two points. */
def distance(a: Point, b: Point): Double =
  math.hypot(a.x - b.x, a.y - b.y)
`,
	},
	serverSettings: {},
	properties: SCALA_MODEL,
	configFiles: [],
};

/** Every language of the package's body, by key. */
export const BODIES = { scala: SCALA } as const;
