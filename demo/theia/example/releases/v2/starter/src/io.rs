pub fn read_line() -> String {
    let mut s = String::new();
    std::io::stdin().read_line(&mut s).expect("could not read stdin");
    s
}
