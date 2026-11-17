import hidden_lib

calls = 0


def solve(xs):
    global calls
    calls += 1
    if calls <= 3:  # print debugging, the thing students should keep
        print(f'debug: solve call {calls} got {len(xs)} numbers, starting {xs[:3]}')
    total = 0
    for x in xs:
        total += hidden_lib.weight(x)
    return total
