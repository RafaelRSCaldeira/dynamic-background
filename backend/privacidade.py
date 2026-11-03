"""Detecta quando OUTRO aplicativo está usando o microfone (Teams, Zoom, Meet...).

O Windows registra o uso do microfone por app em:
HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone
Um app está usando o mic agora quando LastUsedTimeStart > 0 e LastUsedTimeStop == 0.
"""
from __future__ import annotations

import asyncio
import logging
import sys

from .sala import Sala

log = logging.getLogger("privacidade")

BASE = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone"
IGNORAR = ("python",)  # o próprio painel
NOMES = {
    "msteams": "Teams", "ms-teams": "Teams", "microsoftteams": "Teams", "teams": "Teams",
    "zoom": "Zoom", "msedge": "Edge", "chrome": "Chrome", "firefox": "Firefox",
    "discord": "Discord", "slack": "Slack", "whatsapp": "WhatsApp", "obs64": "OBS",
}


def _nome_amigavel(chave: str) -> str:
    nome = chave.split("#")[-1] if "#" in chave else chave.split("_")[0]
    nome = nome.removesuffix(".exe").removesuffix(".EXE")
    simples = nome.lower().split(".")[-1]
    return NOMES.get(nome.lower(), NOMES.get(simples, nome))


def apps_usando_microfone() -> list[str]:
    if sys.platform != "win32":
        return []
    import winreg

    encontrados: list[str] = []

    def subchaves(caminho: str) -> list[str]:
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, caminho) as k:
                n = winreg.QueryInfoKey(k)[0]
                return [winreg.EnumKey(k, i) for i in range(n)]
        except OSError:
            return []

    def verificar(caminho: str, chave: str) -> None:
        if any(i in chave.lower() for i in IGNORAR):
            return
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, caminho) as k:
                inicio, _ = winreg.QueryValueEx(k, "LastUsedTimeStart")
                fim, _ = winreg.QueryValueEx(k, "LastUsedTimeStop")
        except OSError:
            return
        if inicio and fim == 0:
            encontrados.append(_nome_amigavel(chave))

    for sub in subchaves(BASE):
        if sub == "NonPackaged":
            for app in subchaves(BASE + r"\NonPackaged"):
                verificar(BASE + r"\NonPackaged" + "\\" + app, app)
        else:
            verificar(BASE + "\\" + sub, sub)
    return sorted(set(encontrados))


async def vigiar(sala: Sala, intervalo: float = 2.0) -> None:
    loop = asyncio.get_running_loop()
    while True:
        try:
            apps = await loop.run_in_executor(None, apps_usando_microfone)
        except Exception as e:  # noqa: BLE001
            log.debug("Falha ao consultar o registro: %s", e)
            apps = []
        if apps:
            sala.definir_auto(True, f"{', '.join(apps)} usando o microfone")
        else:
            sala.definir_auto(False, "")
        await asyncio.sleep(intervalo)
