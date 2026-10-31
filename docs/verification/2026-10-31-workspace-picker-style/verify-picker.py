"""
Browser checks for the workspace node picker, driven through the real component.

Usage: python docs/verification/2026-10-31-workspace-picker-style/verify-picker.py

The page (preview.html) renders the production `WorkspaceNodeChooser` with mock
node data. Every assertion below exercises production markup, CSS and handlers;
only node fixtures, the three icon glyphs and the host --dsw-* tokens are mocked.
Screenshots are written next to this script.
"""

import json
import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
PAGE = (HERE / "preview.html").as_uri()
FAILURES: list[str] = []
CHECKS: list[dict] = []


def check(name: str, ok: bool, detail: object = None) -> None:
    CHECKS.append({"check": name, "ok": bool(ok), "detail": detail})
    if not ok:
        FAILURES.append(f"{name}: {detail}")


def open_picker(page) -> None:
    page.locator("button[aria-label='切换工作节点']").click()
    page.wait_for_selector("[role=dialog]")


def close_picker(page) -> None:
    if page.locator("[role=dialog]").count():
        page.keyboard.press("Escape")
        page.wait_for_selector("[role=dialog]", state="detached")


def dump(page) -> dict:
    return page.evaluate(
        """() => {
          const pop = document.querySelector('[role=dialog]');
          const cs = el => getComputedStyle(el);
          const rows = [...pop.querySelectorAll('[data-browse-option]')];
          const local = rows.find(r => r.textContent.startsWith('本地'));
          const remote = rows.find(r => r.title);
          const text = remote.firstElementChild;
          const name = text.children[0];
          const meta = text.children[1];
          const id = meta.lastElementChild;
          const tag = [...remote.children].find(c => c.textContent === '当前会话');
          const tick = remote.lastElementChild;
          const search = pop.querySelector('input');
          const refresh = pop.querySelector('button:not([data-browse-option])');
          const refreshIcon = refresh.querySelector('svg');
          const footer = refresh.parentElement;
          const box = search.nextElementSibling;
          const pr = pop.getBoundingClientRect();
          const describe = el => ({
            fontSize: cs(el).fontSize, fontWeight: cs(el).fontWeight, lineHeight: cs(el).lineHeight,
            padding: cs(el).padding, gap: cs(el).gap, marginTop: cs(el).marginTop,
            borderRadius: cs(el).borderRadius, backgroundColor: cs(el).backgroundColor,
            color: cs(el).color, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height,
            textOverflow: cs(el).textOverflow, whiteSpace: cs(el).whiteSpace,
            scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
          });
          return {
            popup: {
              x: pr.x, y: pr.y, width: pr.width, height: pr.height, right: pr.right, bottom: pr.bottom,
              padding: cs(pop).padding, borderRadius: cs(pop).borderRadius,
              borderTopWidth: cs(pop).borderTopWidth, backgroundColor: cs(pop).backgroundColor,
              boxShadow: cs(pop).boxShadow, maxHeight: cs(pop).maxHeight,
              scrollWidth: pop.scrollWidth, clientWidth: pop.clientWidth,
            },
            search: { ...describe(search), marginBottom: cs(search).marginBottom,
              borderTopColor: cs(search).borderTopColor, boxShadow: cs(search).boxShadow },
            local: { ...describe(local), marginBottom: cs(local).marginBottom, selected: local.dataset.selected, pressed: local.getAttribute('aria-pressed') },
            remote: { ...describe(remote), selected: remote.dataset.selected, pressed: remote.getAttribute('aria-pressed'), title: remote.title },
            name: describe(name),
            meta: describe(meta),
            id: describe(id),
            tag: tag ? { ...describe(tag), text: tag.textContent } : null,
            tick: { width: tick.getBoundingClientRect().width, height: tick.getBoundingClientRect().height },
            refresh: { ...describe(refresh) },
            refreshIcon: refreshIcon ? { width: refreshIcon.getBoundingClientRect().width, height: refreshIcon.getBoundingClientRect().height } : null,
            footer: { borderTopWidth: cs(footer).borderTopWidth, marginTop: cs(footer).marginTop, paddingTop: cs(footer).paddingTop },
            optionNames: rows.map(r => r.title ? r.title.split(' · ')[0] : '本地'),
            optionsBox: { scrollHeight: box.scrollHeight, clientHeight: box.clientHeight, overflowY: cs(box).overflowY },
            searchTop: search.getBoundingClientRect().top,
            refreshBottom: refresh.getBoundingClientRect().bottom,
            activeTag: document.activeElement?.tagName,
          };
        }"""
    )


