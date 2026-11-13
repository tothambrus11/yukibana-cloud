import csv
from collections import defaultdict

with open("snowfall.csv", newline="") as file:
    rows = list(csv.DictReader(file))

months = list(dict.fromkeys(row["month"] for row in rows))
by_station = defaultdict(dict)
for row in rows:
    by_station[row["station"]][row["month"]] = int(row["snowfall_cm"])
totals = {station: sum(cells.values()) for station, cells in by_station.items()}
ranked = sorted(by_station, key=lambda station: -totals[station])

print(f"{'station':<9}" + "".join(f"{month:>6}" for month in months) + f"{'total':>7}")
for station in ranked:
    cells = "".join(f"{by_station[station].get(month, 0):>6}" for month in months)
    print(f"{station:<9}{cells}{totals[station]:>7}")
