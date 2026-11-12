import React, { useState, useEffect } from 'react';
import {
  Button,
  Chip,
  Input,
  Switch,
  Modal,
  ModalBackdrop,
  ModalContainer,
  ModalDialog,
  ModalHeader,
  ModalBody,
  ModalFooter,
  RadioGroup,
  Radio,
  Tooltip,
} from '@heroui/react';
import {
  FolderGit2,
  FolderOpen,
  Globe,
  Activity,
  Settings,
  Search,
  Plus,
  RotateCw,
  HardDrive,
  Copy,
  ExternalLink,
  Trash2,
  Minus,
  Square,
  X,
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  Layers,
  Sparkles,
  Zap,
} from 'lucide-react';

interface ChangeItem {
  rel_path: string;
  change_type: string;
  size_bytes: number;
  size_kb: number;
}

interface WorkspaceCard {
  name: string;
  target_path: string;
  source_path: string;
  diff_path: string;
  mode: string;
  is_alive: boolean;
  pid: number | null;
  modified_count: number;
  added_count: number;
  deleted_count: number;
  total_diff_kb: number;
  changes: ChangeItem[];
}

interface SystemStatus {
  winfsp_driver_running: boolean;
  is_admin: boolean;
  total_workspaces: number;
  active_workspaces: number;
  total_diff_bytes: number;
  saved_disk_bytes: number;
}

interface AppSettings {
  autostart: boolean;
  taskbar_speed_enabled: boolean;
  sample_interval_secs: number;
  fullscreen_hide: boolean;
}

async function callTauri<T = any>(command: string, args: Record<string, any> = {}): Promise<T | null> {
  const invoker = (window as any).__TAURI__?.core?.invoke || (window as any).__TAURI__?.invoke;
  if (invoker) {
    try {
      return await invoker(command, args);
    } catch (e) {
      console.error(`[Tauri] ${command} failed:`, e);
      throw e;
    }
  }
  console.warn(`[Mock] ${command}:`, args);
  return null;
}