def dump_row(page, title_prefix: str) -> dict:
    return page.evaluate(
        """(prefix) => {
          const pop = document.querySelector('[role=dialog]');
          const row = [...pop.querySelectorAll('[data-browse-option]')].find(r => r.title && r.title.startsWith(prefix));
          const text = row.firstElementChild;
          const name = text.children[0];
          const meta = text.children[1];
          const id = meta.lastElementChild;
          const cs = getComputedStyle;
          const r = row.getBoundingClientRect();
          return {
            rowHeight: r.height,
            name: { scrollWidth: name.scrollWidth, clientWidth: name.clientWidth, textOverflow: cs(name).textOverflow },
            id: { scrollWidth: id.scrollWidth, clientWidth: id.clientWidth, textOverflow: cs(id).textOverflow },
            tag: [...row.children].some(c => c.textContent === '当前会话'),
            tick: row.lastElementChild.getBoundingClientRect().width,
            popup: { scrollWidth: pop.scrollWidth, clientWidth: pop.clientWidth },
          };
        }""",
        title_prefix,
    )


def screenshot(page, name: str) -> None:
    # The right-hand column is preview chrome, not the picker; hide it so the image
    # shows the sidebar context and the popover only.
    page.evaluate("document.querySelector('main').style.display = 'none'")
    sidebar = page.locator(".sidebar").bounding_box()
    popup = page.locator("[role=dialog]").bounding_box()
    viewport = page.viewport_size
    assert sidebar is not None and popup is not None and viewport is not None
    top = max(0, sidebar["y"] - 8)
    clip = {
        "x": 0,
        "y": top,
        "width": min(viewport["width"], popup["x"] + popup["width"] + 32),
        "height": min(viewport["height"] - top, popup["y"] + popup["height"] - top + 24),
    }
    page.screenshot(path=str(HERE / name), clip=clip)
    page.evaluate("document.querySelector('main').style.display = ''")


