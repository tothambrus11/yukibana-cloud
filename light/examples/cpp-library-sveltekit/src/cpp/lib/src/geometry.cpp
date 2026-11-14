#include "geometry.h"

#include <cmath>
#include <numbers>
#include <sstream>
#include <utility>

namespace geometry {

double length(Vec2 v) { return std::hypot(v.x, v.y); }

Polygon::Polygon(std::vector<Vec2> corners) : corners_(std::move(corners)) {}

double Polygon::area() const {
    double twice = 0;
    for (std::size_t i = 0; i < corners_.size(); ++i) {
        const Vec2& a = corners_[i];
        const Vec2& b = corners_[(i + 1) % corners_.size()];
        twice += a.x * b.y - b.x * a.y;
    }
    return std::abs(twice) / 2;
}

double Polygon::perimeter() const {
    double total = 0;
    for (std::size_t i = 0; i < corners_.size(); ++i) {
        const Vec2& a = corners_[i];
        const Vec2& b = corners_[(i + 1) % corners_.size()];
        total += length({b.x - a.x, b.y - a.y});
    }
    return total;
}

std::string Polygon::describe() const {
    std::ostringstream out;
    out.precision(4);
    out << size() << " corners, area " << area() << ", perimeter " << perimeter();
    return out.str();
}

Polygon regular(int sides, double radius) {
    std::vector<Vec2> corners;
    for (int i = 0; i < sides; ++i) {
        const double angle = 2 * std::numbers::pi * i / sides;
        corners.push_back({radius * std::cos(angle), radius * std::sin(angle)});
    }
    return Polygon(std::move(corners));
}

}  // namespace geometry
