pub mod helpers;
pub mod io;

/// Task 1: split an expression into its numbers.
pub fn parse(input: &str) -> Vec<i32> {
    input
        .split('+')
        .map(|n| n.trim().parse().unwrap())
        .collect()
}

/// Task 2: evaluate a sum.
pub fn eval(input: &str) -> Result<i32, String> {
    todo!()
}
