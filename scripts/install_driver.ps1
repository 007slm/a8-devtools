$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host '============================================================' -ForegroundColor Cyan
    Write-Host '  正在请求管理员权限，请在弹出的 UAC 窗口中点击【是】...' -ForegroundColor Yellow
    Write-Host '============================================================' -ForegroundColor Cyan
    try {
        Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    } catch {
        Write-Host '无法自动弹出提权窗口，请右键点击 install_driver.bat 选择【以管理员身份运行】。' -ForegroundColor Red
        Read-Host '按回车键退出...'
    }
    exit
}

Set-Location $PSScriptRoot

Write-Host '============================================================' -ForegroundColor Cyan
Write-Host '          正在以管理员身份安装 WinFsp 2025 内核驱动         ' -ForegroundColor Cyan
Write-Host '============================================================' -ForegroundColor Cyan

# 1. 清理历史孤立注册表项
Write-Host ''
Write-Host '[1/3] 正在清理阻碍安装的历史孤立注册表项...' -ForegroundColor Yellow
$regPaths = @(
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\{9FEEBF8C-44C2-4697-9D5D-87BFD10CC79D}',
    'HKLM:\SOFTWARE\Classes\Installer\Products\C8FBEEF92C447964D9D578FB1DC07CD9',
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Installer\UserData\S-1-5-18\Products\C8FBEEF92C447964D9D578FB1DC07CD9'
)
foreach ($p in $regPaths) {
    if (Test-Path $p) {
        Remove-Item -Path $p -Recurse -Force -ErrorAction SilentlyContinue
    }
}
$upgradePath = 'HKLM:\SOFTWARE\Classes\Installer\UpgradeCodes\9D218F2838041FE4B88CF0E1AD504BB6'
if (Test-Path $upgradePath) {
    Remove-ItemProperty -Path $upgradePath -Name 'C8FBEEF92C447964D9D578FB1DC07CD9' -Force -ErrorAction SilentlyContinue
}
Write-Host '注册表项清理完成。' -ForegroundColor Green

# 2. 安装 MSI
$msiPath = Join-Path $PSScriptRoot 'winfsp-2.1.25156.msi'
$logDir = Join-Path $PSScriptRoot 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$logPath = Join-Path $logDir 'driver_install.log'

Write-Host ''
Write-Host '[2/3] 正在安装 WinFsp 驱动组件 (msiexec)...' -ForegroundColor Yellow
$proc = Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`" /qn /norestart /log `"$logPath`"" -Wait -PassThru

if ($proc.ExitCode -eq 0 -or $proc.ExitCode -eq 3010) {
    Write-Host 'WinFsp 安装包部署成功！' -ForegroundColor Green
} else {
    Write-Host "安装返回码: $($proc.ExitCode)，详情见 logs\driver_install.log" -ForegroundColor Red
}

# 3. 启动并检测驱动服务
Write-Host ''
Write-Host '[3/3] 正在检测并启动 winfsp 内核驱动服务...' -ForegroundColor Yellow
Start-Process sc.exe -ArgumentList 'start winfsp' -Wait -WindowStyle Hidden

Start-Sleep -Seconds 1
$svc = Get-Service -Name 'winfsp' -ErrorAction SilentlyContinue
Write-Host '============================================================' -ForegroundColor Cyan
if ($svc -and $svc.Status -eq 'Running') {
    Write-Host '[√] WinFsp 内核驱动服务已成功启动 (STATE: RUNNING)！' -ForegroundColor Green
} elseif ($svc) {
    Write-Host "[√] WinFsp 驱动服务已就绪 (状态: $($svc.Status))，挂载时将按需加载。" -ForegroundColor Green
} else {
    Write-Host '[√] WinFsp 内核组件已就绪，挂载时由驱动接口加载。' -ForegroundColor Green
}
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host ''
Write-Host '安装全部完成！现在可以直接关闭此窗口，回到终端继续挂载测试。' -ForegroundColor White
Write-Host '按回车键退出...'
Read-Host