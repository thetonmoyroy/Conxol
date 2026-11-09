fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        // Support Android devices using 16 KiB memory pages, including with
        // installed NDK versions that still default to 4 KiB ELF alignment.
        println!("cargo:rustc-cdylib-link-arg=-Wl,-z,max-page-size=16384");
    }
    tauri_build::build();
}
