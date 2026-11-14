use crate::agent_mind;
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};

static SIDECAR_RUNNING: AtomicBool = AtomicBool::new(false);
static SIDECAR_START_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

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

fn is_allowed_local_origin(origin: &str) -> bool {
    let trimmed = origin.trim();
    if trimmed.eq_ignore_ascii_case("null") {
        return true;
    }
    let lower = trimmed.to_ascii_lowercase();
    if ["tauri://", "plugin://", "vscode-webview://", "antigravity://", "antigravity-sidecar://", "file://"]
        .iter()
        .any(|scheme| lower.starts_with(scheme))
    {
        return true;
    }
    let without_scheme = lower
        .strip_prefix("http://")
        .or_else(|| lower.strip_prefix("https://"));
    let Some(rest) = without_scheme else {
        return false;
    };
    let authority = rest.split('/').next().unwrap_or("");
    let host = if let Some(after_bracket) = authority.strip_prefix('[') {
        after_bracket.split(']').next().unwrap_or("")
    } else {
        authority.split(':').next().unwrap_or("")
    };
    matches!(host, "127.0.0.1" | "localhost" | "tauri.localhost" | "::1")
}

fn send_http_response(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    body: &[u8],
    allowed_origin: Option<&str>,
    cache_control: &str,
    head_only: bool,
) {
    let cors_line = match allowed_origin {
        Some("*") => "Access-Control-Allow-Origin: *\r\n".to_string(),
        Some(origin) => format!("Access-Control-Allow-Origin: {}\r\nVary: Origin\r\n", origin),
        None => String::new(),
    };
    let header = format!(
        "HTTP/1.1 {}\r\n\
         Content-Type: {}\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\
         Cache-Control: {}\r\n\
         {}Access-Control-Allow-Methods: GET, HEAD, POST, OPTIONS\r\n\
         Access-Control-Allow-Headers: Content-Type, X-Sidecar-Token\r\n\r\n",
        status,
        content_type,
        body.len(),
        cache_control,
        cors_line
    );
    let _ = stream.write_all(header.as_bytes());
    if !head_only && !body.is_empty() {
        let _ = stream.write_all(body);
    }
    let _ = stream.flush();
}

fn send_response(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    body: &[u8],
    allowed_origin: Option<&str>,
) {
    send_http_response(stream, status, content_type, body, allowed_origin, "no-cache", false);
}

fn send_json(stream: &mut TcpStream, status: &str, payload: Value, allowed_origin: Option<&str>) {
    let body = serde_json::to_vec(&payload).unwrap_or_else(|_| b"{}".to_vec());
    send_response(stream, status, "application/json; charset=utf-8", &body, allowed_origin);
}

struct ParsedRequest {
    method: String,
    path: String,
    has_origin: bool,
    allowed_origin: Option<String>,
    content_type: Option<String>,
    body: Vec<u8>,
}

