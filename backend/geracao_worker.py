"""Processo separado que gera imagens com um modelo de difusão local (diffusers).

Roda fora do servidor de propósito: as DLLs da CUDA do PyTorch não se misturam com as do Whisper,
e quando o processo fecha (depois de um tempo parado) a VRAM volta inteira para o Whisper e o Ollama.

Protocolo (uma linha JSON por mensagem):
  entrada: {"prompt": str, "largura": int, "altura": int, "saida": caminho.png, "semente": int}
  saída:   {"passo": int, "total": int} a cada passo da difusão (para a tela mostrar o progresso), e no fim
           {"ok": true, "ms": int} | {"ok": false, "erro": str}
A primeira linha de saída é {"pronto": true, "modelo": ..., "modo": ...} quando o modelo carregou.
"""
from __future__ import annotations

import inspect
import json
import os
import sys
import time

os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")


def responder(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def parametros(modelo: str) -> dict:
    m = modelo.lower()
    if "z-image" in m:
        return {"num_inference_steps": 9, "guidance_scale": 0.0}
    if "flux.1-schnell" in m:
        return {"num_inference_steps": 4, "guidance_scale": 0.0, "max_sequence_length": 256}
    if "turbo" in m:
        return {"num_inference_steps": 4, "guidance_scale": 0.0}
    return {"num_inference_steps": 28, "guidance_scale": 4.5}


def tamanho(modelo: str, vram_gb: float) -> tuple[int, int]:
    """Resolução nativa de geração (16:9, múltiplos de 16). O servidor amplia para 4K depois."""
    m = modelo.lower()
    if "z-image" in m or "flux" in m or "qwen-image" in m:
        return (2048, 1152) if vram_gb >= 24 else (1600, 896)
    if "xl" in m:
        return 1344, 768
    return 1024, 576


def main() -> None:
    modelo = sys.argv[1]                                    # pasta local do modelo (ou o id do Hugging Face)
    nome = sys.argv[2] if len(sys.argv) > 2 else modelo     # o id, para escolher passos e resolução
    if os.path.isdir(modelo):
        os.environ["HF_HUB_OFFLINE"] = "1"                  # já está tudo no disco: nada de esperar a rede
    import torch
    from diffusers import DiffusionPipeline

    if not torch.cuda.is_available():
        responder({"pronto": False, "erro": "Sem GPU CUDA para o PyTorch"})
        return
    total = torch.cuda.get_device_properties(0).total_memory / 2**30
    dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    if "sd-turbo" in nome.lower() or "sdxl-turbo" in nome.lower():
        dtype = torch.float16
    t0 = time.perf_counter()
    pipe = DiffusionPipeline.from_pretrained(modelo, torch_dtype=dtype)
    livre = torch.cuda.mem_get_info()[0] / 2**30
    # com muita folga, tudo na GPU; senão cada parte do modelo sobe para a GPU só na hora de usar (o resto fica na RAM).
    # A folga é grande de propósito: o Whisper e o Ollama dividem a placa e podem crescer depois (antes, "cabia por
    # pouco", ia tudo para a GPU e a geração estourava a memória no meio). Com PCIe 4/5 a troca custa ~1 s por imagem.
    modo = "gpu"
    peso = sum(p.numel() * p.element_size() for c in pipe.components.values() if isinstance(c, torch.nn.Module) for p in c.parameters()) / 2**30
    if peso + 8 > livre:
        pipe.enable_model_cpu_offload()
        modo = "offload"
    else:
        pipe.to("cuda")
    pipe.set_progress_bar_config(disable=True)
    responder({"pronto": True, "modelo": nome, "modo": modo, "vram_gb": round(total, 1), "livre_gb": round(livre, 1),
               "tamanho_gb": round(peso, 1), "s": round(time.perf_counter() - t0, 1)})

    extra = parametros(nome)
    passos = extra["num_inference_steps"]

    def progresso(_pipe, i, _t, kwargs):
        responder({"passo": i + 1, "total": passos})
        return kwargs
    for linha in sys.stdin:
        try:
            pedido = json.loads(linha)
        except json.JSONDecodeError:
            continue
        t0 = time.perf_counter()
        try:
            gerador = torch.Generator("cuda").manual_seed(int(pedido.get("semente", 0)))
            largura, altura = int(pedido.get("largura") or 0), int(pedido.get("altura") or 0)
            if not largura or not altura:
                largura, altura = tamanho(nome, total)
            kwargs = dict(prompt=pedido["prompt"], width=largura, height=altura, generator=gerador, **extra)
            responder({"passo": 0, "total": passos})
            if "callback_on_step_end" in inspect.signature(pipe.__call__).parameters:
                kwargs["callback_on_step_end"] = progresso
            try:
                img = pipe(**kwargs).images[0]
            except torch.OutOfMemoryError:
                torch.cuda.empty_cache()
                if modo == "gpu":                        # a placa encheu depois (Ollama/Whisper): passa a revezar as partes
                    pipe.to("cpu")
                    pipe.enable_model_cpu_offload()
                    modo = "offload"
                else:
                    pipe.enable_sequential_cpu_offload()     # último recurso: lento, mas cabe
                    modo = "sequencial"
                torch.cuda.empty_cache()
                gerador = torch.Generator("cuda").manual_seed(int(pedido.get("semente", 0)))
                kwargs["generator"] = gerador
                img = pipe(**kwargs).images[0]
            img.save(pedido["saida"])
            responder({"ok": True, "ms": round((time.perf_counter() - t0) * 1000)})
        except Exception as e:  # noqa: BLE001
            responder({"ok": False, "erro": f"{type(e).__name__}: {e}"[:300]})


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        responder({"pronto": False, "erro": f"{type(e).__name__}: {e}"[:300]})
