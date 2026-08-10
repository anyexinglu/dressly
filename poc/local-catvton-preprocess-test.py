#!/usr/bin/env python3
"""验证试衣预处理不会把脸和手臂纳入重绘区域。"""

import importlib.util
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("dressly_catvton", ROOT / "poc/local-catvton-poc.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

parse = np.zeros((120, 80), dtype=np.uint8)
parse[24:82, 25:55] = module.LABELS["dress"]
parse[14:25, 31:49] = module.LABELS["face"]
parse[30:76, 15:24] = module.LABELS["left_arm"]
parse[30:76, 56:65] = module.LABELS["right_arm"]

mask = np.asarray(module.parsed_person_mask(parse, "overall"))
assert mask[50, 40] > 240, "衣服中心必须进入重绘区"
assert mask[19, 40] < 16, "脸部必须受保护"
assert mask[50, 19] < 16 and mask[50, 60] < 16, "双臂必须受保护"

trouser_parse = np.zeros((120, 80), dtype=np.uint8)
trouser_parse[20:55, 26:54] = module.LABELS["upper"]
trouser_parse[55:105, 26:36] = module.LABELS["pants"]
trouser_parse[55:105, 44:54] = module.LABELS["pants"]
trouser_mask = np.asarray(module.parsed_person_mask(trouser_parse, "overall"))
assert trouser_mask[85, 40] > 240, "整体试衣蒙版必须填满两腿之间，才能生成长裙摆"

image = Image.new("RGB", (80, 120), "red")
garment, ratio = module.extract_garment(image, parse, "overall")
assert ratio > 0.15, "应识别到足够服装像素"
assert garment.width < image.width and garment.height < image.height, "真人商品图应紧裁到服装区域"

clean = Image.new("RGB", (200, 200), "white")
assert module.is_clean_product_image(clean), "纯白底单品图必须绕过二次分割"
clean_pixels = np.asarray(clean).copy()
clean_pixels[40:160, 80:120] = 0
clean_garment = Image.fromarray(clean_pixels)
clean_cropped = module.crop_clean_product(clean_garment)
assert clean_cropped.height > clean_cropped.width * 2, "白底长款单品必须去除空边并保留纵横比"
studio = Image.new("RGB", (200, 200), (96, 96, 96))
assert not module.is_clean_product_image(studio), "真人棚拍图仍应进入服装分割"

detail_image = np.full((200, 120, 3), 255, dtype=np.uint8)
detail_parse = np.zeros((200, 120), dtype=np.uint8)
detail_parse[15:185, 30:90] = module.LABELS["dress"]
detail_image[15:185, 30:90] = 20
for y in range(42, 98, 14):
    for x in range(42, 84, 14):
        detail_image[y - 1:y + 2, x - 1:x + 2] = 230
detail_source = Image.fromarray(detail_image)
details, base = module.detect_sparse_embellishments(detail_source, detail_parse, "overall")
assert base < 40 and len(details) >= 8, "深色衣身的小亮点应被识别为稀疏装饰"
plain_dark = Image.fromarray(np.where(detail_parse[..., None] > 0, 20, 255).astype(np.uint8).repeat(3, axis=2))
plain_details, _ = module.detect_sparse_embellishments(plain_dark, detail_parse, "overall")
assert not plain_details, "纯色衣身不得凭空生成装饰"
lower_details, _ = module.detect_sparse_embellishments(detail_source, detail_parse, "lower")
assert not lower_details, "当前装饰增强不得误改下装"
person_detail_parse = np.zeros((240, 180), dtype=np.uint8)
person_detail_parse[40:140, 55:125] = module.LABELS["upper"]
plain_result = Image.new("RGB", (180, 240), (35, 35, 35))
reinforced, applied = module.reinforce_sparse_embellishments(
    plain_result, detail_source, detail_parse, person_detail_parse, "overall"
)
assert applied >= 8, "检测到的装饰应映射到目标衣身"
assert np.asarray(reinforced).max() > 100, "装饰回贴后应产生可见的高对比细节"

print("local CatVTON preprocess assertions passed")
