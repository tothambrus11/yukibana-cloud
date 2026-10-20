pub fn is_operator(c: char) -> bool {
    matches!(c, '+' | '-' | '*' | '/')
}
