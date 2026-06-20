# Sync source edits to C:\wc and refresh the EAS lockfile.
# EAS runs `npm ci --include=dev` — it does NOT install packages one-by-one like Expo Go.
# Always keep package-lock.json in sync with package.json before `eas build`.

$ErrorActionPreference = "Stop"
$src = Join-Path $PSScriptRoot ".."
$dst = "C:\wc"

$exclude = @(
  "node_modules",
  ".expo",
  "android\build",
  "android\.gradle",
  "ios\build",
  "ios\Pods",
  "pnpm-lock.yaml",
  ".pnpm-store"
)

Write-Host "Syncing frontend -> C:\wc (excluding build artifacts)..."

robocopy $src $dst /MIR /XD node_modules .expo android\build android\.gradle ios\build ios\Pods /XF pnpm-lock.yaml /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit $LASTEXITCODE" }

Push-Location $dst
try {
  Write-Host "Regenerating package-lock.json..."
  Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
  npm install --include=dev
  Write-Host "Verifying EAS install step..."
  npm ci --include=dev
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed — fix package.json before eas build" }
  Write-Host "Copying lockfile back to source..."
  Copy-Item package-lock.json (Join-Path $src "package-lock.json") -Force
  Write-Host "Done. Run: cd C:\wc; eas build --platform android --profile preview"
}
finally {
  Pop-Location
}
