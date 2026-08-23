#!/usr/bin/env python3
"""两仓同步脚本：把技能仓库 jinhucoco/insar-genie 的脚本同步到插件 assets，并校验 MD5 一致。

约定：
  - 脚本唯一源 = 技能仓库 jinhucoco/insar-genie 的 scripts/ + experiment/ + SKILL.md（根）
  - 插件 assets/ 是这些脚本的发布副本（随包携带）
  - 改脚本必须先改技能仓库，再跑本脚本同步到 assets，否则两仓漂移

映射：
  <skill_repo>/scripts/*       ->  <plugin>/assets/scripts/*
  <skill_repo>/experiment/*    ->  <plugin>/assets/experiment/*
  <skill_repo>/SKILL.md        ->  <plugin>/assets/SKILL.md

用法（在插件 repo 根执行）：
  python scripts/sync_assets.py              # 校验：报告不一致/缺失，不改动
  python scripts/sync_assets.py --sync       # 同步：从技能仓库复制到 assets（+ 打印差异）
  python scripts/sync_assets.py --skill-repo <path>   # 指定技能仓库路径（默认可自动探测）
"""
import argparse
import hashlib
import os
import shutil
import sys
from pathlib import Path

# 映射：插件 assets 下的相对路径 <- 技能仓库下的相对路径
MAPPING = [
    ("scripts", "scripts"),
    ("experiment", "experiment"),
    ("SKILL.md", "SKILL.md"),
]

def md5(p: Path) -> str:
    """内容 MD5：读取文本后规范化换行符（忽略 CRLF/LF 差异），避免跨平台误报。"""
    h = hashlib.md5()
    # 读文本，统一转成 \n 后再 hash（批处理/py 在 Windows=CRLF，Linux=LF）
    try:
        text = p.read_text(encoding="utf-8", errors="replace")
    except Exception:
        text = p.read_bytes().decode("utf-8", errors="replace")
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    h.update(normalized.encode("utf-8"))
    return h.hexdigest()

# Windows 终端默认 GBK，emoji/特殊字符会 UnicodeEncodeError，强制 utf-8 输出
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

def find_skill_repo(cwd: Path) -> Path | None:
    """自动探测技能仓库：从插件 repo 的 git remote 或常见位置找 jinhucoco/insar-genie。"""
    # 1) cwd 的父目录是否有 insar-genie 技能仓库
    for cand in (cwd.parent / "insar-genie", cwd.parent.parent / "insar-genie"):
        if (cand / "SKILL.md").exists() and (cand / "scripts").exists():
            return cand
    return None

def walk_relative(src: Path, base: Path):
    """递归列出 src 下的所有普通文件（相对 base 路径，用 os.path.relpath 兼容跨盘符号）。"""
    for root, _dirs, files in os.walk(src):
        for f in files:
            fp = Path(root) / f
            # 排除 __pycache__ / .pyc
            if "__pycache__" in fp.parts or fp.suffix == ".pyc":
                continue
            rel = os.path.relpath(fp, base)
            yield Path(rel)

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--sync", action="store_true", help="从技能仓库同步（复制）到 assets，而非仅校验")
    ap.add_argument("--skill-repo", type=Path, help="指定技能仓库路径（默认自动探测）")
    args = ap.parse_args()

    plugin_root = Path(__file__).resolve().parent.parent  # 插件 repo 根
    skill_root = args.skill_repo or find_skill_repo(plugin_root)
    if not skill_root:
        print("[X] 未找到技能仓库 jinhucoco/insar-genie，用 --skill-repo <path> 指定", file=sys.stderr)
        return 1

    print(f"  技能仓库: {skill_root}")
    print(f"  插件仓库: {plugin_root}\n")

    diffs = []
    for dest_rel, src_rel in MAPPING:
        src_base = skill_root / src_rel
        dest_base = plugin_root / "assets" / dest_rel
        if not src_base.exists():
            print(f"  [skip] 技能仓库无 {src_rel}，跳过") 
            continue
        # 遍历技能仓库源所有文件（walk_relative 返回相对 src_base 的路径）
        for src_file in walk_relative(src_base, src_base):
            rel = src_file  # 已是相对路径
            dest_file = dest_base / rel
            # 技能仓库里的路径，对应到 dest rel 前缀
            full_src = src_base / rel
            if not dest_file.exists():
                diffs.append((full_src, dest_file, "MISSING"))
            elif md5(full_src) != md5(dest_file):
                diffs.append((full_src, dest_file, "DIFF"))

    if not diffs:
        print("✅ 全部一致：插件 assets 与技能仓库脚本无漂移")
        return 0

    print(f"⚠️  发现 {len(diffs)} 处不一致/缺失：\n")
    for src, dest, kind in diffs:
        print(f"  [{kind}] {os.path.relpath(src, skill_root)}")
        print(f"         -> {os.path.relpath(dest, plugin_root)}")

    if not args.sync:
        print("\n提示: 用 --sync 从技能仓库同步覆盖到 assets")
        return 1

    print("\n--- 同步中 ---")
    synced = 0
    for src, dest, _kind in diffs:
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        synced += 1
        print(f"  ✓ {os.path.relpath(src, skill_root)}")
    print(f"\n✅ 已同步 {synced} 个文件到插件 assets")

    # 校验同步后是否一致
    remain = 0
    for dest_rel, src_rel in MAPPING:
        src_base = skill_root / src_rel
        dest_base = plugin_root / "assets" / dest_rel
        if not src_base.exists():
            continue
        for src_file in walk_relative(src_base, src_base):
            rel = src_file  # 已是相对路径
            dest_file = dest_base / rel
            if not dest_file.exists() or md5(dest_file) != md5(src_base / rel):
                remain += 1
    if remain:
        print(f"⚠️  同步后仍有 {remain} 处不一致（检查技能仓库是否有未 copy 的目录）")
        return 1
    print("✅ 同步后校验通过，两仓一致")
    return 0

if __name__ == "__main__":
    sys.exit(main())
