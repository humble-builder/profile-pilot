param([switch]$Dev)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$dockerDesktopCli = Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\resources\bin\docker.exe"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js 24 or newer is required when running the installer from source."
}

if (Test-Path $dockerDesktopCli) {
    $env:PROFILEPILOT_DOCKER = $dockerDesktopCli
}

$arguments = @((Join-Path $projectRoot "installer\src\cli.mjs"))
if ($Dev) { $arguments += "--dev" }

& node @arguments
exit $LASTEXITCODE
