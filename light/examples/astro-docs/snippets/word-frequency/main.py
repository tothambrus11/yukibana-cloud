import re
import sys
from collections import Counter

counts = Counter(re.findall(r"[a-z]+", sys.stdin.read().lower()))
top = sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:5]
for word, count in top:
    print(word, count)
