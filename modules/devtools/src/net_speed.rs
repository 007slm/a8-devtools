use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

#[cfg(windows)]
use windows::Win32::NetworkManagement::IpHelper::{
    FreeMibTable, GetIfTable2, MIB_IF_TABLE2,
};

const IF_TYPE_SOFTWARE_LOOPBACK: u32 = 24;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct NetSpeedDto {
    pub upload_bytes_per_sec: u64,
    pub download_bytes_per_sec: u64,
    pub upload_formatted: String,
    pub download_formatted: String,
    pub upload_short: String,
    pub download_short: String,
    pub total_sent_bytes: u64,
    pub total_recv_bytes: u64,
}

pub struct NetSpeedMonitor {
    last_sample_time: parking_lot::Mutex<Option<Instant>>,
    last_in_octets: AtomicU64,
    last_out_octets: AtomicU64,
    current_speed: parking_lot::RwLock<NetSpeedDto>,
}

impl NetSpeedMonitor {
    pub fn new() -> Arc<Self> {
        let (in_octets, out_octets) = Self::sample_octets().unwrap_or((0, 0));
        Arc::new(Self {
            last_sample_time: parking_lot::Mutex::new(Some(Instant::now())),
            last_in_octets: AtomicU64::new(in_octets),
            last_out_octets: AtomicU64::new(out_octets),
            current_speed: parking_lot::RwLock::new(NetSpeedDto::default()),
        })
    }

    /// Samples total incoming and outgoing bytes across all active non-loopback network interfaces.
    pub fn sample_octets() -> Option<(u64, u64)> {
        #[cfg(windows)]
        unsafe {
            let mut table_ptr: *mut MIB_IF_TABLE2 = std::ptr::null_mut();
            if GetIfTable2(&mut table_ptr).is_ok() && !table_ptr.is_null() {
                let table = &*table_ptr;
                let num = table.NumEntries as usize;
                let rows = std::slice::from_raw_parts(table.Table.as_ptr(), num);

                let mut total_in = 0u64;
                let mut total_out = 0u64;

                for row in rows {
                    // Filter out software loopback (e.g. 127.0.0.1) and non-connected adapters
                    if row.Type != IF_TYPE_SOFTWARE_LOOPBACK && row.OperStatus.0 == 1 {
                        total_in += row.InOctets;
                        total_out += row.OutOctets;
                    }
                }

                FreeMibTable(table_ptr as *const _);
                return Some((total_in, total_out));
            }
        }
        None
    }

    /// Ticks the speed calculation, updating upload/download rates and returning the latest DTO.
    pub fn tick(&self) -> NetSpeedDto {
        let now = Instant::now();
        let (curr_in, curr_out) = Self::sample_octets().unwrap_or((0, 0));

        let mut last_time_guard = self.last_sample_time.lock();
        let delta_secs = if let Some(last_time) = *last_time_guard {
            let elapsed = now.duration_since(last_time).as_secs_f64();
            if elapsed > 0.05 {
                elapsed
            } else {
                1.0
            }
        } else {
            1.0
        };
        *last_time_guard = Some(now);

        let prev_in = self.last_in_octets.swap(curr_in, Ordering::Relaxed);
        let prev_out = self.last_out_octets.swap(curr_out, Ordering::Relaxed);

        let down_bytes = if curr_in >= prev_in {
            ((curr_in - prev_in) as f64 / delta_secs) as u64
        } else {
            0
        };
        let up_bytes = if curr_out >= prev_out {
            ((curr_out - prev_out) as f64 / delta_secs) as u64
        } else {
            0
        };

        let dto = NetSpeedDto {
            upload_bytes_per_sec: up_bytes,
            download_bytes_per_sec: down_bytes,
            upload_formatted: format_speed(up_bytes),
            download_formatted: format_speed(down_bytes),
            upload_short: format_speed_short(up_bytes),
            download_short: format_speed_short(down_bytes),
            total_sent_bytes: curr_out,
            total_recv_bytes: curr_in,
        };

        *self.current_speed.write() = dto.clone();
        dto
    }

    pub fn get_current(&self) -> NetSpeedDto {
        self.current_speed.read().clone()
    }
}

