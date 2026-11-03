param([int]$Port = 49790)

# 本地试用：桌宠卧室 v2.3.4
#
# 用法：
#   .\start-trial.ps1            # 起在 49790
#   .\start-trial.ps1 -Port 49820
#
# 用独立 profile（bedroom-trial）启动一个 DSH Web 实例，只装 dsh-pet + dsh-pet-bedroom，
# 不碰日常用的 desktop profile。改插件源码不影响这个实例（它装的是 Release 包）。

$ErrorActionPreference = 'Stop'
$profileName = 'bedroom-trial'
$dir = Join-Path $HOME ".dsh/profiles/$profileName"
$tgz = Join-Path $dir 'vendor/dsh-pet-bedroom.tgz'
$petLink = "link:$HOME/.dsh/profiles/desktop/node_modules/dsh-pet"

if (-not (Test-Path (Join-Path $dir 'package.json'))) {
    Write-Host '试用 profile 不存在，正在创建…' -ForegroundColor Yellow
    dsh --profile $profileName --from-default-profile web --dump-config | Out-Null
    if (-not (Test-Path $tgz)) {
        throw "缺少预构建包：$tgz（先从 Release 下载 dsh-pet-bedroom.tgz 放到这里）"
    }
    dsh plugin --profile $profileName add $tgz
    dsh plugin --profile $profileName add $petLink
}

Write-Host ''
Write-Host "启动试用实例（端口 $Port）…" -ForegroundColor Cyan
Write-Host '启动后终端会打印一个带 token 的地址，在浏览器打开它就是卧室。' -ForegroundColor Gray
Write-Host '卧室路径：/dsh-pet-bedroom/' -ForegroundColor Gray
Write-Host ''

dsh --profile $profileName --port $Port --no-open
