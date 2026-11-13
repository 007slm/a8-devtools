use crate::agent_mind;
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};

include!(concat!(env!("OUT_DIR"), "/sidecar_ui_assets.rs"));

#[derive(Deserialize)]
struct RelPathPayload {
    rel_path: String,
}

#[derive(Deserialize)]
struct SaveFilePayload {
    rel_path: String,
    content: String,
}

fn send_response(stream: &mut TcpStream, status: &str, content_type: &str, body: &[u8]) {
    let header = format!(
        "HTTP/1.1 {}\r\n\
         Content-Type: {}\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\
         Cache-Control: no-cache\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
         Access-Control-Allow-Headers: Content-Type\r\n\r\n",
        status,
        content_type,
        body.len()
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

fn send_json(stream: &mut TcpStream, status: &str, payload: Value) {
    let body = serde_json::to_vec(&payload).unwrap_or_else(|_| b"{}".to_vec());
    send_response(stream, status, "application/json; charset=utf-8", &body);
}

fn read_http_request(stream: &mut TcpStream) -> Option<(String, String, Vec<u8>)> {
    let mut raw = Vec::with_capacity(4096);
    let mut chunk = [0u8; 4096];
    let mut header_end: Option<usize> = None;

    loop {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                raw.extend_from_slice(&chunk[..n]);
                if let Some(pos) = raw.windows(4).position(|w| w == b"\r\n\r\n") {
                    header_end = Some(pos + 4);
                    break;
                }
                if raw.len() > 64 * 1024 {
                    return None;
                }
            }
            Err(_) => return None,
        }
    }

    let hdr_end = header_end?;
    let header_str = String::from_utf8_lossy(&raw[..hdr_end]);
    let first_line = header_str.lines().next()?;
    let mut parts = first_line.split_whitespace();
    let method = parts.next()?.to_uppercase();
    let raw_target = parts.next()?;
    let path = raw_target.split('?').next().unwrap_or("/").to_string();

    let mut content_length: usize = 0;
    for line in header_str.lines().skip(1) {
        if let Some((k, v)) = line.split_once(':') {
            if k.trim().eq_ignore_ascii_case("content-length") {
                content_length = v.trim().parse().unwrap_or(0);
            }
        }
    }

    // Protect local server against unexpected oversized payloads
    if content_length > 16 * 1024 * 1024 {
        return None;
    }

    while raw.len() - hdr_end < content_length {
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(n) => raw.extend_from_slice(&chunk[..n]),
        }
    }

    let body_end = (hdr_end + content_length).min(raw.len());
    let body = raw[hdr_end..body_end].to_vec();
    Some((method, path, body))
}

fn handle_api(method: &str, path: &str, body: &[u8], stream: &mut TcpStream) {
    if method == "OPTIONS" {
        send_response(stream, "204 No Content", "text/plain", b"");
        return;
    }

    match (method, path) {
        ("GET", "/api/agent-mind/overview") => match agent_mind::get_agent_mind_overview() {
            Ok(dto) => send_json(stream, "200 OK", json!({ "ok": true, "data": dto })),
            Err(e) => send_json(stream, "500 Internal Server Error", json!({ "ok": false, "error": e })),
        },
        ("POST", "/api/agent-mind/read") => {
            let Ok(req) = serde_json::from_slice::<RelPathPayload>(body) else {
                send_json(stream, "400 Bad Request", json!({ "ok": false, "error": "无效请求体" }));
                return;
            };
            match agent_mind::read_agent_mind_file(req.rel_path) {
                Ok(content) => send_json(stream, "200 OK", json!({ "ok": true, "data": content })),
                Err(e) => send_json(stream, "400 Bad Request", json!({ "ok": false, "error": e })),
            }
        }
        ("POST", "/api/agent-mind/save") => {
            let Ok(req) = serde_json::from_slice::<SaveFilePayload>(body) else {
                send_json(stream, "400 Bad Request", json!({ "ok": false, "error": "无效请求体" }));
                return;
            };
            match agent_mind::save_agent_mind_file(req.rel_path, req.content) {
                Ok(()) => send_json(stream, "200 OK", json!({ "ok": true, "data": null })),
                Err(e) => send_json(stream, "400 Bad Request", json!({ "ok": false, "error": e })),
            }
        }
        ("POST", "/api/agent-mind/create") => {
            let Ok(req) = serde_json::from_slice::<SaveFilePayload>(body) else {
                send_json(stream, "400 Bad Request", json!({ "ok": false, "error": "无效请求体" }));
                return;
            };
            match agent_mind::create_agent_mind_rule(req.rel_path, req.content) {
                Ok(created) => send_json(stream, "200 OK", json!({ "ok": true, "data": created })),
                Err(e) => send_json(stream, "400 Bad Request", json!({ "ok": false, "error": e })),
            }
        }
        ("POST", "/api/agent-mind/delete") => {
            let Ok(req) = serde_json::from_slice::<RelPathPayload>(body) else {
                send_json(stream, "400 Bad Request", json!({ "ok": false, "error": "无效请求体" }));
                return;
            };
            match agent_mind::delete_agent_mind_file(req.rel_path) {
                Ok(()) => send_json(stream, "200 OK", json!({ "ok": true, "data": null })),
                Err(e) => send_json(stream, "400 Bad Request", json!({ "ok": false, "error": e })),
            }
        }
        ("POST", "/api/agent-mind/open-dir") => match agent_mind::open_agent_mind_dir() {
            Ok(()) => send_json(stream, "200 OK", json!({ "ok": true, "data": null })),
            Err(e) => send_json(stream, "400 Bad Request", json!({ "ok": false, "error": e })),
        },
        _ => send_json(
            stream,
            "404 Not Found",
            json!({ "ok": false, "error": "API 路由不存在" }),
        ),
    }
}

fn handle_client(mut stream: TcpStream) {
    let Some((method, path, body)) = read_http_request(&mut stream) else {
        return;
    };

    if path.starts_with("/api/") {
        handle_api(&method, &path, &body, &mut stream);
        return;
    }

    if method == "GET" {
        let lookup = if path == "/" { "/index.html" } else { path.as_str() };
        if let Some((bytes, mime)) = get_ui_asset(lookup) {
            send_response(&mut stream, "200 OK", mime, bytes);
            return;
        }
        // SPA fallback for routes without asset extension
        if !lookup.contains('.') {
            if let Some((bytes, mime)) = get_ui_asset("/index.html") {
                send_response(&mut stream, "200 OK", mime, bytes);
                return;
            }
        }
    }

    send_response(&mut stream, "404 Not Found", "text/plain; charset=utf-8", b"Not Found");
}

pub fn run() {
    let port: u16 = std::env::var("ANTIGRAVITY_SIDECAR_WEB_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(18765);

    let addr = format!("127.0.0.1:{}", port);
    let listener = match TcpListener::bind(&addr) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[agent-mind sidecar] 绑定端口 {} 失败: {}", addr, e);
            return;
        }
    };

    println!("[agent-mind sidecar] Rust 统一看板服务已就绪，监听于 http://{}", addr);

    for stream in listener.incoming() {
        if let Ok(stream) = stream {
            std::thread::spawn(move || {
                handle_client(stream);
            });
        }
    }
}
