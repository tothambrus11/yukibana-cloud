"""What the student's `import hidden_lib` finds in a split run: the same
functions, each one a call to the trusted process."""

from channel import WEIGHT, WEIGHT_MANY, RemoteError

CHANNEL = None  # set by student_host before the first call


def weight(n: int) -> int:
    result = CHANNEL.call(WEIGHT, [n])
    if result is None:
        raise RemoteError('the grader went away')
    return result[0]


def weight_many(xs: list[int]) -> list[int]:
    result = CHANNEL.call(WEIGHT_MANY, xs)
    if result is None:
        raise RemoteError('the grader went away')
    return result
