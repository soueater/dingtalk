// src/services/export/builder.ts
// 把 Design JSON 编译为可导出的产物：HTML 单文件 / HTML 工程 / SVG / PNG 源
import type { DesignJSON, ExportFormat, ExportRequest } from '@shared/design'
import { useProjectStore } from '@/stores/project.store'
import { resolveColor } from '@/services/render/tokens'
import { tokenMapForPage } from '@/services/design/specs'
import { renderNode, renderNodeWithStates, statesCss } from '@/services/render/node'
import { CANVAS_CSS } from './canvas-css'

const esc = (s: string) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 生成一个页面的独立 HTML 文档 */
function pageDocument(design: DesignJSON, pageId: string, opts: { inline: boolean; nav: boolean }): string {
  const page = design.pages.find((p) => p.id === pageId) ?? design.pages[0]
  // F-ST-01：导出按该页生效的规范解析 Token，与画布所见保持一致
  const map = tokenMapForPage(design, page)
  const { canvas } = design.meta
  // F-ST-02：导出 HTML 同样携带 states 规则，交付给下游的原型「悬停/按下/聚焦」可用
  const body = renderNodeWithStates(page.root, map)
  const bg = resolveColor(page.background, map, '#FFFFFF')

  // 页面跳转：把 flows 编译成 data-go 属性 + 少量脚本
  const flows = design.flows.filter((f) => f.fromPage === page.id)
  const goMap: Record<string, string> = {}
  for (const f of flows) goMap[f.from] = f.to

  const navScript = opts.nav
    ? `<script>
(function(){
  var GO = ${JSON.stringify(goMap)};
  document.querySelectorAll('[data-id]').forEach(function(el){
    var id = el.getAttribute('data-id');
    if (GO[id]) {
      el.style.cursor = 'pointer';
      el.addEventListener('click', function(){
        location.href = 'page-' + GO[id] + '.html';
      });
    }
  });
})();
</script>`
    : ''

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.name)} · ${esc(design.meta.name)}</title>
<style>${CANVAS_CSS}
html,body{margin:0;padding:0}
body{background:#f3f4f6;display:flex;align-items:flex-start;justify-content:center;padding:24px;font-family:var(--font-ui)}
</style>
</head>
<body>
<div class="page-root" style="width:${canvas.width}px;height:${canvas.height}px;background:${bg};position:relative;overflow:hidden;margin:0 auto;box-shadow:0 8px 32px rgba(0,0,0,.12);border-radius:2px">
${body}
</div>
${navScript}
</body>
</html>`
}

/** 多页汇总到一个 HTML（用 tab/分节呈现） */
function singleFileDocument(design: DesignJSON, pageIds: string[]): string {
  const { canvas } = design.meta
  const pages = design.pages.filter((p) => pageIds.includes(p.id))

  const sections = pages
    .map((p, i) => {
      // F-ST-01：每个页面用各自的生效规范渲染
      // F-ST-02：states 规则随内联 <style> 一起进入该 section
      const body = renderNodeWithStates(p.root, tokenMapForPage(design, p))
      return `<section class="pg" id="pg-${esc(p.id)}" data-index="${i}">
  <div class="pg-label">${esc(p.name)}</div>
  <div class="pg-frame">${body}</div>
</section>`
    })
    .join('\n')

  const tabs = pages
    .map(
      (p, i) =>
        `<button class="tab${i === 0 ? ' on' : ''}" data-target="pg-${esc(p.id)}">${esc(p.name)}</button>`,
    )
    .join('')

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(design.meta.name)} · 原型</title>
<style>${CANVAS_CSS}
*{box-sizing:border-box}
body{margin:0;background:#0f1115;color:#e8ecf2;font-family:var(--font-ui);min-height:100vh}
.bar{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:6px;padding:10px 16px;background:#15181e;border-bottom:1px solid #232833;flex-wrap:wrap}
.bar .t{font-size:13px;font-weight:600;margin-right:12px}
.tab{height:28px;padding:0 12px;border-radius:6px;border:1px solid #2b313d;background:#1a1e26;color:#9aa4b2;font-size:12px;cursor:pointer}
.tab:hover{color:#e8ecf2}
.tab.on{background:#4c8dff;border-color:#4c8dff;color:#fff}
.stage{padding:32px;display:flex;justify-content:center}
.pg{display:none}
.pg.on{display:block;animation:fade .18s ease-out}
@keyframes fade{from{opacity:0}to{opacity:1}}
.pg-label{font-size:12px;color:#9aa4b2;margin-bottom:8px;text-align:center}
.pg-frame{width:${canvas.width}px;height:${canvas.height}px;overflow:hidden;background:#fff;border-radius:2px;box-shadow:0 12px 40px rgba(0,0,0,.5);margin:0 auto}
.page-root{box-shadow:none!important}
</style>
</head>
<body>
<div class="bar">
  <span class="t">${esc(design.meta.name)}</span>
  ${tabs}
</div>
<div class="stage">
${sections}
</div>
<script>
(function(){
  var tabs = document.querySelectorAll('.tab');
  var pgs = document.querySelectorAll('.pg');
  tabs.forEach(function(t){
    t.addEventListener('click', function(){
      tabs.forEach(function(x){x.classList.remove('on')});
      pgs.forEach(function(x){x.classList.remove('on')});
      t.classList.add('on');
      var el = document.getElementById(t.getAttribute('data-target'));
      if (el) el.classList.add('on');
    });
  });
  if (pgs[0]) pgs[0].classList.add('on');
})();
</script>
</body>
</html>`
}

