<#
.SYNOPSIS
    Agent Mind - DSH (DeepSeek Harness) 架构终审执行与双通道归档脚本
.DESCRIPTION
    1. 自动基于 $PSScriptRoot 定位插件根目录及 reviews/ 归档目录；
    2. 根据 -WorkspaceDir 动态映射 $env:USERPROFILE\.dsh\sessions\--<Slug>-- 自动复用最近会话；
    3. 严格分离 dsh.cmd headless 的 stdout(终审正文) 与 stderr(reasoning 噪音)，UTF-8 无 BOM 编码；
    4. 生成带标准 YAML Frontmatter 的归档报告至 <plugin_dir>/reviews/，同时输出结构化 JSON 给调用方，
       并在执行后自动清理临时 Prompt 文件。
#>
param(
    [string]$WorkspaceDir = (Get-Location).Path,
    [string]$Repo = "",
    [int]$Round = 1,
    [string]$Title = "",
    [string]$PromptFile = "",
    [string]$OutputFile = "",
    [string]$SessionId = "",
    [switch]$NewSession,
    [string[]]$AddDirs = @(),
    [string]$PermissionMode = "read-only",
    [switch]$KeepPromptFile,
    [switch]$ArchiveOnly,
    [string]$InputReportFile = "",
    [string]$VerdictOverride = "",
    [string]$TimestampOverride = "",
    [double]$DurationOverrideSec = -1
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Resolve-DshCli {
    $defaultPath = Join-Path $env:LOCALAPPDATA "Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd"
    if (Test-Path $defaultPath) {
        return $defaultPath
    }
    $cmd = Get-Command "dsh.cmd" -ErrorAction SilentlyContinue
    if ($cmd) {
        return $cmd.Source
    }
    throw "未找到 DeepSeek Harness CLI (dsh.cmd)。请确认已安装 DeepSeek Harness 或配置 PATH。"
}

function Get-DshWorkspaceSlug {
    param([Parameter(Mandatory = $true)][string]$PathText)
    $resolved = [System.IO.Path]::GetFullPath($PathText).TrimEnd('\', '/')
    # 将盘符冒号与路径分隔符折叠为单个 '-'
    $collapsed = [regex]::Replace($resolved, '[:\\/]+', '-')
    $sb = New-Object System.Text.StringBuilder
    foreach ($ch in $collapsed.ToCharArray()) {
        $code = [int][char]$ch
        $isSafeAscii = ($code -ge 48 -and $code -le 57) -or
                       ($code -ge 65 -and $code -le 90) -or
                       ($code -ge 97 -and $code -le 122) -or
                       ($ch -eq '-') -or ($ch -eq '_') -or ($ch -eq '.')
        if ($isSafeAscii) {
            [void]$sb.Append($ch)
        } else {
            [void]$sb.Append(('~{0:X4}' -f $code))
        }
    }
    return "--$($sb.ToString())--"
}

function Find-LatestDshSession {
    param([Parameter(Mandatory = $true)][string]$WorkspacePath)
    $sessionsRoot = Join-Path $env:USERPROFILE ".dsh\sessions"
    if (-not (Test-Path $sessionsRoot)) {
        return $null
    }
    $slug = Get-DshWorkspaceSlug -PathText $WorkspacePath
    $exactDir = Join-Path $sessionsRoot $slug
    $targetDir = $null
    if (Test-Path $exactDir) {
        $targetDir = $exactDir
    } else {
        $matched = Get-ChildItem -Path $sessionsRoot -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name.Equals($slug, [System.StringComparison]::OrdinalIgnoreCase) } |
            Select-Object -First 1
        if ($matched) {
            $targetDir = $matched.FullName
        }
    }
    if (-not $targetDir) {
        return $null
    }
    $latest = Get-ChildItem -Path $targetDir -Directory -Filter "session-*" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if ($latest) {
        return $latest.Name
    }
    return $null
}

function Escape-ProcessArg {
    param([string]$Arg)
    if ($null -eq $Arg -or $Arg -eq "") {
        return '""'
    }
    if ($Arg -notmatch '[\s"]') {
        return $Arg
    }
    $escaped = $Arg -replace '(\\*)"', '$1$1\"'
    $escaped = $escaped -replace '(\\+)$', '$1$1'
    return '"' + $escaped + '"'
}

function Clean-DshOutput {
    param([string]$RawText)
    if ([string]::IsNullOrWhiteSpace($RawText)) {
        return ""
    }
    # 剥离可能混入的 ANSI 控制符与孤立 dsh: reasoning: 段落
    $noAnsi = [regex]::Replace($RawText, "\x1B\[[0-9;?]*[A-Za-z]", "")
    $lines = $noAnsi -split "`r?`n"
    $out = New-Object System.Collections.Generic.List[string]
    $inReasoning = $false
    foreach ($line in $lines) {
        if ($line -match '^\s*dsh:\s*reasoning:') {
            $inReasoning = $true
            continue
        }
        if ($inReasoning) {
            if ($line -match '^(#|【|\*\*|---|\-\s|\d+\.\s|\|\s*[^|]+\|)') {
                $inReasoning = $false
            } else {
                continue
            }
        }
        $out.Add($line)
    }
    return ($out -join "`n").Trim()
}

function Resolve-DshVerdict {
    param(
        [string]$BodyText,
        [int]$ExitCode = 0,
        [string]$Override = ""
    )
    if (-not [string]::IsNullOrWhiteSpace($Override)) {
        return $Override.Trim().ToUpperInvariant()
    }
    if ($ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($BodyText)) {
        return "ERROR"
    }
    $lines = ($BodyText -split "`r?`n") | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" }
    $headTail = (($lines | Select-Object -First 12) + ($lines | Select-Object -Last 8)) -join "`n"

    if ($headTail -match '【\s*不通过|不通过\s*\((HOLD|VIOLATED)\)|最终判定[：:\s]*不通过|最终结论[：:\s]*【?不通过|\bVIOLATED\b') {
        return "VIOLATED"
    }
    if ($headTail -match '【\s*需人工拍板|需人工拍板|\bREQUIRES_APPROVAL\b') {
        return "REQUIRES_APPROVAL"
    }
    if ($headTail -match '【\s*终审通过\s*\(PASSED\)|准予\s*Commit\s*&\s*Push|\bPASSED\b') {
        return "PASSED"
    }
    if ($BodyText -match '不通过\s*\((HOLD|VIOLATED)\)|阻断项（P[012]）|唯一需修改项') {
        return "VIOLATED"
    }
    if ($BodyText -match '终审通过\s*\(PASSED\)|准予\s*Commit\s*&\s*Push') {
        return "PASSED"
    }
    return "REQUIRES_APPROVAL"
}

function Extract-Summary {
    param([string]$BodyText, [string]$FallbackVerdict)
    $lines = ($BodyText -split "`r?`n") | ForEach-Object { $_.Trim() }
    foreach ($line in $lines) {
        if (-not $line) { continue }
        if ($line -match '^#{1,6}\s') { continue }
        if ($line -match '^[-*`>|]') { continue }
        if ($line -match '^【?(终审结论|Round\s*\d+|终审通过|不通过|需人工拍板)') {
            $cleaned = ($line -replace '[*`【】]', '').Trim()
            if ($cleaned.Length -gt 8) {
                return ($cleaned.Substring(0, [Math]::Min(180, $cleaned.Length)))
            }
            continue
        }
        $plain = ($line -replace '[*`]', '').Trim()
        if ($plain.Length -ge 6) {
            return ($plain.Substring(0, [Math]::Min(180, $plain.Length)))
        }
    }
    return "DSH 审查完成（结论: $FallbackVerdict）"
}

function Sanitize-YamlScalar {
    param([string]$Text)
    if ($null -eq $Text) { return "" }
    $single = ($Text -replace "`r?`n", " " -replace '\s+', ' ').Trim()
    return ($single -replace '^"|"$', '')
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pluginRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDir "..\..\.."))
$reviewsDir = Join-Path $pluginRoot "reviews"
if (-not (Test-Path $reviewsDir)) {
    New-Item -ItemType Directory -Path $reviewsDir -Force | Out-Null
}

