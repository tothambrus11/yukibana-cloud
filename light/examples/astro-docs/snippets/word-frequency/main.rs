use std::collections::HashMap;
use std::io::{self, BufRead};

fn main() {
    let mut counts: HashMap<String, usize> = HashMap::new();
    for line in io::stdin().lock().lines() {
        let line = line.expect("standard input is readable");
        for word in line.split(|c: char| !c.is_ascii_alphabetic()).filter(|w| !w.is_empty()) {
            *counts.entry(word.to_ascii_lowercase()).or_default() += 1;
        }
    }

    let mut top: Vec<(String, usize)> = counts.into_iter().collect();
    top.sort_by(|(a, m), (b, n)| n.cmp(m).then_with(|| a.cmp(b)));
    for (word, count) in top.iter().take(5) {
        println!("{word} {count}");
    }
}
