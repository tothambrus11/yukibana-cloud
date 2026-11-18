/**
 * Haskell's body: what a host loads when the language is first used
 * (Light imports it with the page): the sample project, whose files
 * refer to each other on purpose, the server's settings and the build
 * settings, of which there are none.
 */
import { NO_PROPERTIES, type PackLanguageBody } from '../std/index.ts';

/** Haskell's body: the files of a new project, its server's settings and its build settings. */
const HASKELL: PackLanguageBody = {
	sample: {
		'Main.hs': `module Main (main) where

import Geometry

main :: IO ()
main = do
  let a = Point 0 0
      b = Point 3 4
  putStrLn (show a ++ " to " ++ show b ++ ": " ++ show (distance a b))
  print (norm b)
  mapM_ (print . area) [Circle 1, Square 2]
`,
		'Geometry.hs': `-- | Points and shapes in the plane.
module Geometry
  ( Point (..),
    norm,
    distance,
    Shape (..),
    area,
  )
where

-- | A point in the plane.
data Point = Point {px :: Double, py :: Double}
  deriving (Eq)

instance Show Point where
  show (Point x y) = "(" ++ show x ++ ", " ++ show y ++ ")"

-- | Distance from the origin.
norm :: Point -> Double
norm (Point x y) = sqrt (x * x + y * y)

-- | Euclidean distance between two points.
distance :: Point -> Point -> Double
distance a b = norm (Point (px a - px b) (py a - py b))

-- | A shape, told apart by its constructor.
data Shape = Circle Double | Square Double
  deriving (Show)

-- | The area of a shape; the cases cover every constructor.
area :: Shape -> Double
area (Circle r) = pi * r * r
area (Square side) = side * side
`,
		'tests/Spec.hs': `module Main (main) where

import Geometry
import Test.Hspec

main :: IO ()
main = hspec $ do
  describe "norm"
    $ it "is 5 at (3, 4)"
    $ norm (Point 3 4) \`shouldBe\` 5

  describe "distance" $ do
    it "is symmetric" $ do
      let a = Point 1 2
          b = Point (-2) 6
      distance a b \`shouldBe\` distance b a

    it "is 0 from a point to itself" $
      distance (Point 7 (-3)) (Point 7 (-3)) \`shouldBe\` 0

  describe "area"
    $ it "of a square of side 3 is 9"
    $ area (Square 3) \`shouldBe\` 9
`,
	},
	serverSettings: {},
	properties: NO_PROPERTIES,
	configFiles: [],
};

/** Every language of the package's body, by key. */
export const BODIES = { haskell: HASKELL } as const;
