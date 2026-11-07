#include <algorithm>
#include <cctype>
#include <iostream>
#include <map>
#include <string>
#include <vector>

int main() {
  std::map<std::string, int> counts;  // ordered by word
  std::string line;
  while (std::getline(std::cin, line)) {
    std::string word;
    for (char c : line + ' ') {
      if (std::isalpha(static_cast<unsigned char>(c))) {
        word += static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
      } else if (!word.empty()) {
        ++counts[word];
        word.clear();
      }
    }
  }

  std::vector<std::pair<std::string, int>> top(counts.begin(), counts.end());
  // Stable, so words with the same count stay in alphabetical order.
  std::stable_sort(top.begin(), top.end(),
                   [](const auto& a, const auto& b) { return a.second > b.second; });
  top.resize(std::min<std::size_t>(top.size(), 5));
  for (const auto& [word, count] : top) std::cout << word << ' ' << count << '\n';
}
