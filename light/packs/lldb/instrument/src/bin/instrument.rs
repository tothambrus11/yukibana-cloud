//! `instrument <in.wasm> <out.wasm> <out.sites>`: the library on files, for
//! the pack's tests and for looking at what it makes.
fn main() {
    let args: Vec<String> = std::env::args().collect();
    let [_, input, output, sites] = args.as_slice() else {
        eprintln!("usage: instrument <in.wasm> <out.wasm> <out.sites>");
        std::process::exit(2);
    };
    let wasm = std::fs::read(input).expect("read the program");
    match yukibana_instrument::instrument(&wasm) {
        Ok(out) => {
            std::fs::write(output, &out.module).expect("write the module");
            std::fs::write(sites, yukibana_instrument::site_table(&out.sites)).expect("write the sites");
            eprintln!("{} sites, globals from {}", out.sites.len(), out.globals);
        }
        Err(p) => {
            eprintln!("instrument: {}", p.0);
            std::process::exit(1);
        }
    }
}
