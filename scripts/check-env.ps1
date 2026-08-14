$ErrorActionPreference = "SilentlyContinue"

Write-Host "Nihongo Whisper environment check"
Write-Host "Project: $PSScriptRoot\.."
Write-Host ""

$node = node --version
$npm = npm --version
$ollama = ollama --version
$bundledOllama = Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..")) "resources\ollama\standalone\ollama.exe"
if (-not $ollama -and (Test-Path $bundledOllama)) {
  $ollama = & $bundledOllama --version
}
$cmake = cmake --version | Select-Object -First 1

if (-not $node) { $node = 'not found' }
if (-not $npm) { $npm = 'not found' }
if (-not $ollama) { $ollama = 'not found' }
if (-not $cmake) { $cmake = 'not found' }

Write-Host "Node:   $node"
Write-Host "npm:    $npm"
Write-Host "Ollama: $ollama"
Write-Host "CMake:  $cmake"
Write-Host ""

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$whisperStream = Join-Path $root "resources\whisper-bin\whisper-stream.exe"
$whisperStreamRelease = Join-Path $root "resources\whisper-bin\Release\whisper-stream.exe"
$model = Join-Path $root "resources\models\ggml-base.bin"
$smallModel = Join-Path $root "resources\models\ggml-small.bin"
$ollamaModels = Join-Path $root "resources\ollama\models"
$qwenManifest = Join-Path $ollamaModels "manifests\registry.ollama.ai\library\qwen3\1.7b"

if ((Test-Path $whisperStream) -or (Test-Path $whisperStreamRelease)) { $whisperStatus = 'found' } else { $whisperStatus = 'missing' }
if (Test-Path $model) { $modelStatus = 'found' } else { $modelStatus = 'missing' }
if (Test-Path $smallModel) { $smallModelStatus = 'found' } else { $smallModelStatus = 'missing' }
if (Test-Path $ollamaModels) { $ollamaModelStatus = 'found' } else { $ollamaModelStatus = 'missing' }
if (Test-Path $qwenManifest) { $qwenStatus = 'found' } else { $qwenStatus = 'missing' }

Write-Host "whisper-stream.exe: $whisperStatus"
Write-Host "ggml-base.bin:       $modelStatus"
Write-Host "ggml-small.bin:      $smallModelStatus"
Write-Host "Ollama model store:  $ollamaModelStatus"
Write-Host "qwen3:1.7b:         $qwenStatus"
Write-Host ""
if ($whisperStatus -eq 'found' -and $modelStatus -eq 'found' -and $ollamaModelStatus -eq 'found' -and $qwenStatus -eq 'found') {
  Write-Host "Ready: local transcription and offline translation resources are available."
} else {
  Write-Host "Next: complete missing resources before end-to-end testing."
}
