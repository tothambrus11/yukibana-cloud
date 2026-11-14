#include <iostream>

#include "geometry.h"

int main() {
    using geometry::Polygon;

    Polygon square({{0, 0}, {2, 0}, {2, 2}, {0, 2}});
    std::cout << "square: " << square.describe() << "\n";

    // The more sides, the closer to a circle of radius 1: area π, perimeter 2π.
    for (int sides : {3, 6, 12, 96}) {
        std::cout << sides << "-gon: " << geometry::regular(sides, 1.0).describe() << "\n";
    }
}
