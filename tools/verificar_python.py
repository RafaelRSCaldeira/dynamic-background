"""Diz se este Python serve para o painel (usado pelo iniciar.ps1). Só usa a biblioteca padrão.

Uso:  python tools/verificar_python.py          -> verifica a versão/arquitetura
      python tools/verificar_python.py --deps   -> também verifica se as dependências importam
Sai com 0 se estiver tudo certo; imprime o motivo caso contrário.
"""
import struct
import sys
import sysconfig

versao = f"{sys.version_info[0]}.{sys.version_info[1]}"
bits = struct.calcsize("P") * 8
sem_gil = bool(sysconfig.get_config_var("Py_GIL_DISABLED"))

problemas = []
if not (3, 10) <= sys.version_info[:2] <= (3, 14):
    problemas.append(f"Python {versao} não suportado (use 3.10 a 3.14)")
if bits != 64:
    problemas.append(f"Python de {bits} bits (é preciso 64 bits)")
if sem_gil:
    problemas.append("Python 'free-threaded' (3.xt) não é suportado")

if not problemas and "--deps" in sys.argv:
    for modulo in ("fastapi", "uvicorn", "httpx", "numpy", "sounddevice", "faster_whisper", "ctranslate2", "onnxruntime",
                   "PIL", "kokoro_onnx"):
        try:
            __import__(modulo)
        except Exception as e:  # noqa: BLE001
            problemas.append(f"dependência '{modulo}' com problema: {type(e).__name__}: {e}")

print(f"{versao} {bits}-bit {sys.executable}")
for p in problemas:
    print("  - " + p)
sys.exit(1 if problemas else 0)
