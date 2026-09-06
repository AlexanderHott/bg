"""Regenerate fixtures with the transforms in ZhengPeng7/BiRefNet's notebooks.

Reference commit: ebcc0bc8ec7fe919cec829f2dea656b3078acddc
BiRefNet_pth2onnx.ipynb: Resize, ToTensor, Normalize, sigmoid.
BiRefNet_inference.ipynb: ToPILImage and resize to source dimensions.
Orientation and multiplication by source alpha are bg's additional contract.
"""

import gzip
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageOps
from torchvision import transforms


root = Path(__file__).parent
transform = transforms.Compose([
    transforms.Resize((1024, 1024)),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
])
x = torch.arange(1024, dtype=torch.float32)[None, :]
y = torch.arange(1024, dtype=torch.float32)[:, None]
logits = ((x - 512) / 64 + (y // 128 - 4) / 2).contiguous()
(root / "logits.f32.gz").write_bytes(gzip.compress(logits.numpy().astype("<f4").tobytes(), mtime=0))

for name, width, height, orientation in [
    ("small", 80, 60, 1),
    ("oriented", 1600, 1200, 6),
]:
    yy, xx = np.mgrid[:height, :width]
    rgba = np.stack([
        (xx * 255 // width), (yy * 255 // height),
        np.where(xx < width // 2, 40, 220),
        np.where(yy < height // 2, 128, 255),
    ], axis=-1).astype(np.uint8)
    source = Image.fromarray(rgba)
    exif = source.getexif()
    exif[274] = orientation
    source.save(root / f"{name}-input.png", exif=exif)
    source = ImageOps.exif_transpose(Image.open(root / f"{name}-input.png"))
    tensor = transform(source.convert("RGB")).numpy().astype("<f4")
    (root / f"{name}-tensor.f32.gz").write_bytes(gzip.compress(tensor.tobytes(), mtime=0))
    mask = transforms.ToPILImage()(logits.sigmoid()).resize(source.size)
    output = np.array(source)
    output[:, :, 3] = np.rint(np.array(mask).astype(np.float32) * output[:, :, 3] / 255).astype(np.uint8)
    Image.fromarray(output).save(root / f"{name}-output.png")
