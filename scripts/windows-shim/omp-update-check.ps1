# Refreshes the cached count of upstream commits the flash-input branch is missing.
# Launched in the background by omp.cmd at most once a day.
$repo = 'C:\Users\nick\Documents\programming\omp-leap'
$cache = Join-Path $env:LOCALAPPDATA 'omp-leap-update.txt'
git -C $repo fetch upstream --quiet 2>$null
$count = git -C $repo rev-list --count 'flash-input..upstream/main' 2>$null
if ($LASTEXITCODE -eq 0 -and "$count" -match '^\d+$') {
	Set-Content -Path $cache -Value $count
}
