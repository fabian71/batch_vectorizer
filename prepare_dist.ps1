$distDir = "Batch_Vectorizer_Dist"

# Remove existing dist directory if it exists
if (Test-Path $distDir) {
    Remove-Item -Path $distDir -Recurse -Force
}

# Create dist directory
New-Item -ItemType Directory -Path $distDir | Out-Null

Write-Host "`n========================================" -ForegroundColor Yellow
Write-Host "⚠️  VERIFICAÇÃO DE DEV_MODE" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Check if DEV_MODE is enabled in popup.js
$popupContent = Get-Content "popup.js" -Raw
if ($popupContent -match "const\s+DEV_MODE\s*=\s*true") {
    Write-Host "`n❌ ATENÇÃO: DEV_MODE está ATIVADO em popup.js!" -ForegroundColor Red
    Write-Host "   Isso vai permitir uso sem licença na versão distribuída!" -ForegroundColor Red
    Write-Host "`n   Por favor, altere para: const DEV_MODE = false" -ForegroundColor Yellow
    Write-Host "`n   Arquivo: popup.js (próximo à linha 147)`n" -ForegroundColor Cyan
    
    $continue = Read-Host "Deseja continuar mesmo assim? (s/N)"
    if ($continue -ne "s" -and $continue -ne "S") {
        Write-Host "`nBuild cancelado. Corrija o DEV_MODE e tente novamente." -ForegroundColor Yellow
        exit 1
    }
    Write-Host "`n⚠️  Continuando com DEV_MODE ativado (NÃO RECOMENDADO)...`n" -ForegroundColor Red
}
else {
    Write-Host "`n✅ DEV_MODE está desativado - OK para produção`n" -ForegroundColor Green
}

Write-Host "Iniciando processo de build e ofuscação..." -ForegroundColor Cyan

# Files/Folders to copy directly (skip obfuscation)
$filesToCopy = @(
    "manifest.json",
    "popup.html",
    "icons",
    "assets",
    "locales.js",
    "content.js",
    "INSTALLATION.md",
    "README.md"
)

foreach ($item in $filesToCopy) {
    if (Test-Path $item) {
        Copy-Item -Path $item -Destination $distDir -Recurse
        Write-Host "Copiado: $item" -ForegroundColor Green
    }
    else {
        Write-Host "Aviso: Item não encontrado - $item" -ForegroundColor Yellow
    }
}

# Obfuscator executable path
$obfuscator = ".\node_modules\.bin\javascript-obfuscator.cmd"

# --- Background (Service Worker) - High Protection ---
if (Test-Path "background.js") {
    $file = "background.js"
    Write-Host "Ofuscando (Service Worker - High Protection): $file" -ForegroundColor Magenta
    $outputFile = Join-Path $distDir $file
    
    # Use 'service-worker' target to avoid 'window is not defined' error
    # Still allows high protection settings
    $cmd = "& '$obfuscator' '$file' --output '$outputFile' --compact true --control-flow-flattening true --control-flow-flattening-threshold 0.75 --dead-code-injection false --debug-protection false --disable-console-output true --identifier-names-generator hexadecimal --log false --rename-globals false --self-defending false --string-array true --string-array-encoding rc4 --string-array-threshold 0.75 --target service-worker"
    
    Invoke-Expression $cmd
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Sucesso: $file ofuscado." -ForegroundColor Green
    }
    else {
        Write-Host "ERRO ao ofuscar $file" -ForegroundColor Red
    }
}

# --- Popup (Browser UI) - High Protection ---
if (Test-Path "popup.js") {
    $file = "popup.js"
    Write-Host "Ofuscando (Popup - High Protection): $file" -ForegroundColor Magenta
    $outputFile = Join-Path $distDir $file
    
    # Use 'browser' target for UI scripts
    $cmd = "& '$obfuscator' '$file' --output '$outputFile' --compact true --control-flow-flattening true --control-flow-flattening-threshold 0.75 --dead-code-injection false --debug-protection false --disable-console-output true --identifier-names-generator hexadecimal --log false --rename-globals false --self-defending false --string-array true --string-array-encoding rc4 --string-array-threshold 0.75 --target browser"
    
    Invoke-Expression $cmd
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Sucesso: $file ofuscado." -ForegroundColor Green
    }
    else {
        Write-Host "ERRO ao ofuscar $file" -ForegroundColor Red
    }
}

Write-Host "Build concluído! A pasta de distribuição está em: $distDir" -ForegroundColor Cyan

# Read version from manifest.json
$manifestPath = Join-Path $distDir "manifest.json"
$manifestContent = Get-Content $manifestPath -Raw | ConvertFrom-Json
$version = $manifestContent.version

# Create ZIP file with version
$zipFile = "Batch_Vectorizer_Dist_$version.zip"
if (Test-Path $zipFile) {
    Remove-Item -Path $zipFile -Force
}

Write-Host "Criando arquivo ZIP (versão $version)..." -ForegroundColor Cyan
Compress-Archive -Path "$distDir\*" -DestinationPath $zipFile -Force

if (Test-Path $zipFile) {
    Write-Host "Arquivo ZIP criado com sucesso: $zipFile" -ForegroundColor Green
    Write-Host "`n========================================" -ForegroundColor Yellow
    Write-Host "✅ BUILD COMPLETO - Versão $version" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host "📦 Arquivo: $zipFile" -ForegroundColor Cyan
    Write-Host "📁 Pasta: $distDir" -ForegroundColor Cyan
}
else {
    Write-Host "ERRO ao criar arquivo ZIP" -ForegroundColor Red
}

