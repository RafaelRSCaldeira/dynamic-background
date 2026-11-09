"""Imagens geradas localmente para as cenas do Zak (ideias e atmosferas, quando não existe foto real).

O modelo roda num processo à parte (geracao_worker.py), aberto na primeira imagem pedida e fechado
depois de alguns minutos sem uso, para devolver a VRAM. As imagens ficam em cache por descrição.

[zak] imagem_modelo no config.toml:
- "auto": Z-Image-Turbo (Apache 2.0, pode ser usado na empresa) se houver PyTorch + GPU com ≥ 12 GB.
- "nenhum": desligado (as cenas abstratas ficam só com o fundo animado).
- qualquer id do Hugging Face compatível com diffusers (ex.: "black-forest-labs/FLUX.1-schnell").
"""
from __future__ import annotations

import asyncio
import hashlib
import importlib.util
import json
import logging
import subprocess
import sys
import time

from PIL import Image

from .config import RAIZ
from .imagens import CACHE, LARGURA, brilho, paleta

log = logging.getLogger("geracao")
LOG_WORKER = RAIZ / "logs" / "gerador-imagens.log"   # o que o processo do modelo escreve (erros da CUDA, do diffusers...)
PADRAO = "Tongyi-MAI/Z-Image-Turbo"
VRAM_MIN_GB = 12
OCIOSO_S = 10 * 60
ESTILO = ("{p}. Cinematic wide shot, rich deep colors, soft volumetric light, dark moody background, "
          "high detail, photographic quality, no text, no letters, no watermark, no logos")


def _fim_do_log() -> str:
    try:
        linhas = [l for l in LOG_WORKER.read_text(encoding="utf-8", errors="replace").splitlines() if l.strip()]
        return " | ".join(linhas[-3:])[-400:]
    except OSError:
        return ""


