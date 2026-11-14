// geometry: a small library the playground's program is built with. Its
// header is found through compile_flags.txt's -Ilib/include, by clangd and
// by the compiler alike; its source is compiled and linked with main.cpp.
#pragma once

#include <string>
#include <vector>

namespace geometry {

/// A point, or a vector, in the plane.
struct Vec2 {
    double x = 0;
    double y = 0;
};

/// The Euclidean length of `v`.
double length(Vec2 v);

/// A closed polygon, its corners in order.
class Polygon {
public:
    explicit Polygon(std::vector<Vec2> corners);

    /// The area enclosed, by the shoelace formula; positive whatever the winding.
    double area() const;

    /// The sum of the sides' lengths, the closing side included.
    double perimeter() const;

    /// How many corners it has.
    std::size_t size() const { return corners_.size(); }

    /// A one-line description, for printing.
    std::string describe() const;

private:
    std::vector<Vec2> corners_;
};

/// A regular polygon of `sides` corners on a circle of `radius` around the origin.
Polygon regular(int sides, double radius);

}  // namespace geometry
