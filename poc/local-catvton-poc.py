#!/usr/bin/env python3
"""在 Apple Silicon 上用 CatVTON 做一次本地、真实的非商业试衣 POC。"""

from __future__ import annotations

import argparse
import fcntl
import gc
import os
import sys
from pathlib import Path

import cv2
import numpy as np
ROOT = Path(__file__).resolve().parents[1]
CATVTON = ROOT / ".local-models" / "CatVTON"
RUNTIME = ROOT / ".local-models" / "runtime"
CACHE = ROOT / ".cache" / "huggingface"
os.environ.setdefault("HF_HOME", str(CACHE))
os.environ.setdefault("HF_HUB_ENABLE_HF_TRANSFER", "0")

import torch
from PIL import Image, ImageDraw, ImageFilter

SEGMENTER = RUNTIME / "segformer-clothes"
LABELS = {
    "background": 0,
    "hat": 1,
    "hair": 2,
    "upper": 4,
    "skirt": 5,
    "pants": 6,
    "dress": 7,
    "belt": 8,
    "left_shoe": 9,
    "right_shoe": 10,
    "face": 11,
    "left_leg": 12,
    "right_leg": 13,
    "left_arm": 14,
    "right_arm": 15,
    "bag": 16,
    "scarf": 17,
}


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


