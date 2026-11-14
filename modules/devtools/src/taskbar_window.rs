use parking_lot::RwLock;
use std::cell::RefCell;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use tauri::Manager;
use windows::core::{w, BSTR, PCWSTR};
use windows_core::implement;
use windows::Win32::Foundation::{COLORREF, HINSTANCE, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    BeginPaint, BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, CreateFontW, CreateSolidBrush,
    DeleteDC, DeleteObject, DrawTextW, EndPaint, FillRect, GetMonitorInfoW, InvalidateRect,
    MonitorFromWindow, SelectObject, SetBkMode, SetTextColor, BACKGROUND_MODE, DT_LEFT,
    DT_SINGLELINE, DT_VCENTER, FW_SEMIBOLD, HDC, MONITORINFO, MONITOR_DEFAULTTOPRIMARY,
    PAINTSTRUCT, SRCCOPY, TRANSPARENT,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
    COINIT_APARTMENTTHREADED, COINIT_MULTITHREADED,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Variant::VARIANT;
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationCondition, IUIAutomationElement,
    IUIAutomationPropertyChangedEventHandler, IUIAutomationPropertyChangedEventHandler_Impl,
    IUIAutomationStructureChangedEventHandler, IUIAutomationStructureChangedEventHandler_Impl,
    StructureChangeType, TreeScope_Element, TreeScope_Subtree, UIA_AutomationIdPropertyId,
    UIA_BoundingRectanglePropertyId, UIA_ClassNamePropertyId,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{ReleaseCapture, SetCapture};
use windows::Win32::UI::WindowsAndMessaging::{
    AppendMenuW, ChangeWindowMessageFilterEx, CreatePopupMenu, CreateWindowExW, DefWindowProcW,
    DestroyMenu, DestroyWindow, DispatchMessageW, FindWindowExW, FindWindowW, GetClassNameW,
    GetClientRect, GetCursorPos, GetDesktopWindow, GetForegroundWindow, GetMessageW,
    GetSystemMetrics, GetWindowRect, IsIconic, IsWindowVisible, KillTimer, PostMessageW,
    PostQuitMessage, RegisterClassExW, SetLayeredWindowAttributes, SetTimer, SetWindowPos,
    ShowWindow, SystemParametersInfoW, TrackPopupMenu, TranslateMessage, CS_DBLCLKS, CS_HREDRAW,
    CS_VREDRAW, HWND_TOPMOST, LWA_COLORKEY, MF_DISABLED, MF_GRAYED, MF_SEPARATOR, MF_STRING,
    MSGFLT_ALLOW, SM_CXSCREEN, SM_CYSCREEN, SPI_GETWORKAREA, SWP_NOACTIVATE, SWP_NOMOVE,
    SWP_NOSIZE, SWP_SHOWWINDOW, SW_HIDE, SW_SHOWNOACTIVATE, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
    TPM_BOTTOMALIGN, TPM_LEFTALIGN, TPM_RIGHTBUTTON, WM_COMMAND, WM_DESTROY, WM_DISPLAYCHANGE,
    WM_DPICHANGED, WM_LBUTTONDBLCLK, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE, WM_PAINT,
    WM_RBUTTONUP, WM_SETTINGCHANGE, WM_TIMER, WM_USER, WNDCLASSEXW, WS_EX_LAYERED,
    WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP, WS_VISIBLE,
};

pub const WM_TASKBAR_SPEED_UPDATE: u32 = WM_USER + 301;
const WM_TASKBAR_REDOCK: u32 = WM_USER + 302;
pub const WM_TASKBAR_SHOW_MAIN: u32 = WM_USER + 303;

const TIMER_FULLSCREEN: usize = 101;
const TIMER_REDOCK_DEBOUNCE: usize = 102;

// Color key for 100% true transparent window background
const TRANSPARENT_COLOR_KEY: COLORREF = COLORREF(0x00000000); // Pure Black RGB(0, 0, 0)

const MENU_SPEED_INFO: usize = 1001;
const MENU_RESET_POS: usize = 1002;
const MENU_TOGGLE_WIN: usize = 1003;
const MENU_QUIT_APP: usize = 1004;
const MENU_HIDE_BAR: usize = 1005;

static USER_DRAG_LOCKED: AtomicBool = AtomicBool::new(false);
static LAST_NOTIFY_LEFT: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(0);

thread_local! {
    static LOCAL_UIA: RefCell<Option<IUIAutomation>> = const { RefCell::new(None) };
}

#[derive(Clone, Copy, Default)]
struct SendHwnd(isize);
unsafe impl Send for SendHwnd {}
unsafe impl Sync for SendHwnd {}

impl SendHwnd {
    fn from_hwnd(hwnd: HWND) -> Self {
        Self(hwnd.0 as isize)
    }
    fn to_hwnd(self) -> HWND {
        HWND(self.0 as *mut _)
    }
}

#[derive(Clone, Copy)]
struct DragContext {
    cursor_x: i32,
    cursor_y: i32,
    win_x: i32,
    win_y: i32,
}

static DRAG_STATE: parking_lot::Mutex<Option<DragContext>> = parking_lot::Mutex::new(None);

#[derive(Clone)]
pub struct TaskbarState {
    pub upload_str: String,
    pub download_str: String,
}

pub struct TaskbarSpeedBar {
    hwnd: Arc<parking_lot::Mutex<Option<SendHwnd>>>,
    speed_state: Arc<RwLock<TaskbarState>>,
    is_alive: Arc<AtomicBool>,
}

// Global thread-safe references for WinProc dispatch
static GLOBAL_SPEED_STATE: OnceLock<Arc<RwLock<TaskbarState>>> = OnceLock::new();
static GLOBAL_TAURI_APP: OnceLock<tauri::AppHandle> = OnceLock::new();

impl TaskbarSpeedBar {
    pub fn start(app_handle: tauri::AppHandle) -> Arc<Self> {
        let speed_state = Arc::new(RwLock::new(TaskbarState {
            upload_str: "▲ 0 B/s".to_string(),
            download_str: "▼ 0 B/s".to_string(),
        }));
        let hwnd_holder = Arc::new(parking_lot::Mutex::new(None));
        let is_alive = Arc::new(AtomicBool::new(true));

        let _ = GLOBAL_SPEED_STATE.set(speed_state.clone());
        let _ = GLOBAL_TAURI_APP.set(app_handle);

        let hwnd_clone = hwnd_holder.clone();
        let is_alive_clone = is_alive.clone();

        std::thread::spawn(move || {
            run_win32_taskbar_window(hwnd_clone, is_alive_clone);
        });

        Arc::new(Self {
            hwnd: hwnd_holder,
            speed_state,
            is_alive,
        })
    }

    pub fn update_speed(&self, upload: &str, download: &str) {
        {
            let mut state = self.speed_state.write();
            state.upload_str = format!("▲ {}", upload);
            state.download_str = format!("▼ {}", download);
        }
        if let Some(send_hwnd) = *self.hwnd.lock() {
            unsafe {
                let _ = PostMessageW(
                    Some(send_hwnd.to_hwnd()),
                    WM_TASKBAR_SPEED_UPDATE,
                    WPARAM(0),
                    LPARAM(0),
                );
            }
        }
    }

    pub fn set_visible(&self, visible: bool) {
        if let Some(send_hwnd) = *self.hwnd.lock() {
            unsafe {
                if visible {
                    let _ = ShowWindow(send_hwnd.to_hwnd(), SW_SHOWNOACTIVATE);
                } else {
                    let _ = ShowWindow(send_hwnd.to_hwnd(), SW_HIDE);
                }
            }
        }
    }

    pub fn shutdown(&self) {
        self.is_alive.store(false, Ordering::SeqCst);
        if let Some(send_hwnd) = *self.hwnd.lock() {
            unsafe {
                let h = send_hwnd.to_hwnd();
                let _ = ShowWindow(h, SW_HIDE);
                let _ = PostMessageW(
                    Some(h),
                    windows::Win32::UI::WindowsAndMessaging::WM_CLOSE,
                    WPARAM(0),
                    LPARAM(0),
                );
            }
        }
    }
}

impl Drop for TaskbarSpeedBar {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Detects if an active foreground application is currently in fullscreen mode (e.g. video, game, slides)
unsafe fn is_fullscreen_app_active(my_hwnd: HWND) -> bool {
    unsafe {
        let fg_hwnd = GetForegroundWindow();
        if fg_hwnd.is_invalid() || fg_hwnd == my_hwnd {
            return false;
        }

        let desktop_hwnd = GetDesktopWindow();
        if fg_hwnd == desktop_hwnd {
            return false;
        }

        // Exclude taskbar itself
        let tray_hwnd = FindWindowW(w!("Shell_TrayWnd"), None).unwrap_or_default();
        if fg_hwnd == tray_hwnd {
            return false;
        }

        // Filter desktop shell background windows
        let mut class_buf = [0u16; 64];
        let class_len = GetClassNameW(fg_hwnd, &mut class_buf) as usize;
        if class_len > 0 {
            let class_str = String::from_utf16_lossy(&class_buf[..class_len]);
            if class_str == "WorkerW" || class_str == "Progman" || class_str == "Shell_TrayWnd" {
                return false;
            }
        }

        if !IsWindowVisible(fg_hwnd).as_bool() || IsIconic(fg_hwnd).as_bool() {
            return false;
        }

        let mut fg_rect = RECT::default();
        if GetWindowRect(fg_hwnd, &mut fg_rect).is_err() {
            return false;
        }

        let monitor = MonitorFromWindow(fg_hwnd, MONITOR_DEFAULTTOPRIMARY);
        if monitor.is_invalid() {
            return false;
        }

        let mut mi = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if GetMonitorInfoW(monitor, &mut mi).as_bool() {
            // Foreground window covers entire physical screen bounds (tolerating ±2px window borders)
            if fg_rect.left <= mi.rcMonitor.left + 2
                && fg_rect.top <= mi.rcMonitor.top + 2
                && fg_rect.right >= mi.rcMonitor.right - 2
                && fg_rect.bottom >= mi.rcMonitor.bottom - 2
            {
                return true;
            }
        }

        false
    }
}

fn variant_from_str(s: &str) -> VARIANT {
    VARIANT::from(BSTR::from(s))
}

unsafe fn ensure_local_uia() -> Option<IUIAutomation> {
    LOCAL_UIA.with(|cell| {
        if let Some(existing) = cell.borrow().as_ref() {
            return Some(existing.clone());
        }
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            if let Ok(uia) =
                CoCreateInstance::<_, IUIAutomation>(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
            {
                *cell.borrow_mut() = Some(uia.clone());
                return Some(uia);
            }
        }
        None
    })
}

unsafe fn build_tray_condition(uia: &IUIAutomation) -> windows::core::Result<IUIAutomationCondition> {
    unsafe {
        let class_names = [
            "SystemTray.SystemTrayFrame",
            "SystemTray.NormalButton",
            "SystemTray.OmniButton",
            "SystemTray.ChevronButton",
        ];
        let auto_ids = ["SystemTrayFrameGrid", "SystemTrayIcon", "OverflowButton"];

        let mut cond: Option<IUIAutomationCondition> = None;
        for name in class_names {
            let c = uia.CreatePropertyCondition(UIA_ClassNamePropertyId, &variant_from_str(name))?;
            cond = Some(match cond {
                Some(prev) => uia.CreateOrCondition(&prev, &c)?,
                None => c,
            });
        }
        for id in auto_ids {
            let c =
                uia.CreatePropertyCondition(UIA_AutomationIdPropertyId, &variant_from_str(id))?;
            cond = Some(match cond {
                Some(prev) => uia.CreateOrCondition(&prev, &c)?,
                None => c,
            });
        }
        Ok(cond.expect("at least one condition"))
    }
}

unsafe fn build_tray_frame_condition(
    uia: &IUIAutomation,
) -> windows::core::Result<IUIAutomationCondition> {
    unsafe {
        let c1 = uia.CreatePropertyCondition(
            UIA_ClassNamePropertyId,
            &variant_from_str("SystemTray.SystemTrayFrame"),
        )?;
        let c2 = uia.CreatePropertyCondition(
            UIA_AutomationIdPropertyId,
            &variant_from_str("SystemTrayFrameGrid"),
        )?;
        uia.CreateOrCondition(&c1, &c2)
    }
}

unsafe fn find_tray_left_via_uia(
    uia: &IUIAutomation,
    tray_hwnd: HWND,
    tray_rect: &RECT,
) -> Option<i32> {
    unsafe {
        let root: IUIAutomationElement = uia.ElementFromHandle(tray_hwnd).ok()?;
        let cond = build_tray_condition(uia).ok()?;
        let arr = root.FindAll(TreeScope_Subtree, &cond).ok()?;
        let len = arr.Length().ok()?;

        let tray_w = tray_rect.right - tray_rect.left;
        let tray_h = tray_rect.bottom - tray_rect.top;
        let tray_mid_x = tray_rect.left + tray_w / 2;

        let mut min_left: Option<i32> = None;
        for i in 0..len {
            let Ok(elem) = arr.GetElement(i) else {
                continue;
            };
            let Ok(r) = elem.CurrentBoundingRectangle() else {
                continue;
            };
            let ew = r.right - r.left;
            let eh = r.bottom - r.top;
            // Filter out invalid/hidden/zero-rect or full-bar parent frames
            if ew <= 4 || ew >= (tray_w / 2) || eh <= 4 || eh > tray_h + 12 {
                continue;
            }
            if r.left <= tray_mid_x
                || r.right > tray_rect.right + 12
                || r.top < tray_rect.top - 12
                || r.bottom > tray_rect.bottom + 12
            {
                continue;
            }
            min_left = Some(match min_left {
                Some(cur) => cur.min(r.left),
                None => r.left,
            });
        }
        min_left
    }
}

#[implement(IUIAutomationStructureChangedEventHandler)]
struct TrayStructureHandler {
    target_hwnd: SendHwnd,
}

impl IUIAutomationStructureChangedEventHandler_Impl for TrayStructureHandler_Impl {
    fn HandleStructureChangedEvent(
        &self,
        _sender: windows::core::Ref<'_, IUIAutomationElement>,
        _changetype: StructureChangeType,
        _runtimeid: *const windows::Win32::System::Com::SAFEARRAY,
    ) -> windows::core::Result<()> {
        unsafe {
            let _ = PostMessageW(
                Some(self.target_hwnd.to_hwnd()),
                WM_TASKBAR_REDOCK,
                WPARAM(0),
                LPARAM(0),
            );
        }
        Ok(())
    }
}

#[implement(IUIAutomationPropertyChangedEventHandler)]
struct TrayBoundsHandler {
    target_hwnd: SendHwnd,
}

impl IUIAutomationPropertyChangedEventHandler_Impl for TrayBoundsHandler_Impl {
    fn HandlePropertyChangedEvent(
        &self,
        _sender: windows::core::Ref<'_, IUIAutomationElement>,
        _propertyid: windows::Win32::UI::Accessibility::UIA_PROPERTY_ID,
        _newvalue: &VARIANT,
    ) -> windows::core::Result<()> {
        unsafe {
            let _ = PostMessageW(
                Some(self.target_hwnd.to_hwnd()),
                WM_TASKBAR_REDOCK,
                WPARAM(0),
                LPARAM(0),
            );
        }
        Ok(())
    }
}

fn spawn_uia_observer(target_hwnd: SendHwnd, is_alive: Arc<AtomicBool>) {
    std::thread::spawn(move || unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let Ok(uia) =
            CoCreateInstance::<_, IUIAutomation>(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
        else {
            CoUninitialize();
            return;
        };

        let struct_handler: IUIAutomationStructureChangedEventHandler = TrayStructureHandler {
            target_hwnd,
        }
        .into();
        let prop_handler: IUIAutomationPropertyChangedEventHandler = TrayBoundsHandler {
            target_hwnd,
        }
        .into();

        let mut last_tray_isize: isize = 0;

        while is_alive.load(Ordering::Relaxed) {
            let tray_hwnd = FindWindowW(w!("Shell_TrayWnd"), None).unwrap_or_default();
            let cur_isize = if tray_hwnd.is_invalid() {
                0
            } else {
                tray_hwnd.0 as isize
            };

            if cur_isize != 0 && cur_isize != last_tray_isize {
                let _ = uia.RemoveAllEventHandlers();
                if let Ok(root) = uia.ElementFromHandle(tray_hwnd) {
                    // Prefer scoping to Win11 SystemTray container to avoid noisy app-button events
                    let tray_container = build_tray_frame_condition(&uia)
                        .ok()
                        .and_then(|cond| root.FindFirst(TreeScope_Subtree, &cond).ok());

                    if let Some(container) = tray_container {
                        let _ = uia.AddStructureChangedEventHandler(
                            &container,
                            TreeScope_Subtree,
                            None,
                            &struct_handler,
                        );
                        let _ = uia.AddPropertyChangedEventHandlerNativeArray(
                            &container,
                            TreeScope_Element,
                            None,
                            &prop_handler,
                            &[UIA_BoundingRectanglePropertyId],
                        );
                    } else {
                        let _ = uia.AddStructureChangedEventHandler(
                            &root,
                            TreeScope_Subtree,
                            None,
                            &struct_handler,
                        );
                    }
                    last_tray_isize = cur_isize;
                    let _ = PostMessageW(
                        Some(target_hwnd.to_hwnd()),
                        WM_TASKBAR_REDOCK,
                        WPARAM(0),
                        LPARAM(0),
                    );
                }
            } else if cur_isize == 0 && last_tray_isize != 0 {
                let _ = uia.RemoveAllEventHandlers();
                last_tray_isize = 0;
            }

            // Sleep 1.5s checking only Shell_TrayWnd HWND identity (microsecond-level Win32 check, zero UIA polling)
            for _ in 0..6 {
                if !is_alive.load(Ordering::Relaxed) {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(250));
            }
        }

        let _ = uia.RemoveAllEventHandlers();
        CoUninitialize();
    });
}

/// Calculate the optimal docking position and size directly in Windows Taskbar
/// Combines Win32 TrayNotifyWnd and Win11 XAML UIA tray bounds to avoid overlapping chevron (`^`) or new tray icons.
/// Returns (x, y, width, height)
fn calculate_dock_position() -> (i32, i32, i32, i32) {
    unsafe {
        // 1. Try FindWindow Shell_TrayWnd & TrayNotifyWnd + UIA XAML tray bounds
        let tray_hwnd = FindWindowW(w!("Shell_TrayWnd"), None).unwrap_or_default();
        if !tray_hwnd.is_invalid() {
            let mut tray_rect = RECT::default();
            let _ = GetWindowRect(tray_hwnd, &mut tray_rect);

            let tray_w = tray_rect.right - tray_rect.left;
            let tray_h = (tray_rect.bottom - tray_rect.top).max(36);
            let bar_h = (tray_h - 4).clamp(36, 56);
            // Enlarged width for crisp two-line typography
            let bar_w = ((bar_h as f32) * 3.5).clamp(132.0, 190.0) as i32;
            let tray_mid_x = tray_rect.left + tray_w / 2;

            let mut anchor_left: Option<i32> = None;

            let notify_hwnd = FindWindowExW(Some(tray_hwnd), None, w!("TrayNotifyWnd"), None)
                .unwrap_or_default();
            if !notify_hwnd.is_invalid() {
                let mut notify_rect = RECT::default();
                let _ = GetWindowRect(notify_hwnd, &mut notify_rect);
                LAST_NOTIFY_LEFT.store(notify_rect.left, Ordering::Relaxed);

                if notify_rect.left > tray_mid_x && notify_rect.left < tray_rect.right - 20 {
                    anchor_left = Some(notify_rect.left);
                }
            }

            if let Some(uia) = ensure_local_uia() {
                if let Some(uia_left) = find_tray_left_via_uia(&uia, tray_hwnd, &tray_rect) {
                    anchor_left = Some(match anchor_left {
                        Some(cur) => cur.min(uia_left),
                        None => uia_left,
                    });
                }
            }

            if let Some(left) = anchor_left {
                let min_safe_x = tray_rect.left + 120;
                let target_x = (left - bar_w - 6).max(min_safe_x);
                let target_y = tray_rect.top + (tray_h - bar_h) / 2;
                return (target_x, target_y, bar_w, bar_h);
            }

            if tray_rect.right > 200 {
                let target_x = tray_rect.right - bar_w - (bar_w * 2);
                let target_y = tray_rect.top + (tray_h - bar_h) / 2;
                return (target_x, target_y, bar_w, bar_h);
            }
        }

        // 2. Fallback to SPI_GETWORKAREA
        let mut work_area = RECT::default();
        let spi_res = SystemParametersInfoW(
            SPI_GETWORKAREA,
            0,
            Some(&mut work_area as *mut _ as *mut _),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        );
        if spi_res.is_ok() && work_area.right > 0 {
            let _screen_w = GetSystemMetrics(SM_CXSCREEN);
            let screen_h = GetSystemMetrics(SM_CYSCREEN);
            let taskbar_h = (screen_h - work_area.bottom).max(36);
            let bar_h = (taskbar_h - 4).clamp(36, 56);
            let bar_w = ((bar_h as f32) * 3.5).clamp(132.0, 190.0) as i32;

            let target_x = work_area.right - bar_w - 240;
            let target_y = work_area.bottom + (taskbar_h - bar_h) / 2;
            return (target_x, target_y, bar_w, bar_h);
        }

        // 3. Fallback standard
        (1560, 1038, 136, 38)
    }
}

unsafe fn apply_redock_if_needed(hwnd: HWND, force: bool) {
    if !force && USER_DRAG_LOCKED.load(Ordering::Relaxed) {
        return;
    }
    if DRAG_STATE.lock().is_some() {
        return;
    }

    let (target_x, target_y, target_w, target_h) = calculate_dock_position();
    unsafe {
        let mut cur_rect = RECT::default();
        let moved = if GetWindowRect(hwnd, &mut cur_rect).is_ok() {
            let cur_w = cur_rect.right - cur_rect.left;
            let cur_h = cur_rect.bottom - cur_rect.top;
            (cur_rect.left - target_x).abs() > 2
                || (cur_rect.top - target_y).abs() > 2
                || (cur_w - target_w).abs() > 2
                || (cur_h - target_h).abs() > 2
        } else {
            true
        };

        if moved || force {
            let _ = SetWindowPos(
                hwnd,
                Some(HWND_TOPMOST),
                target_x,
                target_y,
                target_w,
                target_h,
                SWP_NOACTIVATE,
            );
        }
    }
}

fn run_win32_taskbar_window(
    hwnd_out: Arc<parking_lot::Mutex<Option<SendHwnd>>>,
    is_alive: Arc<AtomicBool>,
) {
    unsafe {
        let class_name = w!("A8DevToolsTaskbarSpeedBar");
        let hinstance: HINSTANCE = GetModuleHandleW(None).unwrap_or_default().into();

        let wnd_class = WNDCLASSEXW {
            cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
            style: CS_HREDRAW | CS_VREDRAW | CS_DBLCLKS,
            lpfnWndProc: Some(taskbar_wnd_proc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: hinstance,
            hIcon: windows::Win32::UI::WindowsAndMessaging::HICON::default(),
            hCursor: windows::Win32::UI::WindowsAndMessaging::LoadCursorW(
                None,
                windows::Win32::UI::WindowsAndMessaging::IDC_ARROW,
            )
            .unwrap_or_default(),
            hbrBackground: windows::Win32::Graphics::Gdi::HBRUSH::default(),
            lpszMenuName: PCWSTR::null(),
            lpszClassName: class_name,
            hIconSm: windows::Win32::UI::WindowsAndMessaging::HICON::default(),
        };

        let _ = RegisterClassExW(&wnd_class);

        let (init_x, init_y, init_w, init_h) = calculate_dock_position();

        // WS_EX_LAYERED: enable per-pixel color-key transparency
        // WS_EX_TOOLWINDOW: don't show in Alt-Tab or taskbar icon list
        // WS_EX_TOPMOST: stay on top of taskbar
        // WS_EX_NOACTIVATE: don't steal focus when clicked or dragged
        let ex_style = WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE;
        let style = WS_POPUP | WS_VISIBLE;

        // Make window owned by Shell_TrayWnd so it can NEVER sink below the taskbar
        let tray_hwnd = FindWindowW(w!("Shell_TrayWnd"), None).unwrap_or_default();
        let owner_hwnd = if !tray_hwnd.is_invalid() {
            Some(tray_hwnd)
        } else {
            None
        };

        let hwnd = match CreateWindowExW(
            ex_style,
            class_name,
            w!("a8-devtools-taskbar-speed"),
            style,
            init_x,
            init_y,
            init_w,
            init_h,
            owner_hwnd,
            None,
            Some(hinstance),
            None,
        ) {
            Ok(h) => h,
            Err(_) => return,
        };

        // Enable 100% transparent background
        let _ = SetLayeredWindowAttributes(hwnd, TRANSPARENT_COLOR_KEY, 0, LWA_COLORKEY);
        // Allow lower-privilege duplicate launches to wake an elevated running instance
        let _ = ChangeWindowMessageFilterEx(hwnd, WM_TASKBAR_SHOW_MAIN, MSGFLT_ALLOW, None);

        *hwnd_out.lock() = Some(SendHwnd::from_hwnd(hwnd));

        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        let _ = SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            init_x,
            init_y,
            init_w,
            init_h,
            SWP_NOACTIVATE | SWP_SHOWWINDOW,
        );

        // Timer for lightweight 1-second fullscreen detection + microsecond Win32 tray edge check
        let _ = SetTimer(Some(hwnd), TIMER_FULLSCREEN, 1000, None);
        spawn_uia_observer(SendHwnd::from_hwnd(hwnd), is_alive.clone());

        let mut msg = windows::Win32::UI::WindowsAndMessaging::MSG::default();
        while is_alive.load(Ordering::Relaxed) && GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }

        let _ = DestroyWindow(hwnd);
        LOCAL_UIA.with(|cell| {
            *cell.borrow_mut() = None;
        });
        CoUninitialize();
    }
}

unsafe extern "system" fn taskbar_wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        WM_TIMER => {
            unsafe {
                if wparam.0 == TIMER_REDOCK_DEBOUNCE {
                    let _ = KillTimer(Some(hwnd), TIMER_REDOCK_DEBOUNCE);
                    apply_redock_if_needed(hwnd, false);
                    return LRESULT(0);
                }

                let is_fullscreen = is_fullscreen_app_active(hwnd);
                let is_visible = IsWindowVisible(hwnd).as_bool();
                if is_fullscreen {
                    if is_visible {
                        let _ = ShowWindow(hwnd, SW_HIDE);
                    }
                } else {
                    if !is_visible {
                        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
                    }
                    // Fast microsecond-level Win32 check for TrayNotifyWnd width changes (no UIA call)
                    if !USER_DRAG_LOCKED.load(Ordering::Relaxed) {
                        let tray_hwnd = FindWindowW(w!("Shell_TrayWnd"), None).unwrap_or_default();
                        if !tray_hwnd.is_invalid() {
                            let notify_hwnd =
                                FindWindowExW(Some(tray_hwnd), None, w!("TrayNotifyWnd"), None)
                                    .unwrap_or_default();
                            if !notify_hwnd.is_invalid() {
                                let mut notify_rect = RECT::default();
                                if GetWindowRect(notify_hwnd, &mut notify_rect).is_ok()
                                    && notify_rect.left != LAST_NOTIFY_LEFT.load(Ordering::Relaxed)
                                {
                                    apply_redock_if_needed(hwnd, false);
                                }
                            }
                        }
                    }
                }
            }
            LRESULT(0)
        }
        WM_TASKBAR_REDOCK | WM_DISPLAYCHANGE | WM_SETTINGCHANGE | WM_DPICHANGED => {
            unsafe {
                if !USER_DRAG_LOCKED.load(Ordering::Relaxed) && DRAG_STATE.lock().is_none() {
                    let _ = SetTimer(Some(hwnd), TIMER_REDOCK_DEBOUNCE, 180, None);
                }
            }
            LRESULT(0)
        }
        WM_TASKBAR_SPEED_UPDATE => {
            unsafe {
                let is_fullscreen = is_fullscreen_app_active(hwnd);
                let is_visible = IsWindowVisible(hwnd).as_bool();

                if is_fullscreen {
                    // Fullscreen video/game detected: auto-hide to avoid blocking content
                    if is_visible {
                        let _ = ShowWindow(hwnd, SW_HIDE);
                    }
                } else {
                    // Exit fullscreen: auto-restore
                    if !is_visible {
                        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
                    }
                    let _ = InvalidateRect(Some(hwnd), None, false);
                    let _ = SetWindowPos(
                        hwnd,
                        Some(HWND_TOPMOST),
                        0,
                        0,
                        0,
                        0,
                        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                    );
                }
            }
            LRESULT(0)
        }
        WM_PAINT => {
            unsafe {
                let mut ps = PAINTSTRUCT::default();
                let hdc = BeginPaint(hwnd, &mut ps);

                paint_speed_bar(hwnd, hdc);

                let _ = EndPaint(hwnd, &ps);
            }
            LRESULT(0)
        }
        WM_LBUTTONDOWN => {
            unsafe {
                // Record mouse down coordinates for smooth dragging
                let mut pt = POINT::default();
                let _ = GetCursorPos(&mut pt);
                let mut win_rect = RECT::default();
                let _ = GetWindowRect(hwnd, &mut win_rect);

                *DRAG_STATE.lock() = Some(DragContext {
                    cursor_x: pt.x,
                    cursor_y: pt.y,
                    win_x: win_rect.left,
                    win_y: win_rect.top,
                });
                let _ = SetCapture(hwnd);

                // Keep topmost immediately on click
                let _ = SetWindowPos(
                    hwnd,
                    Some(HWND_TOPMOST),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                );
            }
            LRESULT(0)
        }
        WM_MOUSEMOVE => {
            unsafe {
                if let Some(ctx) = *DRAG_STATE.lock() {
                    let mut pt = POINT::default();
                    let _ = GetCursorPos(&mut pt);
                    let dx = pt.x - ctx.cursor_x;
                    let dy = pt.y - ctx.cursor_y;

                    // Apply displacement if moved
                    if dx.abs() > 1 || dy.abs() > 1 {
                        let _ = SetWindowPos(
                            hwnd,
                            Some(HWND_TOPMOST),
                            ctx.win_x + dx,
                            ctx.win_y + dy,
                            0,
                            0,
                            SWP_NOSIZE | SWP_NOACTIVATE,
                        );
                    }
                }
            }
            LRESULT(0)
        }
        WM_LBUTTONUP => {
            unsafe {
                let _ = ReleaseCapture();
                let prev = *DRAG_STATE.lock();
                *DRAG_STATE.lock() = None;

                if let Some(ctx) = prev {
                    let mut pt = POINT::default();
                    if GetCursorPos(&mut pt).is_ok()
                        && ((pt.x - ctx.cursor_x).abs() > 2 || (pt.y - ctx.cursor_y).abs() > 2)
                    {
                        USER_DRAG_LOCKED.store(true, Ordering::Relaxed);
                    }
                }

                // Ensure topmost state after releasing mouse
                let _ = SetWindowPos(
                    hwnd,
                    Some(HWND_TOPMOST),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                );
            }
            LRESULT(0)
        }
        WM_LBUTTONDBLCLK | WM_TASKBAR_SHOW_MAIN => {
            // Double click or secondary instance launch: open/restore main window
            if let Some(app) = GLOBAL_TAURI_APP.get() {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
            LRESULT(0)
        }
        WM_RBUTTONUP => {
            unsafe {
                show_taskbar_context_menu(hwnd);
            }
            LRESULT(0)
        }
        WM_COMMAND => {
            let cmd_id = wparam.0 as usize;
            match cmd_id {
                MENU_RESET_POS => unsafe {
                    USER_DRAG_LOCKED.store(false, Ordering::Relaxed);
                    apply_redock_if_needed(hwnd, true);
                },
                MENU_TOGGLE_WIN => {
                    if let Some(app) = GLOBAL_TAURI_APP.get() {
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                    }
                }
                MENU_QUIT_APP => {
                    unsafe {
                        let _ = ShowWindow(hwnd, SW_HIDE);
                        let _ = DestroyWindow(hwnd);
                    }
                    if let Some(app) = GLOBAL_TAURI_APP.get() {
                        app.exit(0);
                    }
                }
                MENU_HIDE_BAR => unsafe {
                    let _ = ShowWindow(hwnd, SW_HIDE);
                    let mut s = crate::settings::load_settings();
                    s.taskbar_speed_enabled = false;
                    let _ = crate::settings::save_settings(s);
                }
                _ => {}
            }
            LRESULT(0)
        }
        WM_DESTROY => {
            unsafe {
                let _ = KillTimer(Some(hwnd), TIMER_FULLSCREEN);
                let _ = KillTimer(Some(hwnd), TIMER_REDOCK_DEBOUNCE);
                PostQuitMessage(0);
            }
            LRESULT(0)
        }
        _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
    }
}