$resolvedWorkspace = [System.IO.Path]::GetFullPath($WorkspaceDir)
if ([string]::IsNullOrWhiteSpace($Repo)) {
    $Repo = Split-Path -Leaf $resolvedWorkspace
}
if ([string]::IsNullOrWhiteSpace($Title)) {
    $Title = "$Repo Round $Round 终审"
}

# 可选从 config.json 读取 deepseek_api_key（仅在环境变量未设置时注入，禁止写死明文密钥）
if ([string]::IsNullOrWhiteSpace($env:DEEPSEEK_API_KEY)) {
    $uKey = [Environment]::GetEnvironmentVariable("DEEPSEEK_API_KEY", "User")
    $mKey = [Environment]::GetEnvironmentVariable("DEEPSEEK_API_KEY", "Machine")
    if (-not [string]::IsNullOrWhiteSpace($uKey)) {
        $env:DEEPSEEK_API_KEY = $uKey
    } elseif (-not [string]::IsNullOrWhiteSpace($mKey)) {
        $env:DEEPSEEK_API_KEY = $mKey
    } else {
        $cfgFile = Join-Path $pluginRoot "config.json"
        if (Test-Path $cfgFile) {
            try {
                $cfgJson = [System.IO.File]::ReadAllText($cfgFile, $Utf8NoBom) | ConvertFrom-Json
                $cfgDsKey = $cfgJson.deepseek_api_key
                if ($cfgDsKey -and ($cfgDsKey -notmatch '^\$\{.+\}$') -and ($cfgDsKey -ne '***MASKED***') -and ($cfgDsKey -ne '***')) {
                    $env:DEEPSEEK_API_KEY = $cfgDsKey
                }
            } catch {
                # 忽略非关键读取异常，交由 DSH 原生 .credentials.yaml 处理
            }
        }
    }
}

