#!/usr/bin/env python3
"""Собирает cards/ и cards.json из исходных .dc.html.

Использование:
    python build.py                 # берёт *.dc.html из папки incoming/
    python build.py путь/к/папке    # или из указанной папки (можно несколько)

Что делает:
  * из каждого .dc.html вырезает корневой <div style="width: 390px; height: 844px ...">
    со всем содержимым и <style> из <helmet> (без <link> на Google Fonts,
    без support.js и обёртки <x-dc>);
  * пишет фрагмент в cards/NN.html (NN — номер карточки);
  * добавляет или обновляет запись в cards.json (id, group, title, who, rel, file).

Исходные файлы не изменяются. Записи cards.json, которых нет в источниках,
сохраняются, поэтому новую карточку можно добавить, не пересобирая старые.
Группу можно поменять руками в cards.json — при пересборке она не перезапишется.
"""
import html
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CARDS_DIR = ROOT / "cards"
CARDS_JSON = ROOT / "cards.json"
DEFAULT_SRC = ROOT / "incoming"

DEFAULT_GROUPS = [
    {"id": "river", "name": "Блефы ривера"},
    {"id": "overfold", "name": "Перефолды"},
]

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link",
        "meta", "source", "track", "wbr"}


class RootDivFinder(HTMLParser):
    """Находит границы корневого div карточки (по width: 390px; height: 844px)."""

    def __init__(self, text):
        super().__init__(convert_charrefs=False)
        self.text = text
        self.line_offsets = [0]
        for line in text.splitlines(keepends=True):
            self.line_offsets.append(self.line_offsets[-1] + len(line))
        self.start = None
        self.end = None
        self.depth = 0

    def _pos(self):
        line, col = self.getpos()
        return self.line_offsets[line - 1] + col

    def handle_starttag(self, tag, attrs):
        if self.end is not None or tag in VOID:
            return
        if self.start is None:
            style = dict(attrs).get("style") or ""
            if tag == "div" and re.search(r"width:\s*390px", style) and re.search(r"height:\s*844px", style):
                self.start = self._pos()
                self.depth = 1
        else:
            self.depth += 1

    def handle_endtag(self, tag):
        if self.start is None or self.end is not None or tag in VOID:
            return
        self.depth -= 1
        if self.depth == 0:
            pos = self._pos()
            self.end = self.text.index(">", pos) + 1


def extract(text):
    finder = RootDivFinder(text)
    finder.feed(text)
    if finder.start is None or finder.end is None:
        raise ValueError("не найден корневой div 390×844")
    root = text[finder.start:finder.end]
    helmet = re.search(r"<helmet>(.*?)</helmet>", text, re.S)
    styles = re.findall(r"<style[^>]*>.*?</style>", helmet.group(1) if helmet else "", re.S)
    return root, styles


def strip_tags(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s)).strip()


def meta_from_html(text, root):
    title_tag = re.search(r"<title>(.*?)</title>", text, re.S)
    name = strip_tags(title_tag.group(1)) if title_tag else ""
    h1 = re.search(r"<h1[^>]*>(.*?)</h1>", root, re.S)
    rel = re.search(r"Надёжность\s*([ABC])", root)
    # первая строка карточки: [тип банка] [кто] [надёжность]
    head = re.search(r"<div[^>]*>(.*?)</div>", root[root.index(">") + 1:], re.S)
    spans = re.findall(r"<span[^>]*>(.*?)</span>", head.group(1), re.S) if head else []
    who = strip_tags(spans[1]) if len(spans) > 1 else ""
    return {
        "name": name,
        "title": strip_tags(h1.group(1)) if h1 else name,
        "who": who,
        "rel": rel.group(1) if rel else "",
    }


def card_id(path, name):
    m = re.search(r"(\d+)\.dc\.html$", path.name) or re.match(r"\s*(\d+)", name)
    if not m:
        raise ValueError(f"не удалось определить номер карточки: {path.name}")
    return f"{int(m.group(1)):02d}"


def guess_group(name):
    return "river" if "блеф" in name.lower() else "overfold"


def main(argv):
    sources = [Path(a) for a in argv] or [DEFAULT_SRC]
    files = []
    for src in sources:
        if src.is_file():
            files.append(src)
        elif src.is_dir():
            files.extend(sorted(src.glob("*.dc.html")))
        else:
            print(f"нет такого пути: {src}", file=sys.stderr)
    if CARDS_JSON.exists():
        data = json.loads(CARDS_JSON.read_text(encoding="utf-8"))
    else:
        data = {"groups": DEFAULT_GROUPS, "cards": []}
    data.setdefault("groups", DEFAULT_GROUPS)
    by_id = {c["id"]: c for c in data.get("cards", [])}

    CARDS_DIR.mkdir(exist_ok=True)
    for path in files:
        text = path.read_text(encoding="utf-8")
        root, styles = extract(text)
        meta = meta_from_html(text, root)
        cid = card_id(path, meta["name"])
        out = CARDS_DIR / f"{cid}.html"
        out.write_text("\n".join(styles + [root]) + "\n", encoding="utf-8", newline="\n")
        prev = by_id.get(cid, {})
        by_id[cid] = {
            "id": cid,
            "group": prev.get("group") or guess_group(meta["name"]),
            "title": meta["title"],
            "name": meta["name"],
            "who": meta["who"],
            "rel": meta["rel"],
            "file": f"cards/{cid}.html",
        }
        print(f"{path.name} -> {out.relative_to(ROOT).as_posix()}  [{by_id[cid]['group']}, {meta['rel']}] {meta['title']}")

    data["cards"] = [by_id[k] for k in sorted(by_id)]
    CARDS_JSON.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(f"cards.json: {len(data['cards'])} карточек")


if __name__ == "__main__":
    main(sys.argv[1:])
