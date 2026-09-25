$ErrorActionPreference = 'Stop'
$taskSpicetify = (Get-Command spicetify -ErrorAction Stop).Source
$taskSource = $PSScriptRoot
$taskConfigRoot = Join-Path $env:APPDATA 'spicetify'
$taskDestination = Join-Path $taskConfigRoot 'CustomApps\blind-test'
$taskBackupRoot = Join-Path $taskSource ('sauvegardes\' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
New-Item -ItemType Directory -Path $taskBackupRoot -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $taskConfigRoot 'config-xpui.ini') -Destination (Join-Path $taskBackupRoot 'config-xpui.ini')
if (Test-Path -LiteralPath $taskDestination) { Copy-Item -LiteralPath $taskDestination -Destination (Join-Path $taskBackupRoot 'blind-test') -Recurse }
New-Item -ItemType Directory -Path $taskDestination -Force | Out-Null
foreach ($taskFile in @('index.js','manifest.json','style.css','core.js','spotify.js','storage.js','launcher.js','app.js')) {
  Copy-Item -LiteralPath (Join-Path $taskSource $taskFile) -Destination (Join-Path $taskDestination $taskFile) -Force
}
& $taskSpicetify config custom_apps blind-test
if ($LASTEXITCODE -ne 0) { throw 'Configuration Spicetify impossible. Sauvegarde : ' + $taskBackupRoot }
& $taskSpicetify apply
if ($LASTEXITCODE -ne 0) { throw 'Application Spicetify impossible. Sauvegarde : ' + $taskBackupRoot }
Write-Output 'Blind Test installe. Ouvre Blind Test dans la barre laterale Spotify.'
Write-Output ('Sauvegarde : ' + $taskBackupRoot)
