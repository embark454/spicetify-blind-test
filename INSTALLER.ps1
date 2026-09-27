$ErrorActionPreference = 'Stop'
$taskSpicetify = (Get-Command spicetify -ErrorAction Stop).Source
$taskSource = $PSScriptRoot
$taskConfigRoot = Join-Path $env:APPDATA 'spicetify'
$taskDestination = Join-Path $taskConfigRoot 'CustomApps\blind-test'
$taskFiles = @('index.js','manifest.json','style.css','core.js','spotify.js','storage.js','launcher.js','app.js')
# Validate the complete source before backing up or changing an installed app.
foreach ($taskFile in $taskFiles) {
  if (-not (Test-Path -LiteralPath (Join-Path $taskSource $taskFile) -PathType Leaf)) {
    throw ('Incomplete Blind Test package: missing ' + $taskFile + '. Extract the full release ZIP and try again.')
  }
}
$taskBackupRoot = Join-Path $taskSource ('sauvegardes\' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
New-Item -ItemType Directory -Path $taskBackupRoot -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $taskConfigRoot 'config-xpui.ini') -Destination (Join-Path $taskBackupRoot 'config-xpui.ini')
if (Test-Path -LiteralPath $taskDestination) { Copy-Item -LiteralPath $taskDestination -Destination (Join-Path $taskBackupRoot 'blind-test') -Recurse }
New-Item -ItemType Directory -Path $taskDestination -Force | Out-Null
foreach ($taskFile in $taskFiles) {
  Copy-Item -LiteralPath (Join-Path $taskSource $taskFile) -Destination (Join-Path $taskDestination $taskFile) -Force
}
& $taskSpicetify config custom_apps blind-test
if ($LASTEXITCODE -ne 0) { throw 'Could not configure Spicetify. Backup: ' + $taskBackupRoot }
& $taskSpicetify apply
if ($LASTEXITCODE -ne 0) { throw 'Could not apply Spicetify changes. Backup: ' + $taskBackupRoot }
Write-Output 'Blind Test installed. Open Blind Test in the Spotify sidebar.'
Write-Output ('Backup: ' + $taskBackupRoot)
