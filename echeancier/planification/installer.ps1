<#
.SYNOPSIS
Installe la verification automatique des echeances dans le Planificateur de
taches de Windows (tache utilisateur, sans droits administrateur).

.EXAMPLE
powershell -ExecutionPolicy Bypass -File .\installer.ps1
powershell -ExecutionPolicy Bypass -File .\installer.ps1 -Heure 09:00
#>
param(
    [string]$Heure = "08:30",
    [string]$NomTache = "Echeancier"
)

$ErrorActionPreference = "Stop"
$racine = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

# pythonw.exe : execute la verification sans faire clignoter de fenetre noire.
$candidats = @(
    (Join-Path $racine "venv\Scripts\pythonw.exe"),
    (Join-Path (Split-Path -Parent $racine) "venv\Scripts\pythonw.exe")
)
$python = $candidats | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $python) {
    $commande = Get-Command pythonw.exe -ErrorAction SilentlyContinue
    if ($commande) { $python = $commande.Source }
}
if (-not $python) {
    throw "pythonw.exe introuvable. Installez Python 3.11+ (python.org, en cochant `"Add python.exe to PATH`") puis relancez."
}

$action = New-ScheduledTaskAction -Execute $python `
    -Argument "-m echeancier verifier --silencieux" -WorkingDirectory $racine

$declencheurs = @(
    (New-ScheduledTaskTrigger -Daily -At $Heure),
    (New-ScheduledTaskTrigger -AtLogOn)
)
$declencheurs[1].Delay = "PT2M"

# LogonType Interactive : la tache tourne dans la session ouverte, condition
# indispensable pour que la bulle de notification s'affiche.
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive -RunLevel Limited

$reglages = New-ScheduledTaskSettingsSet -StartWhenAvailable `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

Register-ScheduledTask -TaskName $NomTache -Action $action -Trigger $declencheurs `
    -Principal $principal -Settings $reglages `
    -Description "Previent avant les dates limites du classeur de suivi." -Force | Out-Null

Write-Host "Tache planifiee `"$NomTache`" installee : tous les jours a $Heure, et 2 min apres l'ouverture de session."
Write-Host ""
Write-Host "Essai immediat    : Start-ScheduledTask -TaskName $NomTache"
Write-Host "Etat / historique  : Get-ScheduledTaskInfo -TaskName $NomTache"
Write-Host "Desinstaller       : Unregister-ScheduledTask -TaskName $NomTache -Confirm:`$false"
