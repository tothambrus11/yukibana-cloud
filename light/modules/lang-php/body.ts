/**
 * PHP's body: what a host loads when the language is first used
 * (Light imports it with the page): the sample project, whose files
 * refer to each other on purpose, the server's settings and the build
 * settings, of which there are none.
 */
import { NO_PROPERTIES, type PackLanguageBody } from '../std/index.ts';

/** PHP's body: the files of a new project, its server's settings and its build settings. */
const PHP: PackLanguageBody = {
	sample: {
		'main.php': `<?php

declare(strict_types=1);

require_once __DIR__ . '/geometry.php';

use Geometry\\Point;

use function Geometry\\distance;

$a = new Point(0, 0);
$b = new Point(3, 4);
echo "{$a} to {$b}: " . distance($a, $b) . "\\n";
echo $b->norm() . "\\n";
`,
		'geometry.php': `<?php

declare(strict_types=1);

namespace Geometry;

/** A point in the plane. */
final class Point
{
    public function __construct(
        public readonly float $x,
        public readonly float $y,
    ) {}

    /** Distance from the origin. */
    public function norm(): float
    {
        return hypot($this->x, $this->y);
    }

    public function __toString(): string
    {
        return "({$this->x}, {$this->y})";
    }
}

/** Euclidean distance between two points. */
function distance(Point $a, Point $b): float
{
    return hypot($a->x - $b->x, $a->y - $b->y);
}
`,
		'tests/GeometryTest.php': `<?php

declare(strict_types=1);

namespace Geometry\\Tests;

use Geometry\\Point;
use PHPUnit\\Framework\\Attributes\\DataProvider;
use PHPUnit\\Framework\\TestCase;

use function Geometry\\distance;

require_once __DIR__ . '/../geometry.php';

final class GeometryTest extends TestCase
{
    public function testNormOfThreeFourIsFive(): void
    {
        $this->assertSame(5.0, (new Point(3, 4))->norm());
    }

    public function testDistanceIsSymmetric(): void
    {
        $a = new Point(1, 2);
        $b = new Point(-2, 6);
        $this->assertSame(distance($a, $b), distance($b, $a));
    }

    /** @return iterable<string, array{float, float, float}> */
    public static function norms(): iterable
    {
        yield 'origin' => [0, 0, 0.0];
        yield '5-12-13' => [5, 12, 13.0];
    }

    #[DataProvider('norms')]
    public function testNorm(float $x, float $y, float $expected): void
    {
        $this->assertEqualsWithDelta($expected, (new Point($x, $y))->norm(), 1e-12);
    }

    public function testPrintsAsAPair(): void
    {
        $this->assertSame('(1, 2)', (string) new Point(1, 2));
    }
}
`,
	},
	serverSettings: {},
	properties: NO_PROPERTIES,
	configFiles: [],
};

/** Every language of the package's body, by key. */
export const BODIES = { php: PHP } as const;
