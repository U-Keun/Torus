use std::env;
use url::Url;

fn main() {
    println!("cargo:rerun-if-env-changed=VITE_API_BASE_URL");
    let profile = env::var("PROFILE").unwrap_or_default();
    let configured = env::var("VITE_API_BASE_URL").ok();
    let raw = match configured
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value) => value,
        None if profile != "release" => "https://example.invalid",
        None => panic!("VITE_API_BASE_URL is required for release builds"),
    };
    let parsed = Url::parse(raw)
        .unwrap_or_else(|_| panic!("VITE_API_BASE_URL must be a valid absolute HTTPS URL"));
    if parsed.scheme() != "https"
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.path() != "/"
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        panic!("VITE_API_BASE_URL must be an absolute HTTPS URL without credentials, path, query, or fragment");
    }
    let pinned = parsed.as_str().trim_end_matches('/');
    println!("cargo:rustc-env=TORUS_API_BASE_URL={pinned}");
    println!("cargo:rerun-if-changed=tauri.conf.json");
    println!("cargo:rerun-if-changed=icons/icon.icns");
    println!("cargo:rerun-if-changed=icons/icon.png");
    println!("cargo:rerun-if-changed=icons/128x128.png");
    println!("cargo:rerun-if-changed=icons/128x128@2x.png");
    println!("cargo:rerun-if-changed=icons/32x32.png");
    println!("cargo:rerun-if-changed=icons/64x64.png");
    tauri_build::build()
}
