'use strict'

const { createRequire } = require('node:module')
const { escapeHtml } = require('./content-navigation')
const hexoRequire = createRequire(require.resolve('hexo'))
const utilRequire = createRequire(hexoRequire.resolve('hexo-util'))
const { Parser } = utilRequire('htmlparser2')

function routePath (pathname) {
  // 原生路由对应真实文件名，保留字面百分号；只有配置 URL 才需要解码。
  const path = pathname.replace(/^\/+/, '')
  return !path || path.endsWith('/') ? `${path}index.html` : path
}

function parseLocalUrl (value, field) {
  const fail = reason => { throw new Error(`兼容路由 ${field}：${reason}`) }
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\u0000-\u001f\u007f\\\s<>"']/.test(value)) {
    fail('必须是有效的站内路径')
  }
  const parts = value.split('#')
  if (parts.length > 2 || /%2f|%5c/i.test(parts[0])) fail('路径不能包含编码后的分隔符或重复锚点')
  let pathname, anchor
  try {
    pathname = decodeURIComponent(parts[0])
    anchor = parts.length === 2 ? decodeURIComponent(parts[1]) : ''
  } catch {
    fail('包含无效的 URL 编码')
  }
  // 先检查原始路径，避免 URL 自动规范化把目录穿越或双重编码掩盖掉。
  if (!pathname.endsWith('/') || pathname.includes('//') || /[\u0000-\u001f\u007f\\\s<>"'?%#]/.test(pathname) || pathname.split('/').some(part => part === '.' || part === '..')) {
    fail('只接受以 / 结尾、不含查询参数或目录跳转的站内路径')
  }
  if (parts.length === 2 && (!anchor || /[\u0000-\u001f\u007f\s<>"'\\%]/.test(anchor))) fail('锚点无效')
  return { path: routePath(pathname), anchor }
}

function buildRedirects (entries, occupiedPaths = new Set()) {
  if (!Array.isArray(entries)) throw new Error('兼容路由：配置必须是数组')
  const occupied = new Set([...occupiedPaths].map(routePath))
  const sources = new Set()
  const redirects = entries.map((entry, i) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`兼容路由第 ${i + 1} 项：配置无效`)
    const source = parseLocalUrl(entry.from, `${entry.from || i}.from`)
    const target = parseLocalUrl(entry.to, `${entry.from}.to`)
    if (source.anchor) throw new Error(`兼容路由 ${entry.from}：来源不能带锚点`)
    if (sources.has(source.path)) throw new Error(`兼容路由 ${entry.from}：来源重复`)
    if (occupied.has(source.path)) throw new Error(`兼容路由 ${entry.from}：覆盖现有页面`)
    sources.add(source.path)
    return { ...entry, path: source.path, targetPath: target.path, anchor: target.anchor }
  })
  for (const redirect of redirects) {
    if (sources.has(redirect.targetPath)) throw new Error(`兼容路由 ${redirect.from}：不能跳转到另一兼容页或自身`)
  }
  return redirects
}

function renderRedirect (redirect, siteUrl, urlFor) {
  const target = urlFor(redirect.to)
  const canonical = new URL(target, siteUrl).href
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex,follow">' +
    `<meta http-equiv="refresh" content="0;url=${escapeHtml(target)}">` +
    `<link rel="canonical" href="${escapeHtml(canonical)}">` +
    '<title>页面已迁移</title></head><body><p>内容已整理到新入口，' +
    `<a href="${escapeHtml(target)}">点击继续浏览</a>。</p></body></html>`
}

async function readRoute (route, path) {
  const stream = route.get(path)
  if (!stream) throw new Error(`兼容路由目标不存在：${path}`)
  const chunks = []
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

async function verifyRedirectTargets (redirects, route) {
  const actualPaths = new Map(route.list().map(path => [routePath(path), path]))
  const idsByPath = new Map()
  for (const redirect of redirects) {
    const actualPath = actualPaths.get(redirect.targetPath)
    if (actualPath === undefined) throw new Error(`兼容路由 ${redirect.from}：目标页面不存在 ${redirect.to}`)
    if (!redirect.anchor) continue
    if (!idsByPath.has(actualPath)) {
      const ids = new Set()
      // 解析真实元素属性，排除注释、脚本和 data-id 中看起来相同的文本。
      const parser = new Parser({ onopentag: (name, attributes) => {
        if (attributes.id) ids.add(attributes.id)
      } })
      parser.end(await readRoute(route, actualPath))
      idsByPath.set(actualPath, ids)
    }
    if (!idsByPath.get(actualPath).has(redirect.anchor)) throw new Error(`兼容路由 ${redirect.from}：目标锚点不存在 ${redirect.to}`)
  }
}

module.exports = { buildRedirects, renderRedirect, verifyRedirectTargets, routePath }
