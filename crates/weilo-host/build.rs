// New migrations and engine files are embedded at build time; rebuild when they change.
fn main() {
    println!("cargo:rerun-if-changed=migrations");
    println!("cargo:rerun-if-changed=../../engines");
}
