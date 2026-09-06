param(
    [ValidateSet("start", "restart", "status", "logs", "stop")]
    [string]$Action = "start",
    [ValidateRange(10, 600)]
    [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot

function Invoke-Compose {
    param([string[]]$ComposeArguments)

    & docker compose @ComposeArguments
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose command failed: $($ComposeArguments -join ' ')"
    }
}

function Assert-PinnedOfficialImages {
    $allowedImagePattern = "^(ghcr\.io/humble-builder/profile-pilot-(backend|frontend)|mongo)@sha256:[0-9a-f]{64}$"
    $images = @(& docker compose config --images)
    if ($LASTEXITCODE -ne 0) {
        throw "Could not resolve Compose images"
    }

    foreach ($image in $images) {
        $resolvedImage = $image.Trim()
        if ($resolvedImage -notmatch $allowedImagePattern) {
            throw "Official startup requires an approved digest-pinned image: $resolvedImage"
        }
    }
}

function Wait-ForHealthyService {
    param(
        [string]$Service,
        [int]$WaitSeconds
    )

    $deadline = (Get-Date).AddSeconds($WaitSeconds)

    while ((Get-Date) -lt $deadline) {
        $containerId = [string](& docker compose ps -q $Service)
        $containerId = $containerId.Trim()
        if ($LASTEXITCODE -ne 0) {
            throw "Could not inspect $Service"
        }

        if ($containerId) {
            $health = [string](& docker inspect `
                --format "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}" `
                $containerId)
            $health = $health.Trim()

            if ($health -eq "healthy" -or $health -eq "running") {
                Write-Host "$Service is $health"
                return
            }

            if ($health -eq "unhealthy" -or $health -eq "exited" -or $health -eq "dead") {
                Invoke-Compose -ComposeArguments @("logs", "--tail", "100", $Service)
                throw "$Service entered state: $health"
            }
        }

        Start-Sleep -Seconds 2
    }

    Invoke-Compose -ComposeArguments @("logs", "--tail", "100", $Service)
    throw "Timed out waiting for $Service to become healthy"
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker CLI was not found. Install and start Docker Desktop first."
}

Push-Location $projectRoot
try {
    switch ($Action) {
        "start" {
            Invoke-Compose -ComposeArguments @("config", "--quiet")
            Assert-PinnedOfficialImages
            Invoke-Compose -ComposeArguments @("pull")
            Invoke-Compose -ComposeArguments @("up", "-d")
            Wait-ForHealthyService -Service "backend" -WaitSeconds $TimeoutSeconds
            Wait-ForHealthyService -Service "frontend" -WaitSeconds $TimeoutSeconds
            $publishedAddress = [string](& docker compose port frontend 3000)
            Write-Host "ProfilePilot is ready at http://$($publishedAddress.Trim())"
        }
        "restart" {
            Invoke-Compose -ComposeArguments @("config", "--quiet")
            Assert-PinnedOfficialImages
            Invoke-Compose -ComposeArguments @("pull")
            Invoke-Compose -ComposeArguments @(
                "up", "-d", "--force-recreate", "backend", "frontend"
            )
            Wait-ForHealthyService -Service "backend" -WaitSeconds $TimeoutSeconds
            Wait-ForHealthyService -Service "frontend" -WaitSeconds $TimeoutSeconds
            Write-Host "ProfilePilot restarted with the latest configuration."
        }
        "status" {
            Invoke-Compose -ComposeArguments @("ps")
        }
        "logs" {
            Invoke-Compose -ComposeArguments @("logs", "--tail", "200", "--follow")
        }
        "stop" {
            Invoke-Compose -ComposeArguments @("down")
            Write-Host "ProfilePilot stopped. MongoDB data remains in the named volume."
        }
    }
} finally {
    Pop-Location
}