def rectangle_fallback_mask(size: tuple[int, int], category: str) -> Image.Image:
    """解析模型不可用时的保守回退，不再覆盖脸部和整条手臂。"""
    width, height = size
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    bottom = 0.88 if category == "overall" else 0.62 if category == "upper" else 0.90
    top = 0.18 if category != "lower" else 0.42
    draw.rounded_rectangle(
        (int(width * 0.27), int(height * top), int(width * 0.73), int(height * bottom)),
        radius=max(8, int(width * 0.08)),
        fill=255,
    )
    return mask.filter(ImageFilter.GaussianBlur(max(3, width // 90)))


class ClothingParser:
    def __init__(self) -> None:
        from transformers import SegformerForSemanticSegmentation, SegformerImageProcessor

        require(SEGMENTER / "config.json", "服装解析配置")
        require(SEGMENTER / "preprocessor_config.json", "服装解析预处理配置")
        require(SEGMENTER / "model.safetensors", "服装解析权重")
        self.processor = SegformerImageProcessor.from_pretrained(SEGMENTER, local_files_only=True)
        self.model = SegformerForSemanticSegmentation.from_pretrained(SEGMENTER, local_files_only=True).eval()

    @torch.inference_mode()
    def __call__(self, image: Image.Image) -> np.ndarray:
        inputs = self.processor(images=image, return_tensors="pt")
        logits = self.model(**inputs).logits
        logits = torch.nn.functional.interpolate(
            logits,
            size=(image.height, image.width),
            mode="bilinear",
            align_corners=False,
        )
        return logits.argmax(dim=1)[0].cpu().numpy().astype(np.uint8)


def ids_mask(parse: np.ndarray, ids: set[int]) -> np.ndarray:
    return np.isin(parse, list(ids)).astype(np.uint8)


def clothing_ids(category: str) -> set[int]:
    if category == "upper":
        return {LABELS["upper"], LABELS["dress"]}
    if category == "lower":
        return {LABELS["skirt"], LABELS["pants"], LABELS["dress"]}
    return {LABELS["upper"], LABELS["skirt"], LABELS["pants"], LABELS["dress"], LABELS["belt"]}


def parsed_person_mask(parse: np.ndarray, category: str) -> Image.Image:
    """从原衣服扩张换装区，同时强制保护脸、头发、裸露四肢和配饰。"""
    cloth = ids_mask(parse, clothing_ids(category))
    height, width = cloth.shape
    kernel_size = max(5, round(max(width, height) / 70))
    if kernel_size % 2 == 0:
        kernel_size += 1
    kernel = np.ones((kernel_size, kernel_size), np.uint8)
    expanded = cv2.morphologyEx(cloth, cv2.MORPH_CLOSE, kernel, iterations=2)
    expanded = cv2.dilate(expanded, kernel, iterations=2 if category == "overall" else 1)

    if category == "overall":
        # 连衣裙必须能覆盖原裤腿之间的背景。若仍沿原衣服轮廓重绘，长裙一定会
        # 被裁成裤装/短裙；CatVTON 官方 AutoMasker 同样用 convex hull 扩区。
        points = cv2.findNonZero((expanded * 255).astype(np.uint8))
        if points is not None and len(points) >= 3:
            hull = cv2.convexHull(points)
            expanded = cv2.fillConvexPoly(np.zeros_like(expanded), hull, 1)

    protect_ids = {
        LABELS["face"], LABELS["hair"], LABELS["hat"], LABELS["left_arm"], LABELS["right_arm"],
        LABELS["left_shoe"], LABELS["right_shoe"], LABELS["bag"], LABELS["scarf"],
    }
    if category == "upper":
        protect_ids |= {LABELS["left_leg"], LABELS["right_leg"], LABELS["skirt"], LABELS["pants"]}
    if category == "lower":
        protect_ids |= {LABELS["upper"]}
    protect = ids_mask(parse, protect_ids)
    # 原衣服区域必须覆盖；扩张区域则不能侵入脸、头发、手臂或无关服装。
    mask = cloth | (expanded & (1 - protect))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=1)
    blur = max(5, kernel_size)
    return Image.fromarray(mask * 255).filter(ImageFilter.GaussianBlur(blur / 2))


def extract_garment(image: Image.Image, parse: np.ndarray, category: str) -> tuple[Image.Image, float]:
    """把卖家真人展示图转成白底服装条件图，减少把卖家脸和姿态迁移到用户身上。"""
    mask = ids_mask(parse, clothing_ids(category))
    ratio = float(mask.mean())
    if ratio < 0.035:
        return image, ratio
    kernel = np.ones((5, 5), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    soft = Image.fromarray(mask * 255).filter(ImageFilter.GaussianBlur(1.2))
    background = Image.new("RGB", image.size, (245, 245, 245))
    extracted = Image.composite(image, background, soft)
    # 平台主图常把衣服缩在真人全身照中；紧裁后再交给 Pipeline padding，
    # 让服装像官方白底商品图一样占满条件画布，而不是只剩一小团像素。
    ys, xs = np.where(mask > 0)
    left, right = int(xs.min()), int(xs.max()) + 1
    top, bottom = int(ys.min()), int(ys.max()) + 1
    padding = max(8, round(max(right - left, bottom - top) * 0.06))
    box = (
        max(0, left - padding),
        max(0, top - padding),
        min(image.width, right + padding),
        min(image.height, bottom + padding),
    )
    return extracted.crop(box), ratio


def is_clean_product_image(image: Image.Image) -> bool:
    """识别大面积近白背景的单品图；这类图直接输入比二次分割更稳定。"""
    pixels = np.asarray(image.convert("RGB").resize((128, 128)), dtype=np.uint8)
    border = np.concatenate((pixels[:12].reshape(-1, 3), pixels[-12:].reshape(-1, 3),
                             pixels[:, :12].reshape(-1, 3), pixels[:, -12:].reshape(-1, 3)))
    near_white = np.all(border >= 238, axis=1)
    neutral = np.max(border, axis=1) - np.min(border, axis=1) <= 10
    return float(np.mean(near_white & neutral)) >= 0.82


def crop_clean_product(image: Image.Image) -> Image.Image:
    """去掉白底商品图的空边，让长款服装按自身纵横比进入条件画布。"""
    pixels = np.asarray(image.convert("RGB"), dtype=np.uint8)
    foreground = np.any(pixels < 235, axis=2)
    ys, xs = np.where(foreground)
    if len(xs) == 0:
        return image
    padding = max(8, round(max(xs.max() - xs.min(), ys.max() - ys.min()) * 0.04))
    return image.crop((
        max(0, int(xs.min()) - padding),
        max(0, int(ys.min()) - padding),
        min(image.width, int(xs.max()) + padding + 1),
        min(image.height, int(ys.max()) + padding + 1),
    ))


def resize_parse_and_crop(parse: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    """按 CatVTON 的人物裁切规则同步语义标签，但使用最近邻避免标签混色。"""
    height, width = parse.shape
    target_width, target_height = size
    if width / height < target_width / target_height:
        new_width = width
        new_height = width * target_height // target_width
    else:
        new_height = height
        new_width = height * target_width // target_height
    left = (width - new_width) // 2
    top = (height - new_height) // 2
    cropped = parse[top:top + new_height, left:left + new_width]
    return cv2.resize(cropped, size, interpolation=cv2.INTER_NEAREST)


def detect_sparse_embellishments(
    image: Image.Image,
    parse: np.ndarray,
    category: str,
) -> tuple[list[tuple[float, float, float, tuple[int, int, int]]], float]:
    """检测深色衣身中的稀疏亮色仿钻、波点和小刺绣，返回归一化衣身坐标。"""
    if category == "lower":
        return [], 0.0
    pixels = np.asarray(image.convert("RGB"), dtype=np.uint8)
    garment_mask = ids_mask(parse, clothing_ids(category))
    ys, xs = np.where(garment_mask > 0)
    if len(xs) == 0:
        return [], 0.0
    left, right = int(xs.min()), int(xs.max()) + 1
    top, bottom = int(ys.min()), int(ys.max()) + 1
    upper_bottom = bottom if category == "upper" else top + max(1, round((bottom - top) * 0.50))
    upper_region = garment_mask.copy()
    upper_region[upper_bottom:] = 0
    upper_region[:top] = 0
    kernel_size = max(3, round(max(right - left, upper_bottom - top) / 100))
    if kernel_size % 2 == 0:
        kernel_size += 1
    interior = cv2.erode(upper_region, np.ones((kernel_size, kernel_size), np.uint8), iterations=1)
    luminance = cv2.cvtColor(pixels, cv2.COLOR_RGB2GRAY)
    interior_values = luminance[interior > 0]
    if len(interior_values) < 100:
        return [], 0.0
    base_luminance = float(np.percentile(interior_values, 45))
    if base_luminance >= 125:
        return [], base_luminance
    candidates = ((luminance >= max(105, base_luminance + 55)) & (interior > 0)).astype(np.uint8)
    count, labels, stats, centroids = cv2.connectedComponentsWithStats(candidates, 8)
    min_area = max(2, round(image.width * image.height / 500_000))
    max_area = max(24, round(image.width * image.height / 8_000))
    max_width = max(6, round((right - left) * 0.045))
    max_height = max(6, round((upper_bottom - top) * 0.055))
    decorations = []
    for index in range(1, count):
        x, y, width, height, area = [int(value) for value in stats[index]]
        center_x, center_y = centroids[index]
        if not (min_area <= area <= max_area and width <= max_width and height <= max_height):
            continue
        if center_y < top + (upper_bottom - top) * 0.10:
            continue
        row_xs = np.where(upper_region[min(max(round(center_y), 0), upper_region.shape[0] - 1)] > 0)[0]
        if len(row_xs) < 4:
            continue
        row_left, row_right = float(row_xs.min()), float(row_xs.max())
        horizontal = (float(center_x) - row_left) / max(1.0, row_right - row_left)
        vertical = (float(center_y) - top) / max(1.0, upper_bottom - top)
        if not (0.08 <= horizontal <= 0.92 and 0.08 <= vertical <= 0.98):
            continue
        component_pixels = pixels[labels == index]
        color = tuple(int(value) for value in np.percentile(component_pixels, 70, axis=0))
        diameter = max(width, height) / max(1.0, row_right - row_left)
        decorations.append((horizontal, vertical, diameter, color))
    coverage = float(candidates.sum()) / max(1.0, float(upper_region.sum()))
    if not (6 <= len(decorations) <= 140 and coverage <= 0.045):
        return [], base_luminance
    return decorations, base_luminance


def reinforce_sparse_embellishments(
    result: Image.Image,
    garment: Image.Image,
    garment_parse: np.ndarray,
    person_parse_canvas: np.ndarray,
    category: str,
) -> tuple[Image.Image, int]:
    """把扩散模型容易丢失的小装饰按逐行衣身宽度映射回生成结果。"""
    decorations, _ = detect_sparse_embellishments(garment, garment_parse, category)
    if not decorations:
        return result, 0
    target = ids_mask(person_parse_canvas, {LABELS["upper"], LABELS["dress"]})
    ys, xs = np.where(target > 0)
    if len(xs) == 0:
        return result, 0
    top, bottom = int(ys.min()), int(ys.max()) + 1
    if category == "overall" and LABELS["dress"] in np.unique(person_parse_canvas[target > 0]):
        bottom = top + max(1, round((bottom - top) * 0.50))
        target[bottom:] = 0

    scale = 4
    overlay = Image.new("RGBA", (result.width * scale, result.height * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    result_pixels = np.asarray(result.convert("RGB"), dtype=np.uint8)
    applied = 0
    for horizontal, vertical, relative_diameter, source_color in decorations:
        y = min(result.height - 1, max(0, round(top + vertical * (bottom - top))))
        row_xs = np.where(target[y] > 0)[0]
        if len(row_xs) < 4:
            continue
        row_left, row_right = int(row_xs.min()), int(row_xs.max())
        x = min(result.width - 1, max(0, round(row_left + horizontal * (row_right - row_left))))
        if target[y, x] == 0 or float(result_pixels[y, x].mean()) > 145:
            continue
        radius = max(1.2, min(3.0, relative_diameter * (row_right - row_left) * 0.55)) * scale
        center_x, center_y = x * scale, y * scale
        color = tuple(max(145, min(235, channel)) for channel in source_color) + (185,)
        draw.polygon([
            (center_x, center_y - radius),
            (center_x + radius, center_y),
            (center_x, center_y + radius),
            (center_x - radius, center_y),
        ], fill=color)
        highlight = max(1.0, radius * 0.24)
        draw.ellipse((center_x - highlight, center_y - highlight, center_x + highlight, center_y + highlight), fill=(245, 245, 245, 205))
        applied += 1
    if applied == 0:
        return result, 0
    overlay = overlay.resize(result.size, Image.Resampling.LANCZOS)
    target_alpha = Image.fromarray((target * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6))
    alpha = Image.fromarray(np.minimum(np.asarray(overlay.getchannel("A")), np.asarray(target_alpha)).astype(np.uint8))
    overlay.putalpha(alpha)
    return Image.alpha_composite(result.convert("RGBA"), overlay).convert("RGB"), applied


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--person", default=str(ROOT / "app/assets/demo-model.jpg"))
    parser.add_argument("--garment", required=True)
    parser.add_argument("--output", default=str(ROOT / ".local-models/local-tryon.png"))
    parser.add_argument("--steps", type=int, default=30)
    parser.add_argument("--width", type=int, default=576)
    parser.add_argument("--height", type=int, default=768)
    parser.add_argument("--category", choices=["upper", "lower", "overall"], default="overall")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--guidance", type=float, default=2.5)
    parser.add_argument("--garment-mode", choices=["auto", "original", "segmented"], default="auto")
    parser.add_argument("--composite", choices=["mask", "none"], default="mask")
    parser.add_argument("--detail-reinforcement", choices=["auto", "off"], default="auto")
    parser.add_argument("--debug-dir")
    args = parser.parse_args()

    if not CATVTON.exists():
        raise SystemExit("缺少 .local-models/CatVTON，请先克隆官方仓库")
    if not torch.backends.mps.is_available():
        raise SystemExit("当前机器没有可用的 Apple MPS")

    # PyTorch MPS 不支持两个扩散进程稳定并发；跨页面/CLI 共用文件锁串行化，
    # 防止两个进程同时进入 GPU 内核后互相卡死。
    CACHE.mkdir(parents=True, exist_ok=True)
    mps_lock = (CACHE / "catvton-mps.lock").open("a+")
    fcntl.flock(mps_lock, fcntl.LOCK_EX)

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
    source_garment = Image.open(args.garment).convert("RGB")
    garment = source_garment.copy()
    person_parse = garment_parse = None
    try:
        parser_model = ClothingParser()
        person_parse = parser_model(person)
        garment_parse = parser_model(garment)
        mask = parsed_person_mask(person_parse, args.category)
        garment_ratio = float(ids_mask(garment_parse, clothing_ids(args.category)).mean())
        clean_product = is_clean_product_image(garment)
        should_segment = args.garment_mode == "segmented" or (args.garment_mode == "auto" and not clean_product)
        if should_segment:
            garment, garment_ratio = extract_garment(garment, garment_parse, args.category)
            effective_garment_mode = "segmented"
        elif args.garment_mode == "auto" and clean_product:
            garment = crop_clean_product(garment)
            effective_garment_mode = "clean-crop"
        else:
            effective_garment_mode = "original"
        del parser_model
        gc.collect()
    except Exception as error:
        print(f"服装解析回退：{error}", file=sys.stderr)
        mask = rectangle_fallback_mask(person.size, args.category)
        garment_ratio = 0.0
        effective_garment_mode = "original"

    if args.debug_dir:
        debug_dir = Path(args.debug_dir)
        debug_dir.mkdir(parents=True, exist_ok=True)
        mask.save(debug_dir / "person-mask.png")
        garment.save(debug_dir / "garment-extracted.png")

    pipeline = CatVTONPipeline(
        base_ckpt=str(base),
        attn_ckpt=str(attention),
        attn_ckpt_version="mix",
        weight_dtype=torch.float16,
        device="mps",
        skip_safety_check=True,
        use_tf32=False,
    )
    generator = torch.Generator(device="cpu").manual_seed(args.seed)
    result = pipeline(
        person,
        garment,
        mask,
        num_inference_steps=args.steps,
        guidance_scale=args.guidance,
        height=args.height,
        width=args.width,
        generator=generator,
    )[0]
    if args.composite == "mask":
        # 强制把蒙版外区域恢复为原图，避免模型轻微改脸、改手或改背景。
        from utils import resize_and_crop

        person_canvas = resize_and_crop(person, (args.width, args.height))
        mask_canvas = resize_and_crop(mask, (args.width, args.height)).convert("L")
        result = Image.composite(result, person_canvas, mask_canvas)
    before_detail = result.copy()
    detail_count = 0
    if args.detail_reinforcement == "auto" and person_parse is not None and garment_parse is not None:
        parse_canvas = resize_parse_and_crop(person_parse, (args.width, args.height))
        result, detail_count = reinforce_sparse_embellishments(
            result,
            source_garment,
            garment_parse,
            parse_canvas,
            args.category,
        )
    if args.debug_dir:
        before_detail.save(debug_dir / "result-before-detail.png")
        result.save(debug_dir / "result-after-detail.png")
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    result.save(output)
    print(
        f"{output.resolve()} garment_ratio={garment_ratio:.4f} category={args.category} "
        f"garment_mode={effective_garment_mode} seed={args.seed} guidance={args.guidance} "
        f"composite={args.composite} detail_count={detail_count}"
    )


if __name__ == "__main__":
    main()
