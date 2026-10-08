#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
scripts/make-icons.py —— 生成「望舒」全部尺寸的应用图标。

为什么用脚本而不是塞一堆二进制：
  图标要同时满足 16px（任务栏/文件列表）、32px（桌面）、256px（安装器/关于页）
  三种截然不同的阅读距离。手改 PNG 无法保证各尺寸"看起来是同一个东西"，
  所以几何全部按**归一化坐标**定义、按目标尺寸重新光栅化（4× 超采样再降采样），
  任何尺寸都是从同一份定义算出来的。

产物：
  build/icon.svg                      设计源（人工可编辑，与脚本几何一致）
  build/icon.png                      1024×1024，electron-builder 的主图标
  build/icon.ico                      多尺寸 Windows 图标（16/24/32/48/64/128/256）
  build/icons/<n>x<n>.png             各尺寸独立 PNG（Linux / 文档 / 关于页用）
  public/favicon.png                  64×64，渲染层页面图标

用法：
  python scripts/make-icons.py
"""
from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ModuleNotFoundError:  # noqa: BLE001
    sys.stderr.write(
        "缺少 Pillow。请用带 Pillow 的解释器运行，例如：\n"
        '  "%LOCALAPPDATA%\\Programs\\Python\\Python314\\python.exe" scripts/make-icons.py\n'
        "或先执行：python -m pip install pillow\n"
    )
    sys.exit(2)

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
ICONS = BUILD / "icons"
PUBLIC = ROOT / "public"

# ---------------------------------------------------------------- 设计常量
RADIUS_RATIO = 0.2229          # 圆角半径 / 边长（≈ macOS squircle 观感）
SS = 4                         # 超采样倍数
MIN_RASTER = 512               # 光栅化下限，避免 16px 时超采样后仍不够画

# 品牌渐变：与 tokens.css 的 --brand(#4C8DFF) / --brand-2(#8B5CF6) 同源
GRADIENT = [
    (0.00, (0x7F, 0xB2, 0xFF)),
    (0.48, (0x4C, 0x8D, 0xFF)),
    (1.00, (0x88, 0x58, 0xF6)),
]

# 月亮（新月）：外圆挖去一个偏移的内圆
MOON_OUT = (0.478, 0.512, 0.238)   # cx, cy, r
MOON_IN = (0.606, 0.418, 0.208)

# 星芒（四角星）：落在新月的开口里
SPARK = (0.706, 0.322, 0.065)
SPARK_WAIST = 0.17                 # 腰部收敛比

GLOW = (0.30, 0.235, 0.82, 0.30)   # cx, cy, r, 峰值 alpha

# ------------------------------------------------------------ 小尺寸适配
# 同一份几何在 16px 下会退化成「白团压白底」——柔光正好落在月亮所在区域，
# 把底色提亮到 #7FB2FF，白月对比度掉到 2.4:1。图标集的标准做法是给小尺寸
# 单独一档：关装饰、加粗主体，而不是把大图硬缩。
REDUCE_MAX = 24                    # ≤ 此尺寸：关柔光 + 去星芒（不足 1.5px 只会糊成脏点）
LEAN_MAX = 48                      # ≤ 此尺寸：柔光减半 + 星芒略放大（补回被缩掉的视觉重量）


def glow_alpha(size: int) -> float:
    """柔光强度：尺寸越小越收敛，16/24px 直接关掉以保对比度。"""
    if size <= REDUCE_MAX:
        return 0.0
    if size <= LEAN_MAX:
        return 0.16
    return GLOW[3]


def spark_radius(size: int) -> float | None:
    """星芒半径；小尺寸放大到可见，太小时干脆不画。"""
    if size <= REDUCE_MAX:
        return None
    if size <= LEAN_MAX:
        return 0.086
    return SPARK[2]


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def sample_gradient(t: float) -> tuple[int, int, int]:
    for i in range(len(GRADIENT) - 1):
        p0, c0 = GRADIENT[i]
        p1, c1 = GRADIENT[i + 1]
        if p0 <= t <= p1:
            k = 0.0 if p1 == p0 else (t - p0) / (p1 - p0)
            return (
                int(round(lerp(c0[0], c1[0], k))),
                int(round(lerp(c0[1], c1[1], k))),
                int(round(lerp(c0[2], c1[2], k))),
            )
    return GRADIENT[-1][1]


def make_diagonal_gradient(n: int) -> Image.Image:
    """低分辨率生成对角渐变，再放大使用 —— 渐变本身低频，没必要逐像素算。"""
    small = 192
    img = Image.new("RGB", (small, small))
    px = img.load()
    for y in range(small):
        for x in range(small):
            px[x, y] = sample_gradient((x + y) / (2 * (small - 1)))
    return img.resize((n, n), Image.Resampling.BICUBIC)


def make_radial_glow(n: int, peak: int) -> Image.Image:
    small = 192
    img = Image.new("L", (small, small), 0)
    px = img.load()
    cx, cy, r, a = GLOW
    if peak <= 0:
        return img.resize((n, n), Image.Resampling.BICUBIC)
    for y in range(small):
        for x in range(small):
            dx = (x / (small - 1)) - cx
            dy = (y / (small - 1)) - cy
            d = (dx * dx + dy * dy) ** 0.5 / r
            if d >= 1.0:
                continue
            # 平滑衰减（smoothstep 的补），避免出现生硬的圆边
            f = 1.0 - d
            px[x, y] = int(round(peak * a * (f * f * (3 - 2 * f))))
    return img.resize((n, n), Image.Resampling.BICUBIC)


def star_points(cx: float, cy: float, r: float, waist: float) -> list[tuple[float, float]]:
    w = r * waist
    return [
        (cx, cy - r), (cx + w, cy - w), (cx + r, cy), (cx + w, cy + w),
        (cx, cy + r), (cx - w, cy + w), (cx - r, cy), (cx - w, cy - w),
    ]


def render(size: int) -> Image.Image:
    """按归一化几何光栅化一张 size×size 的 RGBA 图标。"""
    S = max(MIN_RASTER, size * SS)
    k = S / 1.0  # 归一化坐标 → 像素

    def P(v: float) -> float:
        return v * k

    # 1) 圆角底板 + 对角渐变
    tile = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, S - 1, S - 1], radius=P(RADIUS_RATIO), fill=255
    )
    tile.paste(make_diagonal_gradient(S).convert("RGBA"), (0, 0), mask)

    # 2) 左上柔光（小尺寸按档位收敛，16/24px 完全略过）
    ga = glow_alpha(size)
    if ga > 0:
        glow = Image.new("RGBA", (S, S), (255, 255, 255, 0))
        glow.putalpha(make_radial_glow(S, 255))
        # 用 alpha 阈值缩放整体强度，保持形状不变
        glow.putalpha(glow.getchannel("A").point(lambda v: int(v * (ga / GLOW[3]))))
        tile = Image.alpha_composite(tile, glow)

    # 3) 新月：外圆挖去偏移内圆（不再叠加斜向高光带 —— 硬边在 256px 下很脏）
    crescent = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(crescent)
    ox, oy, orr = MOON_OUT
    ix, iy, irr = MOON_IN
    d.ellipse(
        [P(ox - orr), P(oy - orr), P(ox + orr), P(oy + orr)],
        fill=255,
    )
    d.ellipse(
        [P(ix - irr), P(iy - irr), P(ix + irr), P(iy + irr)],
        fill=0,
    )
    # 月亮用近白而非纯白：在浅色标题栏上更耐看
    moon = Image.new("RGBA", (S, S), (255, 255, 255, 255))
    tile = Image.alpha_composite(tile, Image.composite(moon, Image.new("RGBA", (S, S), (0, 0, 0, 0)), crescent))

    # 4) 星芒（小尺寸放大以求可见；低于 24px 直接不画）
    sr_eff = spark_radius(size)
    if sr_eff:
        scx, scy, _sr = SPARK
        spark_mask = Image.new("L", (S, S), 0)
        ImageDraw.Draw(spark_mask).polygon(
            [(P(x), P(y)) for x, y in star_points(scx, scy, sr_eff, SPARK_WAIST)],
            fill=255,
        )
        tile = Image.alpha_composite(
            tile, Image.composite(moon, Image.new("RGBA", (S, S), (0, 0, 0, 0)), spark_mask)
        )

    # 5) 裁到圆角之外 & 降采样
    tile.putalpha(Image.composite(tile.getchannel("A"), Image.new("L", (S, S), 0), mask))
    return tile.resize((size, size), Image.Resampling.LANCZOS)


ICON_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <!-- 望舒 · 应用图标（设计源）
       几何与 scripts/make-icons.py 保持一致：改这里务必同步改脚本再重跑。
       含义：夜色的圆角画板 + 新月（望舒为月御）+ 星芒（灵感）。
       本 SVG 描述的是「标准档」（≥64px）。16/24/32/48px 由脚本按档位自动简化
       （关柔光、放大或省略星芒），因为 16px 下白月压浅蓝底只有 2.4:1 对比度。 -->
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7FB2FF"/>
      <stop offset="0.48" stop-color="#4C8DFF"/>
      <stop offset="1" stop-color="#8858F6"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.30" cy="0.235" r="0.82">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.30"/>
      <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
    <mask id="crescent">
      <circle cx="244.7" cy="262.1" r="121.9" fill="#FFFFFF"/>
      <circle cx="310.3" cy="214.0" r="106.5" fill="#000000"/>
    </mask>
    <clipPath id="tileClip">
      <rect x="0" y="0" width="512" height="512" rx="114.1"/>
    </clipPath>
  </defs>

  <g clip-path="url(#tileClip)">
    <rect width="512" height="512" fill="url(#tile)"/>
    <rect width="512" height="512" fill="url(#glow)"/>
    <rect width="512" height="512" fill="#FFFFFF" mask="url(#crescent)"/>
    <polygon
      points="361.5,131.6 367.2,159.2 394.8,164.9 367.2,170.5 361.5,198.2 355.8,170.5 328.2,164.9 355.8,159.2"
      fill="#FFFFFF"/>
  </g>
</svg>
"""