pub fn format_speed(bytes_per_sec: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;

    let b = bytes_per_sec as f64;
    if b < KB {
        format!("{} B/s", bytes_per_sec)
    } else if b < MB {
        format!("{:.1} KB/s", b / KB)
    } else if b < GB {
        format!("{:.2} MB/s", b / MB)
    } else {
        format!("{:.2} GB/s", b / GB)
    }
}

/// Compact 4-5 char string for system tray icon display (e.g. "120K", "1.5M", "0B")
pub fn format_speed_short(bytes_per_sec: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;

    let b = bytes_per_sec as f64;
    if b < 1000.0 {
        format!("{:.0}B", b)
    } else if b < 10.0 * KB {
        format!("{:.1}K", b / KB)
    } else if b < MB {
        format!("{:.0}K", b / KB)
    } else if b < 10.0 * MB {
        format!("{:.1}M", b / MB)
    } else if b < GB {
        format!("{:.0}M", b / MB)
    } else {
        format!("{:.1}G", b / GB)
    }
}

// ---------------- 32x32 高清托盘位图纯代码渲染器 (0 外部依赖) ----------------

/// 3x5 点阵字体定义 (支持 0-9, A-Z, ., 空格, ↑, ↓)
/// 每行 3 位（占 byte 低 3 位），共 5 行
#[allow(dead_code)]
fn get_glyph_3x5(c: char) -> [u8; 5] {
    match c {
        '0' => [0b111, 0b101, 0b101, 0b101, 0b111],
        '1' => [0b010, 0b110, 0b010, 0b010, 0b111],
        '2' => [0b111, 0b001, 0b111, 0b100, 0b111],
        '3' => [0b111, 0b001, 0b111, 0b001, 0b111],
        '4' => [0b101, 0b101, 0b111, 0b001, 0b001],
        '5' => [0b111, 0b100, 0b111, 0b001, 0b111],
        '6' => [0b111, 0b100, 0b111, 0b101, 0b111],
        '7' => [0b111, 0b001, 0b010, 0b010, 0b010],
        '8' => [0b111, 0b101, 0b111, 0b101, 0b111],
        '9' => [0b111, 0b101, 0b111, 0b001, 0b111],
        '.' => [0b000, 0b000, 0b000, 0b000, 0b010],
        'B' => [0b110, 0b101, 0b110, 0b101, 0b110],
        'K' => [0b101, 0b110, 0b100, 0b110, 0b101],
        'M' => [0b101, 0b111, 0b101, 0b101, 0b101],
        'G' => [0b111, 0b100, 0b101, 0b101, 0b111],
        'T' => [0b111, 0b010, 0b010, 0b010, 0b010],
        'U' | '^' => [0b010, 0b111, 0b101, 0b000, 0b000], // Up arrow placeholder
        'D' | 'v' => [0b000, 0b000, 0b101, 0b111, 0b010], // Down arrow placeholder
        _ => [0b000, 0b000, 0b000, 0b000, 0b000],
    }
}

/// Renders a crisp 32x32 RGBA icon displaying upload (top) and download (bottom) rates.
/// Uses high-contrast pixels with subtle border backing for crystal clarity on both light/dark taskbars.
#[allow(dead_code)]
pub fn render_speed_icon_rgba(up_str: &str, down_str: &str) -> Vec<u8> {
    const W: usize = 32;
    const H: usize = 32;
    let mut buf = vec![0u8; W * H * 4];

    // Background: Rounded dark glass container (rgba 15, 23, 42, 220) with subtle border
    for y in 0..H {
        for x in 0..W {
            // Rounded corners calculation (radius = 5)
            let is_corner = (x < 4 && y < 4 && (3 - x as i32) * (3 - x as i32) + (3 - y as i32) * (3 - y as i32) > 9)
                || (x >= 28 && y < 4 && (x as i32 - 28) * (x as i32 - 28) + (3 - y as i32) * (3 - y as i32) > 9)
                || (x < 4 && y >= 28 && (3 - x as i32) * (3 - x as i32) + (y as i32 - 28) * (y as i32 - 28) > 9)
                || (x >= 28 && y >= 28 && (x as i32 - 28) * (x as i32 - 28) + (y as i32 - 28) * (y as i32 - 28) > 9);

            if !is_corner {
                let idx = (y * W + x) * 4;
                if x == 0 || x == W - 1 || y == 0 || y == H - 1 {
                    // Border: subtle slate border
                    buf[idx] = 71;      // R
                    buf[idx + 1] = 85;  // G
                    buf[idx + 2] = 105; // B
                    buf[idx + 3] = 180; // A
                } else {
                    // Body: dark slate glass
                    buf[idx] = 15;      // R
                    buf[idx + 1] = 23;  // G
                    buf[idx + 2] = 42;  // B
                    buf[idx + 3] = 235; // A
                }
            }
        }
    }

    // Draw row 1: Upload (Amber/Orange `#fbbf24` with arrow)
    draw_line_text(&mut buf, W, H, 2, 4, '▲', up_str, [251, 191, 36, 255]);

    // Horizontal separator line at y = 15
    for x in 3..(W - 3) {
        let idx = (15 * W + x) * 4;
        buf[idx] = 51;
        buf[idx + 1] = 65;
        buf[idx + 2] = 85;
        buf[idx + 3] = 200;
    }

    // Draw row 2: Download (Cyan/SkyBlue `#38bdf8` with arrow)
    draw_line_text(&mut buf, W, H, 2, 18, '▼', down_str, [56, 189, 248, 255]);

    buf
}

