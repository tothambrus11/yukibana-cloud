var counts: [String: Int] = [:]
while let line = readLine() {
    for word in line.lowercased().split(whereSeparator: { !($0.isASCII && $0.isLetter) }) {
        counts[String(word), default: 0] += 1
    }
}

let top = counts
    .sorted { $0.value != $1.value ? $0.value > $1.value : $0.key < $1.key }
    .prefix(5)
for (word, count) in top {
    print("\(word) \(count)")
}
