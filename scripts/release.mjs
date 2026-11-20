#!/usr/bin/env node
/**
 * a8-devtools 统一发布构建与打包脚本 (Release Pipeline)
 *
 * 完整流程：
 *   1. 仓库规范与静态门禁检查（Lints）
 *   2. 前端生产构建（modules/devtools/web -> modules/devtools/ui）
 *   3. Rust Workspace 单元测试（cargo test --workspace）
 *   4. Rust Workspace Release 编译（a8-devtools.exe / cowfs.exe / cowlink_overlay.dll）
 *   5. 产物归档至 dist/a8-devtools-v<version>-win-x64/，生成 SHA256SUMS.txt 与 .zip 便携包
 *
 * 用法：
 *   node scripts/release.mjs [options]
 *   release.bat [options]
 *
 * 选项：
 *   --skip-checks   跳过仓库 lints 与 cargo test（快速构建）
 *   --skip-tests    仅跳过 cargo test --workspace
 *   --skip-web      跳过前端 npm run build
 *   --no-zip        不生成 .zip 压缩包（仅保留目录与 SHA256SUMS.txt）
 *   --restart       编译前自动结束正在运行的 a8-devtools.exe，编译完成后重新启动
 *   --dry-run       仅打印将执行的步骤，不实际运行
 *   -h, --help      显示帮助信息
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const WEB_DIR = path.join(REPO_ROOT, 'modules', 'devtools', 'web');
const TAURI_CONF_PATH = path.join(REPO_ROOT, 'modules', 'devtools', 'tauri.conf.json');
const TARGET_RELEASE_DIR = path.join(REPO_ROOT, 'target', 'release');
const DIST_ROOT = path.join(REPO_ROOT, 'dist');

function parseArgs(argv) {
  const opts = {
    skipChecks: false,
    skipTests: false,
    skipWeb: false,
    noZip: false,
    restart: false,
    dryRun: false,
    help: false,
  };
  for (const arg of argv) {
    if (arg === '--skip-checks') opts.skipChecks = true;
    else if (arg === '--skip-tests') opts.skipTests = true;
    else if (arg === '--skip-web') opts.skipWeb = true;
    else if (arg === '--no-zip') opts.noZip = true;
    else if (arg === '--restart') opts.restart = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '-h' || arg === '--help') opts.help = true;
    else {
      throw new Error(`未知参数: ${arg}（使用 --help 查看支持的选项）`);
    }
  }
  return opts;
}

function printHelp() {
  console.log(`
a8-devtools 发布构建脚本

用法:
  release.bat [选项]
  node scripts/release.mjs [选项]

选项:
  --skip-checks   跳过 lints 与 cargo test（极速打包）
  --skip-tests    仅跳过 cargo test --workspace
  --skip-web      跳过前端 npm run build
  --no-zip        跳过生成 .zip 压缩包
  --restart       构建前停止运行中的 a8-devtools.exe，构建后自动启动新版
  --dry-run       仅展示发布计划，不执行构建
  -h, --help      显示此帮助
`.trim());
}

function formatDuration(ms) {
  const secs = ms / 1000;
  return secs >= 60
    ? `${Math.floor(secs / 60)}m ${(secs % 60).toFixed(1)}s`
    : `${secs.toFixed(1)}s`;
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function runStep(label, command, args, cwd, dryRun) {
  const cmdStr = `${command} ${args.join(' ')}`.trim();
  console.log(`\n==> ${label}`);
  console.log(`    $ ${cmdStr}`);
  if (dryRun) {
    console.log('    [dry-run] 已跳过执行');
    return;
  }
  const started = Date.now();
  const useShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
  const res = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: useShell,
  });
  if (res.error) {
    throw new Error(`${label} 启动失败: ${res.error.message}`);
  }
  if (res.status !== 0) {
    throw new Error(`${label} 失败（退出码 ${res.status}）`);
  }
  console.log(`    [OK] 完成 (${formatDuration(Date.now() - started)})`);
}

function readVersion() {
  const raw = fs.readFileSync(TAURI_CONF_PATH, 'utf8');
  const conf = JSON.parse(raw);
  return String(conf.version || '0.1.0').trim();
}

function isProcessRunning(imageName) {
  if (process.platform !== 'win32') return false;
  const res = spawnSync('tasklist', ['/FI', `IMAGENAME eq ${imageName}`, '/NH'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (res.status !== 0 || !res.stdout) return false;
  return res.stdout.toLowerCase().includes(imageName.toLowerCase());
}

function stopRunningDevtools(dryRun) {
  if (!isProcessRunning('a8-devtools.exe')) return false;
  console.log('\n==> 停止运行中的 a8-devtools.exe（释放 target/release/a8-devtools.exe 文件锁）');
  if (dryRun) {
    console.log('    [dry-run] 将执行 taskkill /F /IM a8-devtools.exe');
    return true;
  }
  const res = spawnSync('taskkill', ['/F', '/IM', 'a8-devtools.exe'], {
    stdio: 'inherit',
  });
  if (res.status !== 0) {
    throw new Error(`无法结束运行中的 a8-devtools.exe（退出码 ${res.status}），请先从系统托盘退出后重试`);
  }
  return true;
}

function isFileWriteLocked(filePath) {
  if (!fs.existsSync(filePath)) return false;
  let fd = null;
  try {
    fd = fs.openSync(filePath, 'r+');
    return false;
  } catch (err) {
    const code = err && typeof err === 'object' ? err.code : '';
    if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
      return true;
    }
    throw err;
  } finally {
    if (fd !== null) {
      fs.closeSync(fd);
    }
  }
}

function prepareOverlayDllForBuild(dryRun) {
  if (process.platform !== 'win32' || !fs.existsSync(TARGET_RELEASE_DIR)) return;

  // 顺手清理上次因 explorer.exe 占用而改名遗留的旧 DLL（若已无人占用则删除）
  for (const name of fs.readdirSync(TARGET_RELEASE_DIR)) {
    if (!name.startsWith('cowlink_overlay.dll.old.')) continue;
    const stalePath = path.join(TARGET_RELEASE_DIR, name);
    if (!isFileWriteLocked(stalePath) && !dryRun) {
      fs.rmSync(stalePath, { force: true });
    }
  }

  const dllPath = path.join(TARGET_RELEASE_DIR, 'cowlink_overlay.dll');
  if (!isFileWriteLocked(dllPath)) return;

  const backupPath = path.join(TARGET_RELEASE_DIR, `cowlink_overlay.dll.old.${Date.now()}`);
  console.log('\n==> 检测到 cowlink_overlay.dll 正被资源管理器 (explorer.exe) 占用，执行热改名避让');
  console.log(`    ${dllPath} -> ${path.basename(backupPath)}`);
  if (dryRun) {
    console.log('    [dry-run] 已跳过改名');
    return;
  }
  fs.renameSync(dllPath, backupPath);
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function copyIfExists(src, dest) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return true;
}

function stageDistPackage(version, opts) {
  const pkgName = `a8-devtools-v${version}-win-x64`;
  const stageDir = path.join(DIST_ROOT, pkgName);
  const zipPath = path.join(DIST_ROOT, `${pkgName}.zip`);

  console.log(`\n==> 归档发布包: dist/${pkgName}/`);
  if (opts.dryRun) {
    console.log(`    [dry-run] 将复制二进制产物、驱动脚本与文档至 ${stageDir}`);
    if (!opts.noZip) console.log(`    [dry-run] 将打包压缩至 ${zipPath}`);
    return { stageDir, zipPath: opts.noZip ? null : zipPath, manifest: [] };
  }

  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });

  const requiredBins = [
    'a8-devtools.exe',
    'cowfs.exe',
    'cowlink_overlay.dll',
  ];

  const manifest = [];
  for (const bin of requiredBins) {
    const src = path.join(TARGET_RELEASE_DIR, bin);
    if (!fs.existsSync(src)) {
      throw new Error(`缺少构建产物: ${src}`);
    }
    const dest = path.join(stageDir, bin);
    fs.copyFileSync(src, dest);
    manifest.push({
      rel: bin,
      size: fs.statSync(dest).size,
      sha256: sha256File(dest),
    });
  }

  // 附带驱动安装脚本与文档（如存在）
  const optionalFiles = [
    ['README.md', 'README.md'],
    ['LICENSE', 'LICENSE'],
    ['scripts/install_driver.bat', 'scripts/install_driver.bat'],
    ['scripts/install_driver.ps1', 'scripts/install_driver.ps1'],
    ['scripts/winfsp-2.1.25156.msi', 'scripts/winfsp-2.1.25156.msi'],
  ];
  for (const [srcRel, destRel] of optionalFiles) {
    const dest = path.join(stageDir, destRel);
    if (copyIfExists(path.join(REPO_ROOT, srcRel), dest)) {
      manifest.push({
        rel: destRel,
        size: fs.statSync(dest).size,
        sha256: sha256File(dest),
      });
    }
  }

  const sumsContent =
    manifest.map((item) => `${item.sha256}  ${item.rel}`).join('\n') + '\n';
  fs.writeFileSync(path.join(stageDir, 'SHA256SUMS.txt'), sumsContent, 'utf8');

  let finalZip = null;
  if (!opts.noZip) {
    if (fs.existsSync(zipPath)) fs.rmSync(zipPath, { force: true });
    runStep(
      `生成便携压缩包 (${pkgName}.zip)`,
      'tar',
      ['-a', '-c', '-f', zipPath, '-C', DIST_ROOT, pkgName],
      REPO_ROOT,
      false
    );
    finalZip = zipPath;
  }

  return { stageDir, zipPath: finalZip, manifest };
}

function launchDevtools(dryRun) {
  const exePath = path.join(TARGET_RELEASE_DIR, 'a8-devtools.exe');
  console.log(`\n==> 启动新版工作台: ${exePath}`);
  if (dryRun) {
    console.log('    [dry-run] 已跳过启动');
    return;
  }
  const child = spawn(exePath, [], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

function main() {
  const startedAt = Date.now();
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  const version = readVersion();
  console.log(`========================================================`);
  console.log(` a8-devtools Release Builder  v${version}`);
  console.log(` Workspace: ${REPO_ROOT}`);
  console.log(`========================================================`);

  // 1. Lints
  if (!opts.skipChecks) {
    runStep('门禁检查 1/4: 静态异常保留防线', 'node', ['scripts/lints/check_swallowed_exceptions.mjs'], REPO_ROOT, opts.dryRun);
    runStep('门禁检查 2/4: 仓库体积与脚本规范', 'node', ['scripts/lints/check_workspace_hygiene.mjs'], REPO_ROOT, opts.dryRun);
    runStep('门禁检查 3/4: 插件 Subagent Frontmatter', 'py', ['-3', 'scripts/lints/check_plugin_agents.py'], REPO_ROOT, opts.dryRun);
    runStep('门禁检查 4/4: Stop Hook 不变量', 'py', ['-3', 'scripts/lints/check_stop_hook_invariants.py'], REPO_ROOT, opts.dryRun);
  }

  // 2. Frontend build
  if (!opts.skipWeb) {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    runStep('前端生产构建 (tsc -b && vite build)', npmCmd, ['run', 'build'], WEB_DIR, opts.dryRun);
  }

  // 3. Rust tests
  if (!opts.skipChecks && !opts.skipTests) {
    runStep('Rust 工作空间单元测试', 'cargo', ['test', '--workspace'], REPO_ROOT, opts.dryRun);
  }

  // 4. Check/stop running exe, handle explorer.exe lock on cowlink_overlay.dll & Rust release build
  if (opts.restart) {
    stopRunningDevtools(opts.dryRun);
  } else if (!opts.dryRun && isProcessRunning('a8-devtools.exe')) {
    throw new Error(
      '检测到 a8-devtools.exe 正在运行，可能导致编译覆盖失败。请先退出托盘程序，或附加 --restart 参数自动重启构建。'
    );
  }

  prepareOverlayDllForBuild(opts.dryRun);
  runStep('Rust 工作空间 Release 编译', 'cargo', ['build', '--release', '--workspace'], REPO_ROOT, opts.dryRun);

  // 5. Stage dist package + checksums + zip
  const { stageDir, zipPath, manifest } = stageDistPackage(version, opts);

  if (opts.restart) {
    launchDevtools(opts.dryRun);
  }

  console.log(`\n========================================================`);
  console.log(` [SUCCESS] a8-devtools v${version} 发布构建完成 (${formatDuration(Date.now() - startedAt)})`);
  if (!opts.dryRun) {
    console.log(` 产物目录: ${stageDir}`);
    if (zipPath && fs.existsSync(zipPath)) {
      console.log(` 便携压缩包: ${zipPath} (${formatBytes(fs.statSync(zipPath).size)})`);
    }
    console.log(' 核心产物清单:');
    for (const item of manifest.filter((m) => /\.(exe|dll)$/i.test(m.rel))) {
      console.log(`   - ${item.rel.padEnd(22)} ${formatBytes(item.size).padStart(10)}  sha256:${item.sha256.slice(0, 12)}...`);
    }
  }
  console.log(`========================================================`);
}

try {
  main();
} catch (err) {
  console.error(`\n[FAIL] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