/** 把页面根节点转为 SVG（foreignObject 包裹，最大兼容） */
function pageToSvg(design: DesignJSON, pageId: string): string {
  const page = design.pages.find((p) => p.id === pageId) ?? design.pages[0]
  const map = tokenMapForPage(design, page)
  const { canvas } = design.meta
  const body = renderNode(page.root, map)
  // F-ST-02：states 规则放进 <defs><style>，与 CANVAS_CSS 同源生效。
  // XML 文本节点需转义 `<` / `&`，否则样式里的选择器组合符会破坏 SVG 结构。
  const sc = statesCss(page.root, map)
  const stateDef = sc ? `<style>${esc(sc)}</style>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">
<defs><style>${CANVAS_CSS.replace(/</g, '&lt;')}</style>${stateDef}</defs>
<foreignObject x="0" y="0" width="${canvas.width}" height="${canvas.height}">
<div xmlns="http://www.w3.org/1999/xhtml" class="page-root" style="width:${canvas.width}px;height:${canvas.height}px;background:#fff">${body}</div>
</foreignObject>
</svg>`
}

/** 供其他模块调用：单个页面的自包含 HTML（PNG 渲染源） */
export function pageHtmlForRender(design: DesignJSON, pageId: string): string {
  return pageDocument(design, pageId, { inline: true, nav: false })
}

/* ------------------------- 对外：构建导出载荷 ------------------------- */

export async function buildExportPayload(format: ExportFormat): Promise<Omit<ExportRequest, 'targetPath'>> {
  const { design } = useProjectStore.getState()
  const pageIds = design.pages.map((p) => p.id)
  const { canvas } = design.meta

  switch (format) {
    case 'json':
      return { format, design }

    case 'html-single': {
      const html = singleFileDocument(design, pageIds)
      return { format, files: [{ name: `${design.meta.name}.html`, content: html }] }
    }

    case 'html-multi': {
      const files: Array<{ name: string; content: string }> = []
      // index.html 跳转页
      const index = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(
        design.meta.name,
      )}</title><style>body{margin:0;background:#0f1115;color:#e8ecf2;font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;display:grid;place-items:center;min-height:100vh}a{color:#4c8dff}</style></head><body><div style="text-align:center"><h1 style="font-size:20px">${esc(
        design.meta.name,
      )}</h1><p style="color:#9aa4b2;font-size:13px">共 ${design.pages.length} 个页面</p><ul style="list-style:none;padding:0;font-size:14px;line-height:2">${design.pages
        .map((p) => `<li><a href="page-${esc(p.id)}.html">${esc(p.name)}</a></li>`)
        .join('')}</ul></div></body></html>`
      files.push({ name: 'index.html', content: index })

      for (const p of design.pages) {
        files.push({ name: `page-${p.id}.html`, content: pageDocument(design, p.id, { inline: false, nav: true }) })
      }
      // 附带设计源文件，便于二次编辑
      files.push({ name: 'design.json', content: JSON.stringify({ fileVersion: '1.0', design }, null, 2) })
      return { format, files }
    }

    case 'svg': {
      const svg = pageToSvg(design, design.pages[0]?.id)
      return { format, files: [{ name: `${design.meta.name}.svg`, content: svg }] }
    }

    case 'png': {
      return {
        format,
        scale: 2,
        transparent: false,
        pageIds,
        pages: design.pages.map((p) => ({
          id: p.id,
          name: p.name,
          width: canvas.width,
          height: canvas.height,
          html: pageHtmlForRender(design, p.id),
        })),
      }
    }

    default:
      return { format: 'html-single', files: [] }
  }
}