def main() -> int:
    BUILD.mkdir(parents=True, exist_ok=True)
    ICONS.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)

    sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
    rendered: dict[int, Image.Image] = {}
    for s in sizes:
        img = render(s)
        rendered[s] = img
        if s != 1024:
            img.save(ICONS / f"{s}x{s}.png")
        print(f"  rendered {s}x{s}")

    master = rendered[1024]
    master.save(BUILD / "icon.png")
    print(f"  -> {BUILD / 'icon.png'}")

    # Windows ICO：优先塞入我们自己按尺寸渲染的位图，避免 Pillow 内部缩放
    ico_sizes = [16, 24, 32, 48, 64, 128, 256]
    ico_path = BUILD / "icon.ico"
    try:
        master.save(
            ico_path,
            format="ICO",
            sizes=[(s, s) for s in ico_sizes],
            append_images=[rendered[s] for s in ico_sizes],
        )
        print(f"  -> {ico_path} (多尺寸: {ico_sizes})")
    except Exception as exc:  # noqa: BLE001
        print(f"  ! append_images 不可用（{exc}），回退为由 256 主图派生")
        rendered[256].save(ico_path, format="ICO", sizes=[(s, s) for s in ico_sizes])

    rendered[64].save(PUBLIC / "favicon.png")
    print(f"  -> {PUBLIC / 'favicon.png'}")
    (BUILD / "icon.svg").write_text(ICON_SVG, encoding="utf-8")
    print(f"  -> {BUILD / 'icon.svg'}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
