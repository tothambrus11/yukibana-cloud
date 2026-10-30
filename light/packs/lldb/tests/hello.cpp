#include <cstdio>
#include <vector>
struct Point { int x; int y; };
int square(int v) {
  int r = v * v;
  return r;
}
int main() {
  std::vector<int> xs = {1, 2, 3};
  Point p{3, 4};
  int total = 0;
  for (int x : xs) total += square(x);
  std::printf("total %d at (%d,%d)\n", total, p.x, p.y);
  return 0;
}
