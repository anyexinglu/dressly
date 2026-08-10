#!/usr/bin/env python3
"""在 Apple Silicon 上用 CatVTON 做一次本地、真实的非商业试衣 POC。"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATVTON = ROOT / ".local-models" / "CatVTON"
RUNTIME = ROOT / ".local-models" / "runtime"
CACHE = ROOT / ".cache" / "huggingface"
os.environ.setdefault("HF_HOME", str(CACHE))
os.environ.setdefault("HF_HUB_ENABLE_HF_TRANSFER", "0")

import torch
from PIL import Image, ImageDraw, ImageFilter


def link(source: str, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() or target.is_symlink():
        target.unlink()
    target.symlink_to(Path(source).resolve())


def require(path: Path, label: str) -> Path:
    if not path.exists():
        raise SystemExit(f"缺少本地模型文件：{label}（{path}）")
    return path


def prepare_models() -> tuple[Path, Path, Path]:
    """只组装本地目录，不向 Hugging Face 发起元数据请求。"""
    base_cache = CACHE / "models--stable-diffusion-v1-5--stable-diffusion-inpainting"
    base_snapshot = base_cache / "snapshots" / "8a4288a76071f7280aedbdb3253bdb9e9d5d84bb"
    unet_blob = base_cache / "blobs" / "24b788b4a777748377cc20364eea4ae113c8c42f4468c16bc8c02fdae5492af9"
    base = RUNTIME / "sd15-inpainting-fp16"
    for name in ["scheduler/scheduler_config.json", "unet/config.json"]:
        link(str(require(base_snapshot / name, name)), base / name)
    link(
        str(require(unet_blob, "SD 1.5 inpainting UNet")),
        base / "unet/diffusion_pytorch_model.safetensors",
    )

    vae = RUNTIME / "sd-vae-ft-mse"
    require(vae / "config.json", "SD VAE 配置")
    vae_blob = CACHE / "models--stabilityai--sd-vae-ft-mse" / "blobs" / "a1d993488569e928462932c8c38a0760b874d166399b14414135bd9c42df5815"
    link(str(require(vae_blob, "SD VAE 权重")), vae / "diffusion_pytorch_model.safetensors")

    attention = RUNTIME / "catvton-attention"
    attention_blob = CACHE / "models--zhengchong--CatVTON" / "blobs" / "a1fc093f1b6744623079e6f4e7313411f524e388c4b7467df1e0e7f577cba23a"
    link(
        str(require(attention_blob, "CatVTON attention 权重")),
        attention / "mix-48k-1024/attention/model.safetensors",
    )
    return base, attention, vae


def upper_body_mask(size: tuple[int, int]) -> Image.Image:
    """为公开示例模特生成保守的上身区域蒙版；不伪装成人体解析。"""
    width, height = size
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle(
        (int(width * 0.18), int(height * 0.20), int(width * 0.82), int(height * 0.76)),
        radius=max(8, int(width * 0.08)),
        fill=255,
    )
    return mask.filter(ImageFilter.GaussianBlur(max(3, width // 90)))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--person", default=str(ROOT / "app/assets/demo-model.jpg"))
    parser.add_argument("--garment", required=True)
    parser.add_argument("--output", default=str(ROOT / ".local-models/local-tryon.png"))
    parser.add_argument("--steps", type=int, default=20)
    parser.add_argument("--width", type=int, default=384)
    parser.add_argument("--height", type=int, default=512)
    args = parser.parse_args()

    if not CATVTON.exists():
        raise SystemExit("缺少 .local-models/CatVTON，请先克隆官方仓库")
    if not torch.backends.mps.is_available():
        raise SystemExit("当前机器没有可用的 Apple MPS")

    base, attention, vae = prepare_models()
    sys.path.insert(0, str(CATVTON))
    # 官方 Pipeline 把 VAE 仓库名写死；在导入前将它精确重定向到本地目录。
    from diffusers import AutoencoderKL

    original_vae_loader = AutoencoderKL.from_pretrained

    def local_vae_loader(model_id, *loader_args, **loader_kwargs):
        if model_id == "stabilityai/sd-vae-ft-mse":
            model_id = str(vae)
        return original_vae_loader(model_id, *loader_args, **loader_kwargs)

    AutoencoderKL.from_pretrained = staticmethod(local_vae_loader)
    from model.pipeline import CatVTONPipeline

    person = Image.open(args.person).convert("RGB")
    garment = Image.open(args.garment).convert("RGB")
    mask = upper_body_mask(person.size)

    pipeline = CatVTONPipeline(
        base_ckpt=str(base),
        attn_ckpt=str(attention),
        attn_ckpt_version="mix",
        weight_dtype=torch.float16,
        device="mps",
        skip_safety_check=True,
        use_tf32=False,
    )
    generator = torch.Generator(device="cpu").manual_seed(42)
    result = pipeline(
        person,
        garment,
        mask,
        num_inference_steps=args.steps,
        guidance_scale=2.5,
        height=args.height,
        width=args.width,
        generator=generator,
    )[0]
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    result.save(output)
    print(output.resolve())


if __name__ == "__main__":
    main()