def main() -> int:
    with sync_playwright() as p:
        # A locally installed Chromium can be pointed at explicitly when the Python
        # package expects a newer build than the one already on the machine.
        executable = os.environ.get("PICKER_CHROMIUM")
        browser = p.chromium.launch(executable_path=executable) if executable else p.chromium.launch()
        page = browser.new_page(viewport={"width": 900, "height": 700}, device_scale_factor=2)
        page.goto(PAGE)
        page.wait_for_selector("button[aria-label='切换工作节点']")

        # A — design scene: only the eligible node is offered, selected and current.
        open_picker(page)
        s = dump(page)
        check("popup width 400", abs(s["popup"]["width"] - 400) < 0.5, s["popup"]["width"])
        check("popup padding 8 / radius 12 / border 1", (s["popup"]["padding"], s["popup"]["borderRadius"], s["popup"]["borderTopWidth"]) == ("8px", "12px", "1px"), [s["popup"]["padding"], s["popup"]["borderRadius"], s["popup"]["borderTopWidth"]])
        check("popup shadow layered", "0px 16px 40px" in s["popup"]["boxShadow"] and "0px 3px 8px" in s["popup"]["boxShadow"], s["popup"]["boxShadow"])
        check("search 38px / radius 7 / 13px", (s["search"]["height"], s["search"]["borderRadius"], s["search"]["fontSize"], s["search"]["lineHeight"]) == (38, "7px", "13px", "20px"), {k: s["search"][k] for k in ("height", "borderRadius", "fontSize", "lineHeight")})
        check("search margins 2/2/8", (s["search"]["marginTop"], s["search"]["marginBottom"]) == ("2px", "8px"), [s["search"]["marginTop"], s["search"]["marginBottom"]])
        check("search shows focus border", s["search"]["boxShadow"] != "none", s["search"]["boxShadow"])
        check("local row 42 / 14px", (s["local"]["height"], s["local"]["fontSize"]) == (42, "14px"), [s["local"]["height"], s["local"]["fontSize"]])
        check("local row padding 11 12 / gap 3", (s["local"]["padding"], s["local"]["marginBottom"]) == ("11px 12px", "3px"), [s["local"]["padding"], s["local"]["marginBottom"]])
        check("remote row >=66 / radius 7 / gap 12", s["remote"]["height"] >= 66 and s["remote"]["borderRadius"] == "7px" and s["remote"]["gap"] == "12px", [s["remote"]["height"], s["remote"]["borderRadius"], s["remote"]["gap"]])
        check("remote row padding 11 12", s["remote"]["padding"] == "11px 12px", s["remote"]["padding"])
        check("name 14/500/21", (s["name"]["fontSize"], s["name"]["fontWeight"], s["name"]["lineHeight"]) == ("14px", "500", "21px"), [s["name"]["fontSize"], s["name"]["fontWeight"], s["name"]["lineHeight"]])
        check("meta 11/18, gap 5, offset 2", (s["meta"]["fontSize"], s["meta"]["lineHeight"], s["meta"]["gap"], s["meta"]["marginTop"]) == ("11px", "18px", "5px", "2px"), [s["meta"]["fontSize"], s["meta"]["lineHeight"], s["meta"]["gap"], s["meta"]["marginTop"]])
        check("tag 11 / 2x5 / radius 4 / nowrap", s["tag"] is not None and (s["tag"]["fontSize"], s["tag"]["padding"], s["tag"]["borderRadius"], s["tag"]["whiteSpace"]) == ("11px", "2px 5px", "4px", "nowrap"), s["tag"])
        check("tick 14x14 slot", s["tick"] == {"width": 14, "height": 14}, s["tick"])
        check("footer divider 1px + 8/5 spacing", (s["footer"]["borderTopWidth"], s["footer"]["marginTop"], s["footer"]["paddingTop"]) == ("1px", "8px", "5px"), s["footer"])
        check("refresh 9x12 / 12px / radius 6 / gap 8", (s["refresh"]["padding"], s["refresh"]["fontSize"], s["refresh"]["borderRadius"], s["refresh"]["gap"]) == ("9px 12px", "12px", "6px", "8px"), [s["refresh"]["padding"], s["refresh"]["fontSize"], s["refresh"]["borderRadius"], s["refresh"]["gap"]])
        check("refresh icon 13x13", s["refreshIcon"] == {"width": 13, "height": 13}, s["refreshIcon"])
        check("only local + office1 offered", s["optionNames"] == ["本地", "office1"], s["optionNames"])
        check("office1 selected with fill", s["remote"]["selected"] == "true" and s["remote"]["backgroundColor"] != "rgba(0, 0, 0, 0)", s["remote"]["backgroundColor"])
        check("local not selected", s["local"]["selected"] == "false", s["local"]["selected"])
        check("selected state exposed as aria-pressed", (s["remote"]["pressed"], s["local"]["pressed"]) == ("true", "false"), [s["remote"]["pressed"], s["local"]["pressed"]])
        check("current-session tag on office1", s["tag"] is not None and s["tag"]["text"] == "当前会话", s["tag"])
        check("no popup horizontal overflow", s["popup"]["scrollWidth"] <= s["popup"]["clientWidth"] + 1, [s["popup"]["scrollWidth"], s["popup"]["clientWidth"]])
        check("input focused on open", s["activeTag"] == "INPUT", s["activeTag"])
        screenshot(page, "picker-default.png")

        # B — search and no-match.
        page.fill("[role=dialog] input", "office")
        check("search matches office1 only", page.locator("[role=dialog] [data-browse-option]").count() == 1 and page.locator("[role=dialog] [data-browse-option]").first.get_attribute("title").startswith("office1"), page.locator("[role=dialog] [data-browse-option]").all_text_contents())
        page.fill("[role=dialog] input", "  OFFICE  ")
        check("search is trimmed and case-insensitive", page.locator("[role=dialog] [data-browse-option]").count() == 1, page.locator("[role=dialog] [data-browse-option]").all_text_contents())
        page.fill("[role=dialog] input", "lab")
        check("offline node is not searchable", page.locator("[role=dialog] [data-browse-option]").count() == 0, page.locator("[role=dialog] [data-browse-option]").all_text_contents())
        page.fill("[role=dialog] input", "revoked")
        check("revoked node is not searchable", page.locator("[role=dialog] [data-browse-option]").count() == 0, page.locator("[role=dialog] [data-browse-option]").all_text_contents())
        page.fill("[role=dialog] input", "office")
        screenshot(page, "picker-search.png")
        page.fill("[role=dialog] input", "")
        close_picker(page)

        # C — selection switches the scope and returns focus to the trigger.
        open_picker(page)
        page.locator("[role=dialog] [data-browse-option]").first.click()
        page.wait_for_selector("[role=dialog]", state="detached")
        check("choosing local closes and returns focus", page.evaluate("document.activeElement?.getAttribute('aria-label')") == "切换工作节点", page.evaluate("document.activeElement?.tagName"))
        check("scope switched to local", page.locator("[data-scope]").text_content() == '{"kind":"local"}', page.locator("[data-scope]").text_content())
        open_picker(page)
        s = dump(page)
        check("local selected, office1 not selected", s["local"]["selected"] == "true" and s["remote"]["selected"] == "false", [s["local"]["selected"], s["remote"]["selected"]])
        check("aria-pressed follows the browse scope", (s["local"]["pressed"], s["remote"]["pressed"]) == ("true", "false"), [s["local"]["pressed"], s["remote"]["pressed"]])
        check("local row gets the selected fill", s["local"]["backgroundColor"] != "rgba(0, 0, 0, 0)", s["local"]["backgroundColor"])
        check("current-session tag stays on office1", s["tag"] is not None, s["tag"])
        page.locator("[role=dialog] [data-browse-option]").nth(1).click()
        page.wait_for_selector("[role=dialog]", state="detached")
        check("scope switches back to office1", '"node-2d78325c8c0ec940a080aafee4e5b4c6"' in page.locator("[data-scope]").text_content(), page.locator("[data-scope]").text_content())

        # D — browsing scope and current session can differ.
        page.get_by_role("button", name="多节点滚动").click()
        page.get_by_role("button", name="当前会话在 office2").click()
        open_picker(page)
        s = dump(page)
        check("browsing row stays selected", s["remote"]["selected"] == "true", s["remote"]["selected"])
        office2 = page.locator("[role=dialog] [data-browse-option]", has_text="office2")
        check("current-session tag moved to office2", office2.locator("text=当前会话").count() == 1, office2.text_content())
        check("browsing row has no tag", "当前会话" not in s["remote"]["title"] and s["tag"] is None, [s["remote"]["title"], s["tag"]])
        screenshot(page, "picker-current-session-mismatch.png")
        close_picker(page)
        page.get_by_role("button", name="当前会话在 office2").click()

        # E — long name and long ID ellipsize inside their own columns.
        page.get_by_role("button", name="长名称 / 长 ID").click()
        open_picker(page)
        long_row = dump_row(page, "a-very-long-remote-node-name")
        check("long name ellipsizes", long_row["name"]["scrollWidth"] > long_row["name"]["clientWidth"] and long_row["name"]["textOverflow"] == "ellipsis", long_row["name"])
        check("long ID ellipsizes in its column", long_row["id"]["scrollWidth"] > long_row["id"]["clientWidth"] and long_row["id"]["textOverflow"] == "ellipsis", long_row["id"])
        check("long row keeps its 14px tick slot", long_row["tick"] == 14, long_row["tick"])
        check("long row keeps the 66px minimum height", long_row["rowHeight"] >= 66, long_row["rowHeight"])
        check("long rows keep popup inside viewport", long_row["popup"]["scrollWidth"] <= long_row["popup"]["clientWidth"] + 1, [long_row["popup"]["scrollWidth"], long_row["popup"]["clientWidth"]])
        screenshot(page, "picker-long-name.png")
        close_picker(page)
        page.get_by_role("button", name="设计稿场景").click()

        # F — many eligible nodes scroll inside the popover; keyboard navigation.
        page.get_by_role("button", name="多节点滚动").click()
        open_picker(page)
        s = dump(page)
        check("candidate list scrolls", s["optionsBox"]["scrollHeight"] > s["optionsBox"]["clientHeight"], s["optionsBox"])
        check("search and refresh stay visible", s["searchTop"] >= s["popup"]["y"] and s["refreshBottom"] <= s["popup"]["bottom"] + 0.5, [s["searchTop"], s["refreshBottom"], s["popup"]["bottom"]])
        check("popup respects max-height", s["popup"]["height"] <= 400, s["popup"]["height"])
        screenshot(page, "picker-many-nodes.png")
        page.keyboard.press("ArrowDown")
        first = page.evaluate("document.activeElement?.title || document.activeElement?.textContent")
        page.keyboard.press("ArrowDown")
        second = page.evaluate("document.activeElement?.title || document.activeElement?.textContent")
        page.keyboard.press("ArrowUp")
        back = page.evaluate("document.activeElement?.title || document.activeElement?.textContent")
        check("ArrowDown/ArrowUp move through options", (first, second.startswith("office1"), back) == ("本地", True, "本地"), [first, second, back])
        screenshot(page, "picker-keyboard-focus.png")
        page.keyboard.press("Escape")
        page.wait_for_selector("[role=dialog]", state="detached")
        check("Escape closes and returns focus", page.evaluate("document.activeElement?.getAttribute('aria-label')") == "切换工作节点", page.evaluate("document.activeElement?.tagName"))

        # G — Tab and outside pointer close; Enter selects the first match.
        open_picker(page)
        page.keyboard.press("Tab")
        check("Tab closes the popover", page.locator("[role=dialog]").count() == 0, page.locator("[role=dialog]").count())
        open_picker(page)
        page.mouse.click(700, 500)
        check("outside pointer closes the popover", page.locator("[role=dialog]").count() == 0, page.locator("[role=dialog]").count())
        open_picker(page)
        page.fill("[role=dialog] input", "office2")
        page.keyboard.press("Enter")
        page.wait_for_timeout(150)
        check("Enter chooses the first match", page.locator("[data-scope]").text_content() == '{"kind":"remote","nodeId":"node-9f1c0a77b2e84d55a0c3f6e21b7d4a88"}', page.locator("[data-scope]").text_content())
        # Pre-existing behaviour, unchanged here: close() focuses the trigger and the
        # same Enter press then activates it, so the popover reopens. Recorded, not fixed.
        check("Enter reopens via focus return (pre-existing)", page.locator("[role=dialog]").count() == 1 and page.evaluate("document.querySelector(\"button[aria-label='切换工作节点']\").getAttribute('aria-expanded')") == "true", page.evaluate("document.querySelector(\"button[aria-label='切换工作节点']\").getAttribute('aria-expanded')"))
        close_picker(page)

        # H — refresh keeps the popover open and calls the handler.
        before = page.locator("[data-refreshes]").text_content()
        open_picker(page)
        page.locator("[role=dialog] button:not([data-browse-option])").click()
        after = page.locator("[data-refreshes]").text_content()
        check("refresh keeps the popover open and increments", str(int(after) - int(before)) == "1" and page.locator("[role=dialog]").count() == 1, [before, after])
        close_picker(page)

        # I — loading and error states keep the original feed, styled.
        page.get_by_role("button", name="加载中").click()
        page.get_by_role("button", name="错误").click()
        open_picker(page)
        check("busy shows status and disables refresh", page.locator("[role=dialog] [role=status]").count() == 1 and page.locator("[role=dialog] button:not([data-browse-option])").is_disabled(), page.locator("[role=dialog] [role=status]").all_text_contents())
        check("error shows alert", page.locator("[role=dialog] [role=alert]").count() == 1, page.locator("[role=dialog] [role=alert]").all_text_contents())
        screenshot(page, "picker-busy-error.png")
        close_picker(page)
        page.get_by_role("button", name="加载中").click()
        page.get_by_role("button", name="错误").click()

        # J — right-edge anchor: the 400px popover is clamped, not overflowing.
        page.evaluate("""() => { const h = document.querySelector('.heading');
          h.style.position = 'fixed'; h.style.right = '8px'; h.style.top = '60px'; h.style.width = '120px'; }""")
        open_picker(page)
        s = dump(page)
        vw = page.viewport_size["width"]
        check("right-edge popover keeps 8px gutter", abs(s["popup"]["right"] - (vw - 8)) < 0.5, [s["popup"]["x"], s["popup"]["right"]])
        screenshot(page, "picker-right-edge.png")
        close_picker(page)
        page.reload()
        page.wait_for_selector("button[aria-label='切换工作节点']")

        # K — 320px viewport: 8px gutters, reduced row padding, no overflow.
        page.set_viewport_size({"width": 320, "height": 640})
        open_picker(page)
        s = dump(page)
        check("320px popover is 304 wide at x=8", (s["popup"]["width"], s["popup"]["x"], s["popup"]["right"]) == (304, 8, 312), [s["popup"]["width"], s["popup"]["x"], s["popup"]["right"]])
        check("320px keeps 8px gutters", s["popup"]["x"] >= 8 and s["popup"]["right"] <= 312, [s["popup"]["x"], s["popup"]["right"]])
        check("320px row padding 10 and gap 8", (s["remote"]["padding"], s["remote"]["gap"]) == ("11px 10px", "8px"), [s["remote"]["padding"], s["remote"]["gap"]])
        check("320px popup does not overflow", s["popup"]["scrollWidth"] <= s["popup"]["clientWidth"] + 1, [s["popup"]["scrollWidth"], s["popup"]["clientWidth"]])
        screenshot(page, "picker-320.png")
        close_picker(page)

        # L — side-by-side against the approved design frame. Both captures are the
        # picker surface only: the design fragment is rendered as shipped, and the
        # implementation is the real production popover.
        page.set_viewport_size({"width": 900, "height": 700})
        page.reload()
        page.wait_for_selector("button[aria-label='切换工作节点']")
        open_picker(page)
        page.evaluate("document.activeElement?.blur()")
        page.locator("[role=dialog]").screenshot(path=str(HERE / "impl-picker.png"))
        # Focus is on the body now, so dismiss with a pointer outside the popover.
        page.mouse.click(700, 500)
        page.wait_for_selector("[role=dialog]", state="detached")

        root = HERE.parents[2]
        fragment = (root / "docs/designs/workspace-selector/2026-10-31-approved/workspace-picker-style.html").read_text(encoding="utf-8")
        (HERE / "design-render.html").write_text(
            '<!doctype html><html lang="zh-CN"><meta charset="utf-8">'
            '<body style="margin:0;background:#1b1b1c">' + fragment + '</body></html>',
            encoding="utf-8",
        )
        design = browser.new_page(viewport={"width": 900, "height": 700}, device_scale_factor=2)
        design.goto((HERE / "design-render.html").as_uri())
        design.locator(".popover").screenshot(path=str(HERE / "design-reference.png"))
        design.close()

        (HERE / "comparison.html").write_text(
            """<!doctype html><meta charset="utf-8">
<style>
  body { margin: 0; padding: 24px; background: #151517; color: #bdbdc7;
         font-family: Inter, 'Segoe UI', 'Microsoft YaHei', sans-serif; }
  .row { display: flex; gap: 24px; align-items: flex-start; }
  figure { margin: 0; }
  figcaption { font-size: 12px; line-height: 18px; margin-bottom: 10px; color: #9d9da7; }
  img { display: block; width: 400px; height: auto; }
</style>
<div class="row">
  <figure><figcaption>已确认设计稿（400px）</figcaption><img src="design-reference.png" width="400" alt="设计稿"></figure>
  <figure><figcaption>实现（真实组件，400px）</figcaption><img src="impl-picker.png" width="400" alt="实现"></figure>
</div>""",
            encoding="utf-8",
        )
        shot = browser.new_page(viewport={"width": 900, "height": 360}, device_scale_factor=2)
        shot.goto((HERE / "comparison.html").as_uri())
        shot.screenshot(path=str(HERE / "comparison.png"), full_page=True)
        shot.close()

        browser.close()

    print(json.dumps({"checks": CHECKS, "failures": FAILURES}, ensure_ascii=False, indent=2))
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