unsafe fn paint_speed_bar(hwnd: HWND, hdc: HDC) {
    let mut rect = RECT::default();
    let _ = unsafe { GetClientRect(hwnd, &mut rect) };
    let w = rect.right - rect.left;
    let h = rect.bottom - rect.top;

    // Double buffering for 100% flicker-free rendering
    let mem_dc = match unsafe { CreateCompatibleDC(Some(hdc)) } {
        dc if !dc.is_invalid() => dc,
        _ => return,
    };
    let mem_bmp = match unsafe { CreateCompatibleBitmap(hdc, w, h) } {
        bmp if !bmp.is_invalid() => bmp,
        _ => {
            let _ = unsafe { DeleteDC(mem_dc) };
            return;
        }
    };
    let old_bmp = unsafe { SelectObject(mem_dc, mem_bmp.into()) };

    // 1. Fill background with TRANSPARENT_COLOR_KEY (Pure Black) -> Becomes 100% transparent via DWM
    let bg_brush = unsafe { CreateSolidBrush(TRANSPARENT_COLOR_KEY) };
    unsafe {
        FillRect(mem_dc, &rect, bg_brush);
    }

    // 2. Setup text rendering with larger and bolder font
    let _ = unsafe { SetBkMode(mem_dc, BACKGROUND_MODE(TRANSPARENT.0)) };

    // Larger font height: 16px (FW_SEMIBOLD 600 weight)
    let font_size = ((h / 2) - 1).clamp(15, 24);
    let font_name = w!("Microsoft YaHei UI");
    let hfont = unsafe {
        CreateFontW(
            font_size,
            0,
            0,
            0,
            FW_SEMIBOLD.0 as i32,
            0,
            0,
            0,
            windows::Win32::Graphics::Gdi::DEFAULT_CHARSET,
            windows::Win32::Graphics::Gdi::OUT_DEFAULT_PRECIS,
            windows::Win32::Graphics::Gdi::CLIP_DEFAULT_PRECIS,
            windows::Win32::Graphics::Gdi::CLEARTYPE_QUALITY,
            windows::Win32::Graphics::Gdi::DEFAULT_PITCH.0 as u32,
            font_name,
        )
    };
    let old_font = unsafe { SelectObject(mem_dc, hfont.into()) };

    let (up_text, down_text) = if let Some(state_arc) = GLOBAL_SPEED_STATE.get() {
        let guard = state_arc.read();
        (guard.upload_str.clone(), guard.download_str.clone())
    } else {
        ("▲ 0 B/s".to_string(), "▼ 0 B/s".to_string())
    };

    let mid_y = h / 2;

    // Row 1: Upload (Vibrant Amber Gold: RGB 255, 191, 0 -> BGR: 0x0000BFFF)
    let _ = unsafe { SetTextColor(mem_dc, COLORREF(0x0000BFFF)) };
    let mut up_rect = RECT {
        left: 2,
        top: 0,
        right: w,
        bottom: mid_y,
    };
    let mut up_wide: Vec<u16> = up_text.encode_utf16().chain(std::iter::once(0)).collect();
    let up_len = up_wide.len().saturating_sub(1);
    let _ = unsafe {
        DrawTextW(
            mem_dc,
            &mut up_wide[..up_len],
            &mut up_rect,
            DT_LEFT | DT_VCENTER | DT_SINGLELINE,
        )
    };

    // Row 2: Download (Sky Blue: RGB 56, 189, 248 -> BGR: 0x00F8BD38)
    let _ = unsafe { SetTextColor(mem_dc, COLORREF(0x00F8BD38)) };
    let mut down_rect = RECT {
        left: 2,
        top: mid_y,
        right: w,
        bottom: h,
    };
    let mut down_wide: Vec<u16> = down_text.encode_utf16().chain(std::iter::once(0)).collect();
    let down_len = down_wide.len().saturating_sub(1);
    let _ = unsafe {
        DrawTextW(
            mem_dc,
            &mut down_wide[..down_len],
            &mut down_rect,
            DT_LEFT | DT_VCENTER | DT_SINGLELINE,
        )
    };

    // BitBlt to display DC
    let _ = unsafe { BitBlt(hdc, 0, 0, w, h, Some(mem_dc), 0, 0, SRCCOPY) };

    // Cleanup GDI objects
    unsafe {
        SelectObject(mem_dc, old_font);
        SelectObject(mem_dc, old_bmp);

        let _ = DeleteObject(hfont.into());
        let _ = DeleteObject(bg_brush.into());
        let _ = DeleteObject(mem_bmp.into());
        let _ = DeleteDC(mem_dc);
    }
}

