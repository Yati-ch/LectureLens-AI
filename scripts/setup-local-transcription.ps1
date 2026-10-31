$ErrorActionPreference = "Stop"

Write-Host "Checking Python..." -ForegroundColor Cyan
$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
if ($pythonCommand) {
    python --version
    python -m pip install --upgrade pip
    python -m pip install -r requirements-local.txt
} else {
    $pyCommand = Get-Command py -ErrorAction SilentlyContinue
    if (-not $pyCommand) {
        throw "Python 3.9+ was not found. Install Python from https://www.python.org/downloads/windows/ and enable 'Add python.exe to PATH', then rerun this script."
    }
    py -3 --version
    py -3 -m pip install --upgrade pip
    py -3 -m pip install -r requirements-local.txt
    Write-Host "Python launcher detected. LectureLens automatically falls back to the py -3 launcher if python.exe is not on PATH." -ForegroundColor Yellow
}

Write-Host "Local transcription and visual slide-matching dependencies installed." -ForegroundColor Green
Write-Host "Video slide matching uses FFmpeg and Pillow; slide matches are reported only when the visual similarity is strong.
The first transcription downloads the Whisper 'base' model. Internet is needed once; later transcription runs locally on the computer hosting this LectureLens server." -ForegroundColor Yellow
