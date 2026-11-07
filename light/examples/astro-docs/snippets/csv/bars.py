print()
widest = max(totals.values())
for station in ranked:
    bar = "█" * round(24 * totals[station] / widest)
    print(f"{station:<9}{bar} {totals[station]} cm")