unsafe fn show_taskbar_context_menu(hwnd: HWND) {
    let mut pt = POINT::default();
    let _ = unsafe { GetCursorPos(&mut pt) };

    if let Ok(menu) = unsafe { CreatePopupMenu() } {
        let (up_text, down_text) = if let Some(state_arc) = GLOBAL_SPEED_STATE.get() {
            let guard = state_arc.read();
            (guard.upload_str.clone(), guard.download_str.clone())
        } else {
            ("▲ 0 B/s".to_string(), "▼ 0 B/s".to_string())
        };
        let summary = format!("实时网速: {}  {}", up_text, down_text);
        let summary_wide: Vec<u16> = summary.encode_utf16().chain(std::iter::once(0)).collect();

        unsafe {
            let _ = AppendMenuW(
                menu,
                MF_STRING | MF_DISABLED | MF_GRAYED,
                MENU_SPEED_INFO,
                PCWSTR(summary_wide.as_ptr()),
            );
            let _ = AppendMenuW(menu, MF_SEPARATOR, 0, PCWSTR::null());
            let _ = AppendMenuW(
                menu,
                MF_STRING,
                MENU_RESET_POS,
                w!("复位到任务栏通知区左侧"),
            );
            let _ = AppendMenuW(
                menu,
                MF_STRING,
                MENU_TOGGLE_WIN,
                w!("显示 / 隐藏 a8-devtools 工作台"),
            );
            let _ = AppendMenuW(
                menu,
                MF_STRING,
                MENU_HIDE_BAR,
                w!("关闭任务栏网速条 (可在设置中重新开启)"),
            );
            let _ = AppendMenuW(menu, MF_SEPARATOR, 0, PCWSTR::null());
            let _ = AppendMenuW(menu, MF_STRING, MENU_QUIT_APP, w!("退出 a8-devtools"));

            let _ = TrackPopupMenu(
                menu,
                TPM_RIGHTBUTTON | TPM_BOTTOMALIGN | TPM_LEFTALIGN,
                pt.x,
                pt.y,
                Some(0),
                hwnd,
                None,
            );

            let _ = DestroyMenu(menu);
        }
    }
}
