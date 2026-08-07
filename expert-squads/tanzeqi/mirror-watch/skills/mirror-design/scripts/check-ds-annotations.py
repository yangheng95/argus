#!/usr/bin/env python3
"""
Design System 溯源注释覆盖校验

对账 pre-flight 组件清单与 HTML 中实际出现的 <!-- DS: X --> 注释，
报告缺失（声明了但没标注）和多余（标注了但没声明）的组件。

用法：
  # 清单用逗号分隔直接传入
  python check-ds-annotations.py page.html --components "Button (Primary),Card,Tabs"

  # 或从清单文件读取（每行一个组件名，# 开头为注释）
  python check-ds-annotations.py page.html --components-file preflight-components.txt

退出码：0 = 全覆盖；1 = 有缺失/多余；2 = 用法错误
"""
import argparse
import re
import sys
from pathlib import Path

# 匹配 <!-- DS: 组件名 -->，组件名两侧空白会被裁剪
DS_RE = re.compile(r"<!--\s*DS:\s*(.+?)\s*-->")


def normalize(name: str) -> str:
    """大小写不敏感 + 折叠内部多余空白，用于对账比较"""
    return re.sub(r"\s+", " ", name.strip()).lower()


def parse_components(args) -> list[str]:
    if args.components_file:
        lines = Path(args.components_file).read_text(encoding="utf-8").splitlines()
        items = [ln.strip() for ln in lines]
        items = [ln for ln in items if ln and not ln.startswith("#")]
    else:
        items = [c.strip() for c in args.components.split(",")]
    return [c for c in items if c]


def main() -> int:
    ap = argparse.ArgumentParser(description="校验 DS 溯源注释覆盖")
    ap.add_argument("html", help="待校验的 HTML 文件")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--components", help="pre-flight 组件清单，逗号分隔")
    g.add_argument("--components-file", help="组件清单文件，每行一个")
    args = ap.parse_args()

    html_path = Path(args.html)
    if not html_path.exists():
        print(f"✗ 文件不存在: {html_path}", file=sys.stderr)
        return 2

    declared = parse_components(args)
    if not declared:
        print("✗ pre-flight 组件清单为空", file=sys.stderr)
        return 2

    html = html_path.read_text(encoding="utf-8")
    annotated_raw = DS_RE.findall(html)

    declared_map = {normalize(c): c for c in declared}
    annotated_map = {}
    for a in annotated_raw:
        annotated_map.setdefault(normalize(a), a)

    declared_keys = set(declared_map)
    annotated_keys = set(annotated_map)

    missing = sorted(declared_map[k] for k in declared_keys - annotated_keys)
    extra = sorted(annotated_map[k] for k in annotated_keys - declared_keys)
    covered = sorted(declared_map[k] for k in declared_keys & annotated_keys)

    print(f"声明组件 {len(declared_keys)} 个，已标注 {len(covered)} 个")
    for c in covered:
        print(f"  ✓ {c}")

    if missing:
        print(f"\n缺失溯源注释（声明了但 HTML 中无 <!-- DS: --> 标注）：{len(missing)} 个")
        for c in missing:
            print(f"  ✗ {c}")

    if extra:
        print(f"\n未在 pre-flight 声明的注释（请补声明或核对组件名）：{len(extra)} 个")
        for c in extra:
            print(f"  ! {c}")

    if missing or extra:
        print("\n结果：未通过 — 请补全缺失注释、核对组件名拼写后重跑")
        return 1

    print("\n结果：通过 — pre-flight 清单全部覆盖")
    return 0


if __name__ == "__main__":
    sys.exit(main())
