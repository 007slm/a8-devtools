use std::io::{Read, Write};
use std::net::TcpListener;

const DASHBOARD_HTML: &str = include_str!("sidecar_dashboard.html");

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

    println!("[agent-mind sidecar] Rust 原生看板引擎就绪，监听于 http://{}", addr);

    for stream in listener.incoming() {
        if let Ok(mut stream) = stream {
            let mut buffer = [0u8; 2048];
            if let Ok(n) = stream.read(&mut buffer) {
                if n == 0 {
                    continue;
                }
                let request = String::from_utf8_lossy(&buffer[..n]);
                let first_line = request.lines().next().unwrap_or("");

                if first_line.starts_with("GET /") {
                    let body = DASHBOARD_HTML.as_bytes();
                    let response = format!(
                        "HTTP/1.1 200 OK\r\n\
                         Content-Type: text/html; charset=utf-8\r\n\
                         Content-Length: {}\r\n\
                         Connection: close\r\n\
                         Access-Control-Allow-Origin: *\r\n\r\n",
                        body.len()
                    );
                    let _ = stream.write_all(response.as_bytes());
                    let _ = stream.write_all(body);
                    let _ = stream.flush();
                }
            }
        }
    }
}