$usedSession = $SessionId
$reportBody = ""
$exitCode = 0
$durationSec = 0.0

if ($ArchiveOnly) {
    if ([string]::IsNullOrWhiteSpace($InputReportFile) -or -not (Test-Path $InputReportFile)) {
        throw "ArchiveOnly 模式下必须指定存在的 -InputReportFile。"
    }
    $rawInput = [System.IO.File]::ReadAllText($InputReportFile, $Utf8NoBom)
    $reportBody = Clean-DshOutput -RawText $rawInput
    if ($DurationOverrideSec -ge 0) {
        $durationSec = [Math]::Round($DurationOverrideSec, 1)
    }
} else {
    if ([string]::IsNullOrWhiteSpace($PromptFile) -or -not (Test-Path $PromptFile)) {
        throw "Prompt 文件不存在: $PromptFile"
    }
    $dshCli = Resolve-DshCli
    $promptText = [System.IO.File]::ReadAllText($PromptFile, $Utf8NoBom)
    if ([string]::IsNullOrWhiteSpace($promptText)) {
        throw "Prompt 文件内容为空: $PromptFile"
    }

    if (-not $NewSession -and [string]::IsNullOrWhiteSpace($usedSession)) {
        $usedSession = Find-LatestDshSession -WorkspacePath $resolvedWorkspace
    }

    $argList = New-Object System.Collections.Generic.List[string]
    $argList.Add("headless")
    if (-not [string]::IsNullOrWhiteSpace($PermissionMode)) {
        $argList.Add("--permission-mode")
        $argList.Add($PermissionMode)
    }
    $argList.Add("--approval-policy")
    $argList.Add("never")
    if (-not $NewSession -and -not [string]::IsNullOrWhiteSpace($usedSession)) {
        Write-Host "[dsh-review] 复用工作区已有会话 ($Repo): $usedSession" -ForegroundColor Green
        $argList.Add("--session-id")
        $argList.Add($usedSession)
    } else {
        Write-Host "[dsh-review] 启动全新 DSH 会话 ($Repo · Round $Round)..." -ForegroundColor Cyan
    }
    foreach ($extraDir in $AddDirs) {
        if (-not [string]::IsNullOrWhiteSpace($extraDir) -and (Test-Path $extraDir)) {
            $argList.Add("--add-dir")
            $argList.Add([System.IO.Path]::GetFullPath($extraDir))
        }
    }
    $argList.Add("-")

    $joinedArgs = ($argList | ForEach-Object { Escape-ProcessArg $_ }) -join " "

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $dshCli
    $psi.Arguments = $joinedArgs
    $psi.WorkingDirectory = $resolvedWorkspace
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.StandardOutputEncoding = $Utf8NoBom
    $psi.StandardErrorEncoding = $Utf8NoBom

    $stderrSb = New-Object System.Text.StringBuilder
    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi

    $errEvent = Register-ObjectEvent -InputObject $proc -EventName ErrorDataReceived -Action {
        if ($null -ne $EventArgs.Data) {
            [void]$Event.MessageData.AppendLine($EventArgs.Data)
        }
    } -MessageData $stderrSb

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        [void]$proc.Start()
        $proc.BeginErrorReadLine()
        $stdinWriter = New-Object System.IO.StreamWriter($proc.StandardInput.BaseStream, $Utf8NoBom)
        $stdinWriter.Write($promptText)
        $stdinWriter.Flush()
        $stdinWriter.Close()

        $stdoutText = $proc.StandardOutput.ReadToEnd()
        $proc.WaitForExit()
        $sw.Stop()
        $exitCode = $proc.ExitCode
        $durationSec = [Math]::Round($sw.Elapsed.TotalSeconds, 1)
    } finally {
        if ($errEvent) {
            Unregister-Event -SourceIdentifier $errEvent.Name -ErrorAction SilentlyContinue
            Remove-Job -Id $errEvent.Id -Force -ErrorAction SilentlyContinue
        }
        if ($proc) { $proc.Dispose() }
    }

    $reportBody = Clean-DshOutput -RawText $stdoutText
    if ([string]::IsNullOrWhiteSpace($reportBody)) {
        $errSummary = ($stderrSb.ToString().Trim())
        if ($errSummary.Length -gt 2000) {
            $errSummary = $errSummary.Substring($errSummary.Length - 2000)
        }
        $reportBody = "## DSH 执行异常 (ExitCode=$exitCode)`n`n未能从 stdout 获取审查结论，stderr 尾部摘要如下：`n`n``````text`n$errSummary`n``````"
    }

    if ([string]::IsNullOrWhiteSpace($usedSession)) {
        $usedSession = Find-LatestDshSession -WorkspacePath $resolvedWorkspace
    }

    if (-not $KeepPromptFile -and ($PromptFile -match '[\\/]logs[\\/]dsh_prompt')) {
        Remove-Item -Path $PromptFile -Force -ErrorAction SilentlyContinue
    }
}