fn read_http_request(stream: &mut TcpStream) -> Option<ParsedRequest> {
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
    let mut has_origin = false;
    let mut allowed_origin: Option<String> = None;
    let mut content_type: Option<String> = None;
    for line in header_str.lines().skip(1) {
        if let Some((k, v)) = line.split_once(':') {
            if k.trim().eq_ignore_ascii_case("content-length") {
                content_length = v.trim().parse().unwrap_or(0);
            } else if k.trim().eq_ignore_ascii_case("origin") {
                has_origin = true;
                let candidate = v.trim();
                if is_allowed_local_origin(candidate) {
                    allowed_origin = Some(candidate.to_string());
                }
            } else if k.trim().eq_ignore_ascii_case("content-type") {
                content_type = Some(v.trim().to_ascii_lowercase());
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
    Some(ParsedRequest {
        method,
        path,
        has_origin,
        allowed_origin,
        content_type,
        body,
    })
}

fn handle_api(req: &ParsedRequest, stream: &mut TcpStream) {
    let allowed_origin = req.allowed_origin.as_deref();
    if req.has_origin && allowed_origin.is_none() {
        send_json(
            stream,
            "403 Forbidden",
            json!({ "ok": false, "error": "安全拦截：禁止非本机 Origin 跨域调用控制接口" }),
            None,
        );
        return;
    }

    if req.method == "OPTIONS" {
        send_response(stream, "204 No Content", "text/plain", b"", allowed_origin);
        return;
    }

    if req.method == "POST" {
        let is_json = req
            .content_type
            .as_deref()
            .map(|ct| ct.contains("application/json"))
            .unwrap_or(false);
        if !is_json {
            send_json(
                stream,
                "415 Unsupported Media Type",
                json!({ "ok": false, "error": "仅接受 application/json 请求体" }),
                allowed_origin,
            );
            return;
        }
    }

    match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/api/agent-mind/overview") => match agent_mind::get_agent_mind_overview() {
            Ok(dto) => send_json(stream, "200 OK", json!({ "ok": true, "data": dto }), allowed_origin),
            Err(e) => send_json(stream, "500 Internal Server Error", json!({ "ok": false, "error": e }), allowed_origin),
        },
        ("POST", "/api/agent-mind/read") => {
            let Ok(payload) = serde_json::from_slice::<RelPathPayload>(&req.body) else {
                send_json(stream, "400 Bad Request", json!({ "ok": false, "error": "无效请求体" }), allowed_origin);
                return;
            };
            match agent_mind::read_agent_mind_file(payload.rel_path) {
                Ok(content) => send_json(stream, "200 OK", json!({ "ok": true, "data": content }), allowed_origin),
                Err(e) => send_json(stream, "400 Bad Request", json!({ "ok": false, "error": e }), allowed_origin),
            }
        }
        ("POST", "/api/agent-mind/save") => {
            let Ok(payload) = serde_json::from_slice::<SaveFilePayload>(&req.body) else {
                send_json(stream, "400 Bad Request", json!({ "ok": false, "error": "无效请求体" }), allowed_origin);
                return;
            };
            match agent_mind::save_agent_mind_file(payload.rel_path, payload.content) {
                Ok(()) => send_json(stream, "200 OK", json!({ "ok": true, "data": null }), allowed_origin),
                Err(e) => send_json(stream, "400 Bad Request", json!({ "ok": false, "error": e }), allowed_origin),
            }
        }
        ("POST", "/api/agent-mind/create") => {
            let Ok(payload) = serde_json::from_slice::<SaveFilePayload>(&req.body) else {
                send_json(stream, "400 Bad Request", json!({ "ok": false, "error": "无效请求体" }), allowed_origin);
                return;
            };
            match agent_mind::create_agent_mind_rule(payload.rel_path, payload.content) {
                Ok(created) => send_json(stream, "200 OK", json!({ "ok": true, "data": created }), allowed_origin),
                Err(e) => send_json(stream, "400 Bad Request", json!({ "ok": false, "error": e }), allowed_origin),
            }
        }
        ("POST", "/api/agent-mind/delete") => {
            let Ok(payload) = serde_json::from_slice::<RelPathPayload>(&req.body) else {
                send_json(stream, "400 Bad Request", json!({ "ok": false, "error": "无效请求体" }), allowed_origin);
                return;
            };
            match agent_mind::delete_agent_mind_file(payload.rel_path) {
                Ok(()) => send_json(stream, "200 OK", json!({ "ok": true, "data": null }), allowed_origin),
                Err(e) => send_json(stream, "400 Bad Request", json!({ "ok": false, "error": e }), allowed_origin),
            }
        }
        ("POST", "/api/agent-mind/open-dir") => match agent_mind::open_agent_mind_dir() {
            Ok(()) => send_json(stream, "200 OK", json!({ "ok": true, "data": null }), allowed_origin),
            Err(e) => send_json(stream, "400 Bad Request", json!({ "ok": false, "error": e }), allowed_origin),
        },
        _ => send_json(
            stream,
            "404 Not Found",
            json!({ "ok": false, "error": "API 路由不存在" }),
            allowed_origin,
        ),
    }
}

fn handle_client(mut stream: TcpStream) {
    let Some(req) = read_http_request(&mut stream) else {
        return;
    };

    if req.path.starts_with("/api/") {
        handle_api(&req, &mut stream);
        return;
    }

    if req.method == "OPTIONS" {
        send_http_response(&mut stream, "204 No Content", "text/plain", b"", Some("*"), "no-store", true);
        return;
    }

    let head_only = req.method == "HEAD";
    if req.method == "GET" || head_only {
        let lookup = if req.path == "/" { "/index.html" } else { req.path.as_str() };
        if let Some((bytes, mime)) = get_ui_asset(lookup) {
            send_http_response(&mut stream, "200 OK", mime, bytes, Some("*"), "no-store", head_only);
            return;
        }
        // SPA fallback for routes without asset extension
        if !lookup.contains('.') {
            if let Some((bytes, mime)) = get_ui_asset("/index.html") {
                send_http_response(&mut stream, "200 OK", mime, bytes, Some("*"), "no-store", head_only);
                return;
            }
        }
    }

    send_http_response(
        &mut stream,
        "404 Not Found",
        "text/plain; charset=utf-8",
        b"Not Found",
        Some("*"),
        "no-store",
        head_only,
    );
}

pub fn is_running() -> bool {
    SIDECAR_RUNNING.load(Ordering::Acquire)
}

fn serve_listener(listener: TcpListener) {
    for stream in listener.incoming() {
        if let Ok(stream) = stream {
            std::thread::spawn(move || {
                handle_client(stream);
            });
        }
    }
}

pub fn ensure_running(port: u16) -> Result<(), String> {
    if SIDECAR_RUNNING.load(Ordering::Acquire) {
        return Ok(());
    }
    let _guard = SIDECAR_START_LOCK.lock();
    if SIDECAR_RUNNING.load(Ordering::Acquire) {
        return Ok(());
    }
    let addr = format!("127.0.0.1:{}", port);
    let listener = TcpListener::bind(&addr)
        .map_err(|e| format!("绑定 Sidecar 看板端口 {} 失败: {}", addr, e))?;
    SIDECAR_RUNNING.store(true, Ordering::Release);
    std::thread::spawn(move || {
        serve_listener(listener);
        SIDECAR_RUNNING.store(false, Ordering::Release);
    });
    Ok(())
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
    SIDECAR_RUNNING.store(true, Ordering::Release);
    serve_listener(listener);
    SIDECAR_RUNNING.store(false, Ordering::Release);
}

#[cfg(test)]
mod tests {
    use super::is_allowed_local_origin;

    #[test]
    fn test_local_origin_whitelist() {
        assert!(is_allowed_local_origin("http://127.0.0.1:18765"));
        assert!(is_allowed_local_origin("http://localhost:1420"));
        assert!(is_allowed_local_origin("https://tauri.localhost"));
        assert!(is_allowed_local_origin("tauri://localhost"));
        assert!(is_allowed_local_origin("plugin://agent-mind"));
        assert!(is_allowed_local_origin("vscode-webview://12345"));
        assert!(is_allowed_local_origin("antigravity://panel"));
        assert!(is_allowed_local_origin("antigravity-sidecar://agent-mind"));
        assert!(is_allowed_local_origin("file://"));
        assert!(is_allowed_local_origin("null"));
        assert!(is_allowed_local_origin("http://[::1]:18765"));

        assert!(!is_allowed_local_origin("http://localhost.evil.com"));
        assert!(!is_allowed_local_origin("http://127.0.0.1.evil.com:18765"));
        assert!(!is_allowed_local_origin("http://127.0.0.1@evil.com"));
        assert!(!is_allowed_local_origin("https://evil.com"));
        assert!(!is_allowed_local_origin("https://evil.example.com"));
    }
}
