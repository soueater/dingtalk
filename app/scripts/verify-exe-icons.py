"""scripts/verify-exe-icons.py —— 核验 exe 内嵌图标的档位是否齐全。

为什么需要它：
  icons 生成对了、package.json 里 win.icon 也写了，仍然可能因为路径写错或
  rcedit 失败而让 exe 用上 Electron 默认图标 —— 那是「肉眼看构建日志永远发现不了」
  的静默失败。本脚本直接解析 PE 资源目录，断言 RT_GROUP_ICON 存在且
  RT_ICON 覆盖 16/24/32/48/64/128/256 全部档位。

纯 Python 实现（不依赖 .NET / Pillow / Win32 回调），只读文件字节。

用法：
  python scripts/verify-exe-icons.py out/artifacts/win-unpacked/望舒.exe \
                                     "out/artifacts/望舒 Setup 1.1.0.exe" \
                                     out/artifacts/望舒-1.1.0-portable.exe
"""
import struct
import sys

RT_ICON = 3
RT_GROUP_ICON = 14
# electron-builder 的 win.icon 应内嵌的全部档位（与 make-icons.py 的 ico_sizes 对齐）
REQUIRED = (16, 24, 32, 48, 64, 128, 256)


def rva_to_off(sections, rva):
    for va, vsize, rawptr, rawsize in sections:
        span = max(vsize, rawsize)
        if va <= rva < va + span:
            return rva - va + rawptr
    return None


def parse(path):
    data = open(path, "rb").read()
    if data[:2] != b"MZ":
        return None, "不是 PE 文件"
    e_lfanew = struct.unpack_from("<I", data, 0x3C)[0]
    if data[e_lfanew : e_lfanew + 4] != b"PE\0\0":
        return None, "PE 签名缺失"
    coff = e_lfanew + 4
    nsec = struct.unpack_from("<H", data, coff + 2)[0]
    opt_size = struct.unpack_from("<H", data, coff + 16)[0]
    opt = coff + 20
    magic = struct.unpack_from("<H", data, opt)[0]
    dd_off = opt + (112 if magic == 0x20B else 96)
    res_rva, res_size = struct.unpack_from("<II", data, dd_off + 2 * 8)
    sec_off = opt + opt_size
    sections = []
    for i in range(nsec):
        base = sec_off + i * 40
        vsize, va, rawsize, rawptr = struct.unpack_from("<IIII", data, base + 8)
        sections.append((va, vsize, rawptr, rawsize))
    if res_rva == 0:
        return None, "无资源段"
    res_base = rva_to_off(sections, res_rva)
    if res_base is None:
        return None, "资源段 RVA 不可映射"

    def read_dir(off):
        n_named, n_id = struct.unpack_from("<HH", data, off + 12)
        entries = []
        for i in range(n_named + n_id):
            e = off + 16 + i * 8
            name, off_to = struct.unpack_from("<II", data, e)
            entries.append((name & 0x7FFFFFFF, off_to))
        return entries

    found = {"groups": 0, "icons": 0, "sizes": []}
    for type_id, off_to in read_dir(res_base):
        if type_id not in (RT_GROUP_ICON, RT_ICON):
            continue
        sub = res_base + (off_to & 0x7FFFFFFF)
        for _name, off2 in read_dir(sub):
            sub2 = res_base + (off2 & 0x7FFFFFFF)
            for _lang, off3 in read_dir(sub2):
                ent = res_base + off3
                blob_rva, blob_size = struct.unpack_from("<II", data, ent)
                blob_off = rva_to_off(sections, blob_rva)
                if blob_off is None:
                    continue
                if type_id == RT_GROUP_ICON:
                    found["groups"] += 1
                    if blob_size >= 6:
                        _, _, count = struct.unpack_from("<HHH", data, blob_off)
                        for k in range(count):
                            o = blob_off + 6 + k * 14
                            if o + 14 > blob_off + blob_size:
                                break
                            w, h = struct.unpack_from("<BB", data, o)
                            found["sizes"].append(w or 256)
                else:
                    found["icons"] += 1
    found["sizes"] = sorted(set(found["sizes"]))
    return found, None


def expand(args):
    """参数既可以是 exe 文件，也可以是产物目录 —— 目录会自动展开为
    顶层 *.exe + win-unpacked/*.exe，跳过 `_` 开头的中间目录与 Electron 自带的 elevate.exe。"""
    import os

    out = []
    for a in args:
        if os.path.isdir(a):
            for d, dirs, files in os.walk(a):
                dirs[:] = [x for x in dirs if not x.startswith("_")]
                for f in files:
                    if f.lower().endswith(".exe") and f.lower() != "elevate.exe":
                        out.append(os.path.join(d, f))
        else:
            out.append(a)
    return out


def main():
    targets = expand(sys.argv[1:])
    if not targets:
        print("用法：python scripts/verify-exe-icons.py <exe 或产物目录> ...")
        return 2
    rc = 0
    for p in targets:
        info, err = parse(p)
        name = p.replace("\\", "/").split("/")[-1]
        if err:
            print(f"  {name}: {err}")
            rc = 1
            continue
        ok = info["groups"] >= 1 and set(REQUIRED) <= set(info["sizes"])
        print(
            f"  {'OK ' if ok else 'BAD'} {name}: "
            f"RT_GROUP_ICON={info['groups']} RT_ICON={info['icons']} 尺寸={info['sizes']}"
        )
        if not ok:
            rc = 1
    return rc


if __name__ == "__main__":
    sys.exit(main())