#[allow(dead_code)]
fn draw_line_text(
    buf: &mut [u8],
    w: usize,
    h: usize,
    start_x: usize,
    start_y: usize,
    arrow: char,
    text: &str,
    color: [u8; 4],
) {
    let mut cx = start_x;

    // 1. Draw custom mini arrow (5x5 pixels)
    if arrow == '▲' {
        // Mini up arrow
        let arrow_bits: [[u8; 5]; 5] = [
            [0, 0, 1, 0, 0],
            [0, 1, 1, 1, 0],
            [1, 1, 1, 1, 1],
            [0, 0, 1, 0, 0],
            [0, 0, 1, 0, 0],
        ];
        for (dy, row) in arrow_bits.iter().enumerate() {
            for (dx, &bit) in row.iter().enumerate() {
                if bit == 1 {
                    set_pixel(buf, w, h, cx + dx, start_y + 3 + dy, color);
                }
            }
        }
    } else {
        // Mini down arrow
        let arrow_bits: [[u8; 5]; 5] = [
            [0, 0, 1, 0, 0],
            [0, 0, 1, 0, 0],
            [1, 1, 1, 1, 1],
            [0, 1, 1, 1, 0],
            [0, 0, 1, 0, 0],
        ];
        for (dy, row) in arrow_bits.iter().enumerate() {
            for (dx, &bit) in row.iter().enumerate() {
                if bit == 1 {
                    set_pixel(buf, w, h, cx + dx, start_y + 3 + dy, color);
                }
            }
        }
    }
    cx += 6; // advance after arrow

    // 2. Draw text characters using 3x5 font scaled 1.5x / doubled (6x10) or crisp 4x8
    for ch in text.chars().take(4) {
        if ch == '.' {
            // Draw dot
            set_pixel(buf, w, h, cx, start_y + 7, color);
            set_pixel(buf, w, h, cx + 1, start_y + 7, color);
            set_pixel(buf, w, h, cx, start_y + 8, color);
            set_pixel(buf, w, h, cx + 1, start_y + 8, color);
            cx += 3;
            continue;
        }

        let glyph = get_glyph_3x5(ch.to_ascii_uppercase());
        // Render 3x5 glyph vertically aligned
        for (dy, &row_bits) in glyph.iter().enumerate() {
            for dx in 0..3 {
                if (row_bits & (1 << (2 - dx))) != 0 {
                    // Double height for sharp visibility (each dot is 1x2 or 1x1.5)
                    set_pixel(buf, w, h, cx + dx, start_y + 1 + dy * 2, color);
                    set_pixel(buf, w, h, cx + dx, start_y + 2 + dy * 2, color);
                }
            }
        }
        cx += 4; // 3 width + 1 spacing
    }
}

#[allow(dead_code)]
#[inline]
fn set_pixel(buf: &mut [u8], w: usize, h: usize, x: usize, y: usize, color: [u8; 4]) {
    if x < w && y < h {
        let idx = (y * w + x) * 4;
        buf[idx] = color[0];
        buf[idx + 1] = color[1];
        buf[idx + 2] = color[2];
        buf[idx + 3] = color[3];
    }
}