def _vram_gb() -> float:
    try:
        saida = subprocess.run(["nvidia-smi", "--query-gpu=memory.total", "--format=csv,noheader,nounits"],
                               capture_output=True, text=True, timeout=5, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return max(float(x) for x in saida.stdout.split()) / 1024
    except Exception:  # noqa: BLE001
        return 0.0


class Gerador:
    def __init__(self, cfg: dict) -> None:
        pedido = str(cfg.get("imagem_modelo") or "auto")
        self.modelo = ""
        self.estado, self.detalhe = "desligado", ""
        if pedido == "nenhum":
            self.detalhe = "desligado no config.toml"
        elif not (importlib.util.find_spec("torch") and importlib.util.find_spec("diffusers")):
            self.estado, self.detalhe = "indisponivel", "instale o requirements-imagem.txt (PyTorch + diffusers)"
        elif pedido == "auto" and (vram := _vram_gb()) < VRAM_MIN_GB:
            self.estado = "indisponivel"
            self.detalhe = f"precisa de GPU com ≥ {VRAM_MIN_GB} GB (esta tem {vram:.0f} GB)" if vram else "sem GPU NVIDIA"
        else:
            self.modelo = PADRAO if pedido == "auto" else pedido
            self.estado, self.detalhe = "pronto", self.modelo.split("/")[-1]
        self.caminho = ""   # pasta local do modelo (o processo carrega dela, sem consultar a internet)
        self._proc: asyncio.subprocess.Process | None = None
        self._trava = asyncio.Lock()
        self._usado = 0.0
        self._vigia: asyncio.Task | None = None
        self.ao_progresso = None   # fn(dict): a tela mostra "preparando" / "gerando · passo 3 de 9"

    def _avisar(self, estado: str, passo: int = 0, total: int = 0) -> None:
        if self.ao_progresso:
            try:
                self.ao_progresso({"estado": estado, "passo": passo, "total": total})
            except Exception:  # noqa: BLE001
                pass

    @property
    def disponivel(self) -> bool:
        return bool(self.modelo) and self.estado != "erro"

    async def preparar(self) -> None:
        """Na partida: baixa o modelo (vários GB, só na primeira vez) em segundo plano, sem ocupar a VRAM.
        Sem isso, a primeira cena que pede uma imagem ficava esperando o download inteiro."""
        log.info("Imagens: %s", self.detalhe if self.disponivel else f"{self.estado} ({self.detalhe})")
        if not self.disponivel:
            return
        self.estado, self.detalhe = "baixando", f"baixando {self.modelo.split('/')[-1]} (só na primeira vez)…"

        def baixar() -> str:
            from huggingface_hub import snapshot_download
            try:
                return snapshot_download(self.modelo)
            except Exception as e:  # noqa: BLE001
                # rede do escritório sem acesso ao Hugging Face (proxy, firewall, fora do ar): se o modelo já está
                # no disco, segue com ele — antes a geração ficava desligada a sessão inteira
                try:
                    caminho = snapshot_download(self.modelo, local_files_only=True)
                except Exception:  # noqa: BLE001
                    raise e from None
                log.info("Imagens: sem acesso ao Hugging Face (%s); usando o modelo já baixado", str(e)[:120])
                return caminho

        t0 = time.perf_counter()
        try:
            self.caminho = await asyncio.to_thread(baixar)
            self.estado, self.detalhe = "pronto", self.modelo.split("/")[-1]
            log.info("Modelo de imagens %s no disco (%.0fs)", self.modelo, time.perf_counter() - t0)
        except Exception as e:  # noqa: BLE001
            self.estado, self.detalhe = "erro", f"não foi possível baixar {self.modelo}: {e}"[:200]
            log.warning("Imagens: %s", self.detalhe)

    async def _abrir(self) -> None:
        if self._proc and self._proc.returncode is None:
            return
        self.estado, self.detalhe = "carregando", f"carregando {self.modelo.split('/')[-1]}…"
        self._avisar("carregando")
        log.info("Abrindo o gerador de imagens (%s)", self.modelo)
        LOG_WORKER.parent.mkdir(parents=True, exist_ok=True)
        erros = open(LOG_WORKER, "ab")   # sem isso, quando o processo morre não sobra pista nenhuma
        erros.write(f"\n=== {time.strftime('%Y-%m-%d %H:%M:%S')} {self.modelo}\n".encode())
        erros.flush()
        try:
            self._proc = await asyncio.create_subprocess_exec(
                sys.executable, "-u", "-m", "backend.geracao_worker", self.caminho or self.modelo, self.modelo, cwd=str(RAIZ),
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=erros,
                limit=1 << 20)
        finally:
            erros.close()   # o processo filho já tem a cópia dele
        while True:   # o primeiro carregamento pode baixar o modelo (vários GB): sem limite de tempo aqui
            linha = await self._proc.stdout.readline()
            if not linha:
                self.estado, self.detalhe = "erro", f"o gerador fechou ao carregar (veja {LOG_WORKER.name})"
                log.warning("Imagens: %s — %s", self.detalhe, _fim_do_log())
                raise RuntimeError(self.detalhe)
            try:
                msg = json.loads(linha)
            except json.JSONDecodeError:
                continue
            if "pronto" in msg:
                break
        if not msg.get("pronto"):
            self.estado, self.detalhe = "erro", msg.get("erro", "falhou")
            log.warning("Imagens: o modelo não carregou: %s", self.detalhe)
            raise RuntimeError(self.detalhe)
        self.estado = "pronto"
        self.detalhe = f"{self.modelo.split('/')[-1]} · {'GPU' if msg['modo'] == 'gpu' else 'GPU + RAM'}"
        log.info("Gerador pronto em %.0fs (%s, %.0f GB)", msg["s"], msg["modo"], msg["tamanho_gb"])
        if not self._vigia:
            self._vigia = asyncio.create_task(self._fechar_ocioso())

    async def _fechar_ocioso(self) -> None:
        while True:
            await asyncio.sleep(30)
            if self._proc and self._proc.returncode is None and time.time() - self._usado > OCIOSO_S and not self._trava.locked():
                log.info("Gerador de imagens parado há %d min: fechando para liberar a VRAM", OCIOSO_S // 60)
                self.fechar()

    def fechar(self) -> None:
        if self._proc and self._proc.returncode is None:
            try:
                self._proc.stdin.close()
                self._proc.kill()
            except Exception:  # noqa: BLE001
                pass
        self._proc = None
        if self.estado != "erro" and self.modelo:
            self.estado, self.detalhe = "pronto", self.modelo.split("/")[-1]

    async def gerar(self, descricao: str, semente: int | None = None) -> dict | None:
        """semente: outra variação da mesma descrição (a galeria de imagens geradas pede várias)."""
        descricao = " ".join(descricao.split())[:300]
        if not descricao or not self.disponivel or self.estado == "baixando":
            return None   # enquanto o modelo baixa, as cenas ficam com a foto ou o fundo animado
        variacao = f"|{semente}" if semente else ""
        chave = hashlib.sha1(f"gerar|{self.modelo}|{descricao.lower()}{variacao}".encode()).hexdigest()[:16]
        meta_arq = CACHE / f"{chave}.json"
        if meta_arq.exists():
            meta = json.loads(meta_arq.read_text(encoding="utf-8"))
            if (CACHE / meta["arquivo"]).exists():
                return meta
        async with self._trava:
            self._usado = time.time()
            try:
                await self._abrir()
            except Exception:
                self._avisar("erro")
                raise
            CACHE.mkdir(parents=True, exist_ok=True)
            bruta = CACHE / f"{chave}.png"
            self.estado = "gerando"
            self._avisar("gerando")
            t0 = time.perf_counter()
            self._proc.stdin.write((json.dumps({"prompt": ESTILO.format(p=descricao), "largura": 0, "altura": 0,
                                                "saida": str(bruta), "semente": int(chave[:6], 16)}) + "\n").encode())
            await self._proc.stdin.drain()
            limite = time.time() + 600
            resp: dict = {}
            while True:   # avisos de progresso ("passo") até a resposta final ("ok")
                try:
                    linha = await asyncio.wait_for(self._proc.stdout.readline(), max(1, limite - time.time()))
                except asyncio.TimeoutError:
                    linha = b""
                if not linha:
                    break
                try:
                    resp = json.loads(linha)
                except json.JSONDecodeError:
                    continue
                if "ok" in resp:
                    break
                if "passo" in resp:
                    self._avisar("gerando", int(resp["passo"]), int(resp.get("total") or 0))
            self._usado = time.time()
            self.estado = "pronto"
            self._avisar("pronto" if resp.get("ok") else "erro")
            if not resp.get("ok"):
                log.warning("geração falhou: %s", resp.get("erro") or f"o gerador parou de responder — {_fim_do_log()}")
                if not linha:
                    self.fechar()
                return None
        img = Image.open(bruta).convert("RGB")
        # ampliada para 4K: a imagem aparece suavizada pela máscara e pelo movimento lento, então não perde nada visível
        img = img.resize((LARGURA, round(LARGURA * img.height / img.width)), Image.LANCZOS)
        arquivo = f"{chave}.jpg"
        await asyncio.to_thread(img.save, CACHE / arquivo, "JPEG", quality=90, optimize=True, progressive=True)
        bruta.unlink(missing_ok=True)
        meta = {"consulta": descricao, "t": time.time(), "arquivo": arquivo, "url": f"/api/imagem/arquivo/{arquivo}",
                "w": img.width, "h": img.height, "paleta": paleta(img), "brilho": brilho(img),
                "autor": "Imagem gerada localmente", "licenca": self.modelo.split("/")[-1], "fonte": "neste computador"}
        meta_arq.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
        log.info("imagem gerada em %.1fs: %s", time.perf_counter() - t0, descricao[:60])
        return meta