$verdict = Resolve-DshVerdict -BodyText $reportBody -ExitCode $exitCode -Override $VerdictOverride
$summaryText = Extract-Summary -BodyText $reportBody -FallbackVerdict $verdict

$nowDto = if (-not [string]::IsNullOrWhiteSpace($TimestampOverride)) {
    [DateTimeOffset]::Parse($TimestampOverride)
} else {
    [DateTimeOffset]::Now
}
$stampForId = $nowDto.ToString("yyyyMMdd-HHmmss")
$isoTimestamp = $nowDto.ToString("yyyy-MM-ddTHH:mm:sszzz")
$repoSlug = ([regex]::Replace($Repo.ToLowerInvariant(), '[^a-z0-9\-_]+', '-')).Trim('-')
if (-not $repoSlug) { $repoSlug = "workspace" }

$repoReviewsDir = Join-Path $reviewsDir $repoSlug
if (-not (Test-Path $repoReviewsDir)) {
    New-Item -ItemType Directory -Path $repoReviewsDir -Force | Out-Null
}

$archiveId = "$stampForId-$repoSlug-r$Round"
$archiveFileName = "$archiveId.md"
$archivePath = Join-Path $repoReviewsDir $archiveFileName
$archiveRelPath = "reviews/$repoSlug/$archiveFileName"

$yamlHeader = @"
---
id: $archiveId
timestamp: $isoTimestamp
repo: $(Sanitize-YamlScalar $Repo)
workspace: $(Sanitize-YamlScalar $resolvedWorkspace)
round: $Round
verdict: $verdict
title: $(Sanitize-YamlScalar $Title)
session_id: $(Sanitize-YamlScalar $usedSession)
duration_sec: $durationSec
summary: $(Sanitize-YamlScalar $summaryText)
---

"@

$fullArchiveContent = $yamlHeader + $reportBody + "`n"
[System.IO.File]::WriteAllText($archivePath, $fullArchiveContent, $Utf8NoBom)

if (-not [string]::IsNullOrWhiteSpace($OutputFile)) {
    $outParent = Split-Path -Parent $OutputFile
    if ($outParent -and -not (Test-Path $outParent)) {
        New-Item -ItemType Directory -Path $outParent -Force | Out-Null
    }
    [System.IO.File]::WriteAllText($OutputFile, $reportBody + "`n", $Utf8NoBom)
}

$resultPayload = [ordered]@{
    ok               = ($verdict -ne "ERROR")
    id               = $archiveId
    verdict          = $verdict
    repo             = $Repo
    workspace        = $resolvedWorkspace
    round            = $Round
    title            = $Title
    timestamp        = $isoTimestamp
    session_id       = $usedSession
    duration_sec     = $durationSec
    summary          = $summaryText
    archive_path     = $archivePath
    archive_rel_path = $archiveRelPath
    output_file      = $OutputFile
}

Write-Output ($resultPayload | ConvertTo-Json -Depth 4)
if ($verdict -eq "ERROR") {
    exit 1
}
