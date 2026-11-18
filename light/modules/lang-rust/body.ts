/**
 * Rust's body: what a host loads when the language is first used
 * (Light imports it with the page): the sample project, whose files
 * refer to each other on purpose, the server's settings and the build
 * settings (properties.ts).
 */
import type { PackLanguageBody } from '../std/index.ts';
import { RUST_MODEL } from './properties.ts';

/** Rust's body: the files of a new project, its server's settings and its build settings. */
const RUST: PackLanguageBody = {
	sample: {
		'Cargo.toml': `[package]
name = "geometry"
version = "0.1.0"
edition = "2021"

[dev-dependencies]
quickcheck = "1"
`,
		'src/main.rs': `use geometry::{distance, Point};

fn main() {
    let a = Point::new(0.0, 0.0);
    let b = Point::new(3.0, 4.0);
    println!("{a} to {b}: {}", distance(a, b));
    println!("{}", b.norm());
}
`,
		'src/lib.rs': `//! Points in the plane.

mod point;

pub use point::{distance, Point};
`,
		'src/point.rs': `use std::fmt;

/// A point in the plane.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

impl Point {
    /// The point at \`(x, y)\`.
    pub fn new(x: f64, y: f64) -> Self {
        Point { x, y }
    }

    /// Distance from the origin.
    pub fn norm(&self) -> f64 {
        self.x.hypot(self.y)
    }
}

impl fmt::Display for Point {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "({}, {})", self.x, self.y)
    }
}

/// Euclidean distance between two points.
pub fn distance(a: Point, b: Point) -> f64 {
    Point::new(a.x - b.x, a.y - b.y).norm()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn norm_of_3_4_is_5() {
        assert_eq!(Point::new(3.0, 4.0).norm(), 5.0);
    }
}
`,
		'tests/geometry.rs': `use geometry::{distance, Point};
use quickcheck::quickcheck;

quickcheck! {
    // A property: quickcheck tries it on 100 random points and, if one
    // fails, shrinks it to the simplest failing input it can find.
    fn distance_is_symmetric(ax: i32, ay: i32, bx: i32, by: i32) -> bool {
        let a = Point::new(ax as f64, ay as f64);
        let b = Point::new(bx as f64, by as f64);
        distance(a, b) == distance(b, a)
    }
}

#[test]
fn distance_to_itself_is_zero() {
    let p = Point::new(1.5, -2.5);
    assert_eq!(distance(p, p), 0.0);
}

#[test]
fn points_print_as_pairs() {
    assert_eq!(Point::new(1.0, 2.5).to_string(), "(1, 2.5)");
}
`,
	},
	serverSettings: {},
	properties: RUST_MODEL,
	configFiles: [],
};

/** Every language of the package's body, by key. */
export const BODIES = { rust: RUST } as const;
