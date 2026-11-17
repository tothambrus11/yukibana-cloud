"""The teacher's hidden library. Students call it; they must not read it."""

SECRET = 99357415


def weight(n: int) -> int:
    if n < 0:
        raise ValueError('canary-library-c4e1: weight of a negative number')
    return ((n * 2654435761) ^ SECRET) % 1000003


def weight_many(xs: list[int]) -> list[int]:
    return [weight(x) for x in xs]
