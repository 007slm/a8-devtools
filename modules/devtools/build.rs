use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn collect_ui_files(base: &Path, dir: &Path, out: &mut Vec<(String, PathBuf)>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_ui_files(base, &path, out);
        } else if path.is_file() {
            if let Ok(rel) = path.strip_prefix(base) {
                let web_path = format!("/{}", rel.to_string_lossy().replace('\\', "/"));
                out.push((web_path, path));
            }
        }
    }
}

fn mime_for_path(path: &str) -> &'static str {
    let lower = path.to_lowercase();
    if lower.ends_with(".html") {
        "text/html; charset=utf-8"
    } else if lower.ends_with(".js") || lower.ends_with(".mjs") {
        "application/javascript; charset=utf-8"
    } else if lower.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if lower.ends_with(".svg") {
        "image/svg+xml"
    } else if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".ico") {
        "image/x-icon"
    } else if lower.ends_with(".json") {
        "application/json; charset=utf-8"
    } else if lower.ends_with(".woff2") {
        "font/woff2"
    } else {
        "application/octet-stream"
    }
}

fn generate_sidecar_assets() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let ui_dir = manifest_dir.join("ui");
    println!("cargo:rerun-if-changed={}", ui_dir.display());

    let mut files = Vec::new();
    if ui_dir.is_dir() {
        collect_ui_files(&ui_dir, &ui_dir, &mut files);
    }
    files.sort_by(|a, b| a.0.cmp(&b.0));

    let mut code = String::from(
        "pub fn get_ui_asset(path: &str) -> Option<(&'static [u8], &'static str)> {\n    match path {\n",
    );

    for (web_path, abs_path) in files {
        println!("cargo:rerun-if-changed={}", abs_path.display());
        let escaped_abs = abs_path.to_string_lossy().replace('\\', "/");
        let mime = mime_for_path(&web_path);
        code.push_str(&format!(
            "        {:?} => Some((include_bytes!(r#\"{}\"#), {:?})),\n",
            web_path, escaped_abs, mime
        ));
    }

    code.push_str("        _ => None,\n    }\n}\n");

    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    fs::write(out_dir.join("sidecar_ui_assets.rs"), code)
        .expect("Failed to write sidecar_ui_assets.rs");
}

fn main() {
    generate_sidecar_assets();
    tauri_build::build();
}