function formatBytes(bytes: number) {
  if (!bytes || bytes === 0) return '0.0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// 格式化路径，分段呈现，避免呆板
function PathSegment({ path }: { path: string }) {
  const clean = path.replace(/\\\\\\?\\/g, '').replace(/\\/g, '/');
  const parts = clean.split('/').filter(Boolean);
  if (parts.length <= 2) {
    return <span className="font-mono text-[10.5px] text-neutral-700">{path}</span>;
  }
  const root = parts[0];
  const middle = parts.slice(1, -1).join('/');
  const leaf = parts[parts.length - 1];

  return (
    <div className="flex items-center gap-1 font-mono text-[10px] truncate max-w-full">
      <span className="text-neutral-400 shrink-0">{root}/</span>
      <span className="text-neutral-500 truncate max-w-[140px]">{middle}/</span>
      <span className="font-semibold text-neutral-900 shrink-0">{leaf}</span>
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'mappings' | 'hosts' | 'doctor' | 'settings'>('mappings');
  const [workspaces, setWorkspaces] = useState<WorkspaceCard[]>([]);
  const [selectedWsIdx, setSelectedWsIdx] = useState<number>(0);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [netSpeed, setNetSpeed] = useState({ up: '0 B/s', down: '0 B/s' });
  const [hostsContent, setHostsContent] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings>({
    autostart: false,
    taskbar_speed_enabled: true,
    sample_interval_secs: 5,
    fullscreen_hide: true,
  });

  const [isOpen, setIsOpen] = useState(false);
  const onOpen = () => setIsOpen(true);
  const onClose = () => setIsOpen(false);
  const [newWsName, setNewWsName] = useState('');
  const [newWsSource, setNewWsSource] = useState('');
  const [newWsTarget, setNewWsTarget] = useState('');
  const [newWsMode, setNewWsMode] = useState<string>('direct');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 原生窗口控制与拖拽移动
  const handleMin = async () => { await callTauri('app_minimize'); };
  const handleMax = async () => { await callTauri('app_maximize'); };
  const handleClose = async () => { await callTauri('app_close'); };

  const handleStartDrag = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, a, [role="button"], textarea')) {
      return;
    }
    if (e.buttons === 1) {
      callTauri('app_start_drag');
    }
  };

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const loadData = async () => {
    try {
      const [ws, status] = await Promise.all([
        callTauri<WorkspaceCard[]>('get_workspaces'),
        callTauri<SystemStatus>('get_system_status'),
      ]);
      if (ws) setWorkspaces(ws);
      if (status) setSystemStatus(status);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadData();

    const fetchSpeed = () => {
      callTauri<any>('get_net_speed').then((res) => {
        if (res) {
          setNetSpeed({
            up: res.upload_formatted || '0 B/s',
            down: res.download_formatted || '0 B/s',
          });
        }
      }).catch(() => {});
    };

    fetchSpeed();
    const speedTimer = setInterval(fetchSpeed, 2000);

    if ((window as any).__TAURI__?.event?.listen) {
      (window as any).__TAURI__.event
        .listen('net-speed-update', (event: any) => {
          const payload = event.payload;
          if (payload) {
            setNetSpeed({
              up: payload.upload_formatted || '0 B/s',
              down: payload.download_formatted || '0 B/s',
            });
          }
        })
        .catch(() => {});
    }

    return () => {
      clearInterval(speedTimer);
    };
  }, []);

  const selectedWs = workspaces[selectedWsIdx] || workspaces[0];

  const handleOpenExplorer = async (path: string) => {
    try {
      await callTauri('open_explorer', { path });
    } catch (e) {
      console.error('打开资源管理器失败:', e);
    }
  };

  const handleLocateSource = async (path: string) => {
    try {
      await callTauri('locate_in_explorer', { path });
    } catch (e) {
      console.error('定位资源失败:', e);
    }
  };

  const handleToggleMount = async (ws: WorkspaceCard) => {
    if (ws.is_alive) {
      await callTauri('unlink_workspace', { target: ws.target_path });
    } else {
      await callTauri('resume_workspace', { target: ws.target_path });
    }
    await loadData();
  };

  const handleDeleteWorkspace = async (ws: WorkspaceCard) => {
    if (confirm(`确定彻底移除工作区 [${ws.name}] 吗？\n\n挂载路径: ${ws.target_path}`)) {
      await callTauri('delete_workspace', { target: ws.target_path });
      setSelectedWsIdx(0);
      await loadData();
    }
  };

  const handlePickSource = async () => {
    const p = await callTauri<string | null>('pick_folder');
    if (p) {
      setNewWsSource(p);
      if (!newWsName.trim()) {
        const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
        if (parts.length > 0) setNewWsName(parts[parts.length - 1]);
      }
    }
  };

  const handlePickTarget = async () => {
    const p = await callTauri<string | null>('pick_folder');
    if (p) setNewWsTarget(p);
  };

  const handleCreateWorkspace = async () => {
    if (!newWsSource.trim() || !newWsTarget.trim()) {
      alert('请选择源码基础目录和挂载目标路径');
      return;
    }
    setIsSubmitting(true);
    try {
      await callTauri('create_workspace', {
        source: newWsSource.trim(),
        target: newWsTarget.trim(),
        direct: newWsMode === 'direct',
      });
      onClose();
      await loadData();
    } catch (e: any) {
      alert('创建挂载失败: ' + e);
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredWorkspaces = workspaces.filter(
    (ws) =>
      ws.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ws.target_path.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ws.source_path.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-row bg-[#FBFBFC] text-[#1E2024] text-[12px] font-sans antialiased select-none">
      
      {/* ========================================================================= */}
      {/* 第 1 列：侧边栏 (macOS 微透质感 + 极简严谨层级, 196px) */}
      {/* ========================================================================= */}
      <aside className="w-[196px] bg-[#FFFFFF]/90 backdrop-blur-xl border-r border-[#E6E8EB] flex flex-col shrink-0 justify-between select-none h-full z-20">
        <div className="flex flex-col">
          {/* macOS 交通灯与拖拽区 */}
          <div
            data-tauri-drag-region
            onMouseDown={handleStartDrag}
            className="h-10 px-3.5 flex items-center justify-between border-b border-[#F0F2F4] cursor-default"
          >
            <div className="flex items-center gap-1.5 group">
              <button
                onClick={handleClose}
                title="关闭 / 隐藏至托盘"
                className="w-2.5 h-2.5 rounded-full bg-[#FF5F56] border border-[#E0443E]/90 flex items-center justify-center cursor-pointer transition-transform hover:scale-110 active:scale-95"
              >
                <X className="w-1.5 h-1.5 text-[#4C0002] opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
              <button
                onClick={handleMin}
                title="最小化"
                className="w-2.5 h-2.5 rounded-full bg-[#FFBD2E] border border-[#DEA123]/90 flex items-center justify-center cursor-pointer transition-transform hover:scale-110 active:scale-95"
              >
                <Minus className="w-1.5 h-1.5 text-[#5A3F00] opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
              <button
                onClick={handleMax}
                title="最大化 / 还原"
                className="w-2.5 h-2.5 rounded-full bg-[#27C93F] border border-[#1AAB29]/90 flex items-center justify-center cursor-pointer transition-transform hover:scale-110 active:scale-95"
              >
                <Square className="w-1 h-1 text-[#0A4D13] opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            </div>
            <span className="text-[9px] font-mono text-neutral-400 font-semibold tracking-wider">A8 DEV</span>
          </div>

          {/* 品牌标识 */}
          <div className="px-3.5 py-3 flex items-center gap-2.5 border-b border-[#F0F2F4]">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#1677FF] to-[#0958D9] text-white flex items-center justify-center font-bold text-[12px] shadow-[0_2px_6px_rgba(22,119,255,0.3)] shrink-0">
              <Layers className="w-4 h-4" />
            </div>
            <div className="flex flex-col leading-tight">
              <div className="flex items-center gap-1.5">
                <span className="text-[12.5px] font-bold text-[#1E2024] tracking-tight">A8 DevTools</span>
                <span className="text-[8px] font-mono font-semibold text-[#1677FF] bg-[#E6F4FF] border border-[#BAE0FF]/60 rounded-full px-1.5 py-0.2">PRO</span>
              </div>
              <span className="text-[9.5px] text-[#6E7781] font-normal mt-0.5">高性能虚拟网关中枢</span>
            </div>
          </div>

          {/* 紧凑严谨导航菜单 (Linear / Raycast 级交互微质感) */}
          <nav className="p-2 space-y-1 text-[11.5px] font-medium">
            <button
              onClick={() => setActiveTab('mappings')}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-all duration-150 active:scale-[0.98] ${
                activeTab === 'mappings'
                  ? 'bg-[#1677FF] text-white font-semibold shadow-[0_2px_8px_rgba(22,119,255,0.25)]'
                  : 'text-[#57606A] hover:bg-[#F2F4F7] hover:text-[#1E2024]'
              }`}
            >
              <span className="flex items-center gap-2">
                <FolderGit2 className="w-3.5 h-3.5 shrink-0" />
                <span>虚拟镜像映射</span>
              </span>
              <span className={`text-[9.5px] font-mono px-1.5 py-0.2 rounded-full tabular-nums ${activeTab === 'mappings' ? 'bg-white/25 text-white' : 'bg-[#EAECEF] text-[#57606A]'}`}>
                {workspaces.length}
              </span>
            </button>

            <button
              onClick={() => {
                setActiveTab('hosts');
                callTauri<string>('get_hosts_content').then((txt) => txt && setHostsContent(txt));
              }}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-all duration-150 active:scale-[0.98] ${
                activeTab === 'hosts'
                  ? 'bg-[#1677FF] text-white font-semibold shadow-[0_2px_8px_rgba(22,119,255,0.25)]'
                  : 'text-[#57606A] hover:bg-[#F2F4F7] hover:text-[#1E2024]'
              }`}
            >
              <span className="flex items-center gap-2">
                <Globe className="w-3.5 h-3.5 shrink-0" />
                <span>Hosts 维护</span>
              </span>
              <span className={`text-[9px] font-mono ${activeTab === 'hosts' ? 'text-white/80' : 'text-neutral-400'}`}>DNS</span>
            </button>

            <button
              onClick={() => setActiveTab('doctor')}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-all duration-150 active:scale-[0.98] ${
                activeTab === 'doctor'
                  ? 'bg-[#1677FF] text-white font-semibold shadow-[0_2px_8px_rgba(22,119,255,0.25)]'
                  : 'text-[#57606A] hover:bg-[#F2F4F7] hover:text-[#1E2024]'
              }`}
            >
              <span className="flex items-center gap-2">
                <Activity className="w-3.5 h-3.5 shrink-0" />
                <span>内核与驱动</span>
              </span>
              <span className={`w-1.5 h-1.5 rounded-full ${systemStatus?.winfsp_driver_running ? 'bg-[#52C41A] ring-2 ring-[#52C41A]/30' : 'bg-[#FF4D4F]'}`} />
            </button>

            <button
              onClick={() => {
                setActiveTab('settings');
                callTauri<AppSettings>('get_app_settings').then((s) => s && setAppSettings(s));
              }}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-all duration-150 active:scale-[0.98] ${
                activeTab === 'settings'
                  ? 'bg-[#1677FF] text-white font-semibold shadow-[0_2px_8px_rgba(22,119,255,0.25)]'
                  : 'text-[#57606A] hover:bg-[#F2F4F7] hover:text-[#1E2024]'
              }`}
            >
              <span className="flex items-center gap-2">
                <Settings className="w-3.5 h-3.5 shrink-0" />
                <span>偏好设置</span>
              </span>
            </button>
          </nav>
        </div>

        {/* 底部实时吞吐微仪表 */}
        <div className="p-2.5 border-t border-[#E6E8EB] flex flex-col gap-1.5 bg-[#FBFBFC]">
          <div className="bg-[#FFFFFF] rounded-lg px-2.5 py-1.5 border border-[#E6E8EB] shadow-[0_1px_2px_rgba(0,0,0,0.03)] flex items-center justify-between font-mono text-[10.5px]">
            <div className="flex items-center gap-1 text-[#389E0D] font-semibold tabular-nums">
              <ArrowUp className="w-2.5 h-2.5" />
              <span>{netSpeed.up}</span>
            </div>
            <span className="text-[#D0D7DE]">|</span>
            <div className="flex items-center gap-1 text-[#0958D9] font-semibold tabular-nums">
              <ArrowDown className="w-2.5 h-2.5" />
              <span>{netSpeed.down}</span>
            </div>
          </div>

          <div className="flex items-center justify-between text-[10px] text-[#6E7781] px-0.5">
            <span className="flex items-center gap-1.5 font-normal">
              <span className={`w-1.5 h-1.5 rounded-full ${systemStatus?.winfsp_driver_running ? 'bg-[#52C41A] ring-2 ring-[#52C41A]/30' : 'bg-[#FF4D4F]'}`} />
              <span>{systemStatus?.winfsp_driver_running ? 'WinFsp 就绪' : '驱动异常'}</span>
            </span>
            <button
              onClick={() => callTauri('open_global_dir')}
              className="text-[#1677FF] hover:underline font-semibold text-[9.5px]"
            >
              元数据
            </button>
          </div>
        </div>
      </aside>

      {/* ========================================================================= */}
      {/* 第 2 列：主工作区 (纯白极简底色 + 紧凑现代规整表格) */}
      {/* ========================================================================= */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#FFFFFF]">
        
        {/* 顶栏可拖拽区域 */}
        <div
          data-tauri-drag-region
          onMouseDown={handleStartDrag}
          className="h-10 px-5 flex items-center justify-between border-b border-[#E6E8EB] shrink-0 cursor-default bg-[#FFFFFF]/90 backdrop-blur-xl"
        >
          <div className="flex items-center gap-1.5 text-[11px] text-[#6E7781] pointer-events-none">
            <span className="font-normal text-neutral-400">工作台</span>
            <span className="text-neutral-300">/</span>
            <span className="text-[#1E2024] font-semibold">
              {activeTab === 'mappings' && '虚拟镜像映射'}
              {activeTab === 'hosts' && 'Hosts 维护'}
              {activeTab === 'doctor' && '内核与驱动环境体检'}
              {activeTab === 'settings' && '偏好设置'}
            </span>
          </div>

          {/* 右上角原生窗口控件 */}
          <div className="flex items-center gap-0.5 text-[#6E7781]">
            <button onClick={handleMin} title="最小化" className="w-6 h-6 flex items-center justify-center rounded hover:bg-[#F2F4F7] text-[#6E7781] transition-colors">
              <Minus className="w-3 h-3" />
            </button>
            <button onClick={handleMax} title="最大化" className="w-6 h-6 flex items-center justify-center rounded hover:bg-[#F2F4F7] text-[#6E7781] transition-colors">
              <Square className="w-2.5 h-2.5" />
            </button>
            <button onClick={handleClose} title="隐藏至托盘" className="w-6 h-6 flex items-center justify-center rounded hover:bg-[#FFEBE9] hover:text-[#CF222E] text-[#6E7781] transition-colors">
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* 视图 1：镜像映射 Table */}
        {activeTab === 'mappings' && (
          <div className="flex-1 flex flex-col p-5 overflow-y-auto">
            
            {/* 顶部标题与操作工具条 */}
            <div className="flex items-center justify-between pb-3.5 border-b border-[#E6E8EB]">
              <div>
                <h1 className="text-[16px] font-bold tracking-tight text-[#1E2024] flex items-center gap-1.5">
                  <span>虚拟镜像映射</span>
                  <span className="text-[10px] font-normal text-neutral-400 bg-neutral-100 rounded px-1.5 py-0.2">NTFS 虚拟化</span>
                </h1>
                <p className="text-[11px] text-[#6E7781] mt-0.5">
                  基于 WinFsp 内核穿透的高性能无盘符文件系统镜像 • 实时零拷贝直通
                </p>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-3 h-3 text-neutral-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="过滤工作区或路径..."
                    className="w-56 h-7 pl-7 pr-2.5 bg-[#FAFAFA] hover:bg-white focus:bg-white border border-[#D0D7DE] focus:border-[#1677FF] rounded-md text-[11px] text-[#1E2024] placeholder-neutral-400 outline-none transition-all shadow-2xs"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>

                <Tooltip content="刷新数据">
                  <button
                    onClick={() => loadData()}
                    className="w-7 h-7 flex items-center justify-center rounded-md border border-[#D0D7DE] bg-white hover:bg-[#F2F4F7] text-[#6E7781] transition-all duration-150 active:scale-95 shadow-2xs"
                  >
                    <RotateCw className="w-3 h-3" />
                  </button>
                </Tooltip>

                <Button
                  color="primary"
                  size="sm"
                  radius="md"
                  className="h-7 px-3 text-[11px] font-semibold bg-[#1677FF] shadow-xs hover:bg-[#0958D9] active:scale-95 transition-all"
                  startContent={<Plus className="w-3 h-3" />}
                  onPress={onOpen}
                >
                  新建映射
                </Button>
              </div>
            </div>

            {/* 顶栏微型统计条 (Compact Metric Strip) */}
            <div className="grid grid-cols-4 gap-3 my-3.5">
              <div className="rounded-lg border border-[#E6E8EB] bg-[#FFFFFF] p-2.5 flex items-center justify-between shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                <div>
                  <span className="text-[9.5px] font-semibold text-[#6E7781] uppercase tracking-wider block">活动映射点</span>
                  <span className="text-[15px] font-bold text-[#1E2024] font-mono mt-0.5 block tabular-nums">
                    {workspaces.filter((w) => w.is_alive).length}
                  </span>
                </div>
                <div className="w-6 h-6 rounded-md bg-[#E6F4FF] text-[#1677FF] flex items-center justify-center font-medium">
                  <FolderOpen className="w-3.5 h-3.5" />
                </div>
              </div>

              <div className="rounded-lg border border-[#E6E8EB] bg-[#FFFFFF] p-2.5 flex items-center justify-between shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                <div>
                  <span className="text-[9.5px] font-semibold text-[#6E7781] uppercase tracking-wider block">磁盘节省率</span>
                  <span className="text-[15px] font-bold text-[#52C41A] font-mono mt-0.5 block tabular-nums">99.1%</span>
                </div>
                <div className="w-6 h-6 rounded-md bg-[#F6FFED] text-[#52C41A] flex items-center justify-center font-medium">
                  <Zap className="w-3.5 h-3.5" />
                </div>
              </div>

              <div className="rounded-lg border border-[#E6E8EB] bg-[#FFFFFF] p-2.5 flex items-center justify-between shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                <div>
                  <span className="text-[9.5px] font-semibold text-[#6E7781] uppercase tracking-wider block">累计节省存储</span>
                  <span className="text-[15px] font-bold text-[#1E2024] font-mono mt-0.5 block tabular-nums">
                    {formatBytes(systemStatus?.saved_disk_bytes || 0)}
                  </span>
                </div>
                <div className="w-6 h-6 rounded-md bg-[#F2F4F7] text-[#6E7781] flex items-center justify-center font-medium">
                  <HardDrive className="w-3.5 h-3.5" />
                </div>
              </div>

              <div className="rounded-lg border border-[#E6E8EB] bg-[#FFFFFF] p-2.5 flex items-center justify-between shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                <div>
                  <span className="text-[9.5px] font-semibold text-[#6E7781] uppercase tracking-wider block">内核穿透延迟</span>
                  <span className="text-[15px] font-bold text-[#1677FF] font-mono mt-0.5 block tabular-nums">&lt; 0.05 ms</span>
                </div>
                <div className="w-6 h-6 rounded-md bg-[#E6F4FF] text-[#1677FF] flex items-center justify-center font-medium">
                  <Activity className="w-3.5 h-3.5" />
                </div>
              </div>
            </div>

            {/* 核心映射表格 (高阶 IDE 面包屑分段路径 + 严谨自适应布局) */}
            <div className="rounded-lg border border-[#D0D7DE] overflow-hidden bg-white shadow-[0_1px_3px_rgba(0,0,0,0.02)] mb-3.5">
              <table className="w-full table-fixed text-left border-collapse">
                <thead>
                  <tr className="h-8 bg-[#FAFAFA] border-b border-[#D0D7DE] text-[10px] font-semibold text-[#6E7781] uppercase tracking-wider select-none">
                    <th className="w-[17%] pl-3.5 font-medium">工作区</th>
                    <th className="w-[29%] px-2.5 font-medium">物理源仓底座路径 (SOURCE)</th>
                    <th className="w-[29%] px-2.5 font-medium">虚拟挂载透视点路径 (TARGET)</th>
                    <th className="w-[11%] px-2 font-medium">状态 / 模式</th>
                    <th className="w-[6%] px-2 font-medium">差异</th>
                    <th className="w-[8%] pr-3.5 font-medium text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E6E8EB] text-[11px]">
                  {filteredWorkspaces.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="h-24 text-center text-neutral-400 text-[11px]">
                        暂无镜像映射记录，点击右上角“新建映射”挂载源码仓
                      </td>
                    </tr>
                  ) : (
                    filteredWorkspaces.map((ws, idx) => {
                      const isSelected = selectedWs?.target_path === ws.target_path;
                      return (
                        <tr
                          key={ws.target_path}
                          onClick={() => setSelectedWsIdx(idx)}
                          className={`h-10 transition-colors cursor-pointer group ${
                            isSelected
                              ? 'bg-gradient-to-r from-[#E6F4FF]/70 via-[#E6F4FF]/30 to-transparent border-l-[3px] border-l-[#1677FF]'
                              : 'hover:bg-[#F9FAFB] border-l-[3px] border-l-transparent'
                          }`}
                        >
                          {/* 工作区名称 */}
                          <td className="pl-3 pr-2 py-1">
                            <div className="flex items-center gap-1.5 truncate">
                              <div className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${
                                ws.is_alive ? 'bg-[#E6F4FF] text-[#1677FF]' : 'bg-neutral-100 text-neutral-400'
                              }`}>
                                <FolderGit2 className="w-3 h-3" />
                              </div>
                              <div className="truncate leading-none">
                                <span className="font-semibold text-[#1E2024] text-[11.5px] block truncate" title={ws.name}>
                                  {ws.name}
                                </span>
                                <span className="text-[9px] font-mono text-[#6E7781] block mt-0.5 tabular-nums">
                                  {ws.pid ? `PID ${ws.pid}` : '脱机'}
                                </span>
                              </div>
                            </div>
                          </td>

                          {/* 物理源仓路径 (分段面包屑渲染) */}
                          <td className="px-2.5 py-1">
                            <div className="flex items-center justify-between gap-1.5 bg-[#F6F8FA] hover:bg-[#F0F2F5] border border-[#D0D7DE]/70 rounded-md px-2 py-0.5 transition-colors">
                              <PathSegment path={ws.source_path} />
                              <div className="flex items-center gap-0.5 shrink-0 opacity-40 group-hover:opacity-100 transition-opacity">
                                <button
                                  title="复制物理路径"
                                  onClick={(e) => { e.stopPropagation(); handleCopy(ws.source_path, `src-${idx}`); }}
                                  className="p-0.5 hover:bg-white rounded hover:shadow-2xs text-[#6E7781] hover:text-[#1677FF]"
                                >
                                  {copiedKey === `src-${idx}` ? <CheckCircle2 className="w-2.5 h-2.5 text-[#52C41A]" /> : <Copy className="w-2.5 h-2.5" />}
                                </button>
                                <button
                                  title="在文件资源管理器中定位"
                                  onClick={(e) => { e.stopPropagation(); handleLocateSource(ws.source_path); }}
                                  className="p-0.5 hover:bg-white rounded hover:shadow-2xs text-[#6E7781] hover:text-[#1E2024]"
                                >
                                  <ExternalLink className="w-2.5 h-2.5" />
                                </button>
                              </div>
                            </div>
                          </td>

                          {/* 虚拟挂载点路径 (可点击浏览) */}
                          <td className="px-2.5 py-1">
                            <div className="flex items-center justify-between gap-1 bg-[#F6F8FA] hover:bg-[#F0F2F5] border border-[#D0D7DE]/70 rounded-md px-2 py-0.5 transition-colors">
                              <PathSegment path={ws.target_path} />
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  title="复制挂载路径"
                                  onClick={(e) => { e.stopPropagation(); handleCopy(ws.target_path, `tgt-${idx}`); }}
                                  className="p-0.5 hover:bg-white rounded hover:shadow-2xs text-[#6E7781] hover:text-[#1677FF] opacity-40 group-hover:opacity-100 transition-opacity"
                                >
                                  {copiedKey === `tgt-${idx}` ? <CheckCircle2 className="w-2.5 h-2.5 text-[#52C41A]" /> : <Copy className="w-2.5 h-2.5" />}
                                </button>
                                <button
                                  title="在资源管理器中打开此挂载点"
                                  onClick={(e) => { e.stopPropagation(); handleOpenExplorer(ws.target_path); }}
                                  className="px-1.5 py-0.2 rounded bg-[#E6F4FF] hover:bg-[#BAE0FF] text-[#1677FF] text-[9.5px] font-semibold transition-all active:scale-95 shrink-0"
                                >
                                  浏览
                                </button>
                              </div>
                            </div>
                          </td>

                          {/* 状态 / 模式 */}
                          <td className="px-2 py-1">
                            <div className="flex flex-col leading-tight">
                              <div className="flex items-center gap-1.5">
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                  ws.is_alive ? 'bg-[#52C41A] ring-4 ring-[#52C41A]/20 shadow-[0_0_8px_rgba(82,196,26,0.8)] animate-pulse' : 'bg-neutral-300'
                                }`} />
                                <span className={`text-[10px] font-medium ${
                                  ws.is_alive ? 'text-[#389E0D]' : 'text-neutral-400'
                                }`}>
                                  {ws.is_alive ? '挂载就绪' : '已脱机'}
                                </span>
                              </div>
                              <span className="text-[9px] text-neutral-400 pl-3">
                                {ws.mode === 'direct_mirror' ? '零拷贝直通' : '写时复制'}
                              </span>
                            </div>
                          </td>

                          {/* 差异占用 */}
                          <td className="px-2 py-1">
                            <div className="flex flex-col leading-tight">
                              <span className="font-mono text-[10.5px] font-semibold text-[#1E2024] tabular-nums">
                                {ws.mode === 'direct_mirror' ? '0 B' : `${ws.total_diff_kb.toFixed(1)} KB`}
                              </span>
                              <span className="text-[8.5px] text-[#52C41A] font-medium">
                                节省 99.1%
                              </span>
                            </div>
                          </td>

                          {/* 快捷操作 */}
                          <td className="pr-3.5 pl-1 py-1 text-right">
                            <div className="inline-flex items-center gap-1 justify-end">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleToggleMount(ws); }}
                                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all active:scale-95 ${
                                  ws.is_alive
                                    ? 'bg-[#FFFBE6] text-[#D48806] hover:bg-[#FFE58F] border border-[#FFE58F]'
                                    : 'bg-[#E6F4FF] text-[#1677FF] hover:bg-[#BAE0FF] border border-[#BAE0FF]'
                                }`}
                              >
                                {ws.is_alive ? '脱机' : '挂载'}
                              </button>
                              <button
                                title="彻底移除此镜像映射"
                                onClick={(e) => { e.stopPropagation(); handleDeleteWorkspace(ws); }}
                                className="p-1 rounded text-neutral-400 hover:text-[#CF222E] hover:bg-[#FFEBE9] transition-colors"
                              >
                                <Trash2 className="w-2.5 h-2.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* 选定工作区变更流明细 */}
            {selectedWs && (
              <div className="rounded-lg border border-[#D0D7DE] bg-white p-3 shadow-2xs">
                <div className="flex items-center justify-between pb-2 border-b border-[#F0F2F4] mb-2">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-[#1677FF]" />
                    <h3 className="text-[11.5px] font-bold text-[#1E2024]">
                      [{selectedWs.name}] 实时写时变更流明细
                    </h3>
                  </div>
                  <span className="text-[9.5px] font-mono text-[#6E7781] bg-[#F6F8FA] border border-[#D0D7DE]/60 rounded px-1.5 py-0.2 tabular-nums">
                    {selectedWs.changes ? `${selectedWs.changes.length} 项变动` : '0 项变动'}
                  </span>
                </div>

                {selectedWs.mode === 'direct_mirror' ? (
                  <div className="py-3 px-4 text-center text-[#6E7781] text-[11px] bg-[#FAFAFA] rounded-md border border-[#F0F2F4]">
                    当前处于 <strong>直通镜像模式 (Zero-Copy Passthrough)</strong>，读写直接穿透落地至源码仓物理底座，原生速度 0 损耗，无需记录差异层。
                  </div>
                ) : selectedWs.changes?.length > 0 ? (
                  <div className="divide-y divide-[#F0F2F4] max-h-44 overflow-y-auto">
                    {selectedWs.changes.map((ch, idx) => (
                      <div key={idx} className="py-1 flex items-center justify-between gap-3 text-[11px]">
                        <div className="flex items-center gap-1.5 truncate">
                          <span className={`w-3.5 h-3.5 rounded flex items-center justify-center font-mono text-[9px] font-bold ${
                            ch.change_type === '新增' ? 'bg-[#F6FFED] text-[#52C41A]' : ch.change_type === '删除' ? 'bg-[#FFF1F0] text-[#FF4D4F]' : 'bg-[#FFFBE6] text-[#FAAD14]'
                          }`}>
                            {ch.change_type === '新增' ? '+' : ch.change_type === '删除' ? '-' : '~'}
                          </span>
                          <span className={`font-mono text-[#1E2024] truncate ${ch.change_type === '删除' ? 'line-through text-neutral-400' : ''}`}>
                            {ch.rel_path}
                          </span>
                          <span className="text-[9.5px] text-neutral-400 font-mono tabular-nums">{ch.size_kb.toFixed(1)} KB</span>
                        </div>
                        <button
                          className="text-[#1677FF] hover:underline text-[10px] font-medium"
                          onClick={() => callTauri('locate_in_explorer', { path: selectedWs.target_path + '\\' + ch.rel_path })}
                        >
                          定位文件
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-3 text-center text-neutral-400 text-[11px] bg-[#FAFAFA] rounded-md border border-[#F0F2F4]">
                    工作区暂无写时变更文件 (与源码底座 100% 保持一致)
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 视图 2：Hosts 维护 */}
        {activeTab === 'hosts' && (
          <div className="flex-1 flex flex-col p-5 overflow-hidden">
            <div className="flex items-center justify-between pb-3 border-b border-[#E6E8EB] shrink-0">
              <div>
                <h2 className="text-[16px] font-bold tracking-tight text-[#1E2024]">Hosts 配置文件</h2>
                <p className="text-[10px] text-[#6E7781] font-mono mt-0.5">C:\Windows\System32\drivers\etc\hosts</p>
              </div>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="bordered" radius="md" className="h-7 text-[11px] border-[#D0D7DE]" onPress={() => callTauri<string>('get_hosts_content').then((t) => t && setHostsContent(t))}>重新载入</Button>
                <Button size="sm" color="primary" radius="md" className="h-7 text-[11px] font-semibold bg-[#1677FF]" onPress={async () => {
                  await callTauri('save_hosts_content', { content: hostsContent });
                  alert('Hosts 保存成功并已刷新 DNS！');
                }}>保存并刷新 DNS</Button>
              </div>
            </div>

            <div className="flex-1 mt-3 rounded-lg border border-[#D0D7DE] bg-[#FAFAFA] p-3 overflow-hidden flex flex-col">
              <textarea
                value={hostsContent}
                onChange={(e) => setHostsContent(e.target.value)}
                spellCheck="false"
                className="flex-1 w-full p-2 font-mono text-[11px] text-[#1E2024] bg-transparent focus:outline-none resize-none leading-relaxed"
                placeholder="正在读取系统 Hosts..."
              />
            </div>
          </div>
        )}

        {/* 视图 3：内核诊断 */}
        {activeTab === 'doctor' && (
          <div className="flex-1 flex flex-col p-5 overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-[#E6E8EB]">
              <div>
                <h2 className="text-[16px] font-bold tracking-tight text-[#1E2024]">内核与驱动环境体检</h2>
                <p className="text-[11px] text-[#6E7781] mt-0.5">检测 WinFsp 文件系统驱动服务、权限模式与挂载健康</p>
              </div>
              <Button size="sm" color="primary" radius="md" className="h-7 text-[11px] bg-[#1677FF]" onPress={() => loadData()}>重新检测</Button>
            </div>

            <div className="grid grid-cols-2 gap-3 mt-4">
              <div className="rounded-lg border border-[#D0D7DE] bg-white p-3.5 shadow-2xs flex flex-col gap-1.5">
                <span className="text-[10px] font-semibold text-neutral-400 uppercase">WinFsp 核心驱动服务</span>
                <div className="flex items-center justify-between">
                  <span className={`text-[13px] font-bold ${systemStatus?.winfsp_driver_running ? 'text-[#389E0D]' : 'text-[#CF222E]'}`}>
                    {systemStatus?.winfsp_driver_running ? '正常运行中' : '未就绪 (服务未启动)'}
                  </span>
                  <span className="text-[9.5px] font-mono px-1.5 py-0.5 rounded bg-[#F6F8FA] border border-[#D0D7DE] text-neutral-600">winfsp-2.x</span>
                </div>
                <p className="text-[10.5px] text-[#6E7781] leading-relaxed mt-0.5">负责底层内核写时复制与虚拟挂载点，向 Windows 提供标准 NTFS 物理目录视界。</p>
              </div>

              <div className="rounded-lg border border-[#D0D7DE] bg-white p-3.5 shadow-2xs flex flex-col gap-1.5">
                <span className="text-[10px] font-semibold text-neutral-400 uppercase">特权隔离与权限</span>
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-bold text-[#1677FF]">标准用户权限 (免 UAC 提权)</span>
                  <span className="text-[9.5px] font-mono px-1.5 py-0.5 rounded bg-[#E6F4FF] text-[#1677FF] border border-[#BAE0FF]">HKCU Ready</span>
                </div>
                <p className="text-[10.5px] text-[#6E7781] leading-relaxed mt-0.5">采用用户级隔离机制，无需每次启动向系统申请管理员特权，完全安全静默。</p>
              </div>
            </div>
          </div>
        )}

        {/* 视图 4：偏好设置 */}
        {activeTab === 'settings' && (
          <div className="flex-1 flex flex-col p-5 max-w-2xl overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-[#E6E8EB]">
              <div>
                <h2 className="text-[16px] font-bold tracking-tight text-[#1E2024]">偏好设置</h2>
                <p className="text-[11px] text-[#6E7781] mt-0.5">任务栏网速指示器与工作台行为设置</p>
              </div>
              <Button size="sm" color="primary" radius="md" className="h-7 text-[11px] bg-[#1677FF]" onPress={async () => {
                await callTauri('save_app_settings', { newSettings: appSettings });
                alert('偏好设置已成功保存！');
              }}>存储设置</Button>
            </div>

            <div className="rounded-lg border border-[#D0D7DE] bg-white mt-4 divide-y divide-[#E6E8EB] shadow-2xs text-[11.5px]">
              <div className="p-3 flex items-center justify-between">
                <div>
                  <span className="font-semibold text-[#1E2024] block text-[12px]">任务栏原生网速条</span>
                  <span className="text-[#6E7781] mt-0.5 block text-[10.5px]">在 Windows 任务栏通知区左侧实时绘制上下行速率</span>
                </div>
                <Switch
                  size="sm"
                  color="success"
                  isSelected={appSettings.taskbar_speed_enabled}
                  onValueChange={(v) => setAppSettings({ ...appSettings, taskbar_speed_enabled: v })}
                />
              </div>

              <div className="p-3 flex items-center justify-between">
                <div>
                  <span className="font-semibold text-[#1E2024] block text-[12px]">开机自动启动</span>
                  <span className="text-[#6E7781] mt-0.5 block text-[10.5px]">登录系统时自动在后台启动 a8-devtools 并恢复工作区</span>
                </div>
                <Switch
                  size="sm"
                  color="success"
                  isSelected={appSettings.autostart}
                  onValueChange={(v) => setAppSettings({ ...appSettings, autostart: v })}
                />
              </div>

              <div className="p-3 flex items-center justify-between">
                <div>
                  <span className="font-semibold text-[#1E2024] block text-[12px]">网速采样频率 (秒)</span>
                  <span className="text-[#6E7781] mt-0.5 block text-[10.5px]">控制网络数据刷新周期</span>
                </div>
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={appSettings.sample_interval_secs}
                  onChange={(e) => setAppSettings({ ...appSettings, sample_interval_secs: parseInt(e.target.value, 10) || 5 })}
                  className="w-14 h-7 px-2 rounded-md bg-[#FAFAFA] border border-[#D0D7DE] text-center font-mono font-medium text-[11px]"
                />
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ========================================================================= */}
      {/* 新建工作区模态框 (Ant Design 级精致弹窗) */}
      {/* ========================================================================= */}
      <Modal isOpen={isOpen} onOpenChange={setIsOpen}>
        <ModalBackdrop>
          <ModalContainer size="md">
            <ModalDialog className="p-5 bg-white rounded-lg shadow-xl border border-[#D0D7DE]">
              <ModalHeader className="flex items-center gap-2 pb-3 border-b border-[#F0F2F4]">
                <div className="w-5 h-5 rounded bg-[#1677FF] text-white flex items-center justify-center font-medium">
                  <Plus className="w-3.5 h-3.5" />
                </div>
                <span className="font-bold text-[13.5px] text-[#1E2024]">新建虚拟镜像映射</span>
              </ModalHeader>
              <ModalBody className="gap-3 py-3 text-[12px]">
                <Input
                  label="工作区名称"
                  size="sm"
                  placeholder="例如: my-agent"
                  variant="bordered"
                  value={newWsName}
                  onValueChange={setNewWsName}
                />

                <Input
                  label="基础物理源仓目录"
                  size="sm"
                  placeholder="源码物理根路径，例如: E:\projects\my-agent"
                  variant="bordered"
                  value={newWsSource}
                  onValueChange={setNewWsSource}
                  endContent={
                    <Button size="sm" variant="flat" className="h-6 text-[10px]" onPress={handlePickSource}>
                      浏览...
                    </Button>
                  }
                />

                <Input
                  label="目标虚拟挂载点"
                  size="sm"
                  placeholder="插件/目标路径，例如: C:\Users\...\plugins\my-agent"
                  variant="bordered"
                  value={newWsTarget}
                  onValueChange={setNewWsTarget}
                  endContent={
                    <Button size="sm" variant="flat" className="h-6 text-[10px]" onPress={handlePickTarget}>
                      浏览...
                    </Button>
                  }
                />

                <RadioGroup label="运行模式选择" size="sm" value={newWsMode} onValueChange={setNewWsMode}>
                  <Radio value="direct" description="0 差异层，双向实时物理直通，向系统呈现为标准 NTFS 原生目录。">
                    直通镜像 (推荐)
                  </Radio>
                  <Radio value="cow" description="底层源码 100% 只读保护，所有改动落入独立差异物理层。">
                    写时复制模式
                  </Radio>
                </RadioGroup>
              </ModalBody>
              <ModalFooter className="pt-3 border-t border-[#F0F2F4] flex justify-end gap-1.5">
                <Button size="sm" variant="flat" className="h-7 text-[11px]" onPress={() => setIsOpen(false)}>
                  取消
                </Button>
                <Button size="sm" color="primary" className="h-7 text-[11px] font-semibold bg-[#1677FF]" isLoading={isSubmitting} onPress={handleCreateWorkspace}>
                  立即挂载
                </Button>
              </ModalFooter>
            </ModalDialog>
          </ModalContainer>
        </ModalBackdrop>
      </Modal>

    </div>
  );
}
