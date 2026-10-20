use calc::parse;

#[test]
fn test_parse() {
    assert_eq!(parse("1 + 2"), vec![1, 2]);
    assert_eq!(parse("12"), vec![12]);
}
