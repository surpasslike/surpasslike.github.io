'use strict'

const { createRequire } = require('node:module')
// 使用当前 Hexo 自身的解析和地址工具，保持与文章处理规则一致。
const hexoRequire = createRequire(require.resolve('hexo'))
const { parse } = hexoRequire('hexo-front-matter')
const { url_for: urlForHelper } = hexoRequire('hexo-util')
const { buildNavigation, renderIndex, renderTagWidget } = require('../lib/content-navigation')
const { buildRedirects, renderRedirect, verifyRedirectTargets, routePath } = require('../lib/content-redirects')

const widgetId = 'content-navigation-tags'
const entryPaths = { categories: 'categories/index.html', tags: 'tags/index.html', topics: 'projects/index.html' }
const urlFor = path => urlForHelper.call(hexo, path)
let current
let generation = 0

hexo.on('ready', () => {
  const fragmentCache = hexo.extend.helper.get('fragment_cache')
  hexo.extend.helper.register('fragment_cache', function (id, render) {
    // 预览生成期间旧路由仍可访问，按渲染周期隔离缓存，防止旧计数回填。
    const key = this.content_navigation_generation === undefined ? id : `content-navigation:${this.content_navigation_generation}:${id}`
    return fragmentCache.call(this, key, render)
  })
})

hexo.extend.filter.register('before_generate', () => {
  current = undefined
  const site = hexo.locals.toObject()
  const posts = site.posts.toArray().map(post => ({
    source: post.source,
    path: post.path,
    title: post.title,
    description: post.description || '',
    date: post.date.valueOf(),
    metadata: parse(post.raw)
  }))
  const categoryPaths = Object.fromEntries(site.categories.map(category => [category.name, category.path]))
  const tagPaths = Object.fromEntries(site.tags.map(tag => [tag.name, tag.path]))
  const index = buildNavigation({ posts, catalog: site.data.navigation, categoryPaths, tagPaths })
  const widget = site.data.widget || {}
  for (const position of ['top', 'bottom']) {
    if (widget[position] && !Array.isArray(widget[position])) throw new Error(`侧栏组件 widget.${position}：必须是数组`)
    if ((widget[position] || []).some(item => item.id_name === widgetId)) throw new Error(`侧栏组件：保留标识 ${widgetId} 冲突`)
  }
  const occupiedPaths = new Set([
    ...site.posts.map(post => post.path),
    ...site.pages.map(page => page.path),
    ...hexo.model('Asset').map(asset => asset.path),
    ...index.categories.filter(category => category.count).map(category => hexo.route.format(category.path)),
    ...index.tags.map(tag => hexo.route.format(tag.path))
  ])
  const redirects = buildRedirects(site.data.redirects, occupiedPaths)
  current = { index, redirects, generation: ++generation, redirectPaths: new Set(redirects.map(item => item.path)), widgetHtml: renderTagWidget(index, urlFor) }
  hexo.log.info(`内容导航：${posts.length} 篇文章，${index.categories.length} 个分类，${index.topics.length} 个专题，${index.tags.length} 个标签`)
}, 20)

hexo.extend.filter.register('template_locals', locals => {
  if (!current) throw new Error('内容导航：本轮索引尚未通过校验')
  locals.content_navigation_generation = current.generation
  if (current.redirectPaths.has(routePath(locals.path))) throw new Error(`兼容路由 ${locals.path}：覆盖现有页面`)
  if (locals.page.type === 'content-index') {
    const kind = locals.page.index_kind
    if (entryPaths[kind] !== locals.path) throw new Error(`导航入口 ${locals.path}：index_kind 与入口地址不匹配`)
    locals.page.content = (locals.page.content || '') + renderIndex(kind, current.index, urlFor)
  }
  // 每轮渲染只扩展副本，保留其他组件，避免增量生成时重复追加或污染源数据。
  const data = locals.site.data
  const widget = data.widget || {}
  locals.site = { ...locals.site, data: { ...data, widget: {
    ...widget,
    bottom: [...(widget.bottom || []), {
      id_name: widgetId,
      class_name: 'card-content-tags',
      name: '热门标签',
      icon: 'fas fa-tags',
      html: current.widgetHtml
    }]
  } } }
  return locals
}, 20)

hexo.extend.generator.register('content-redirects', () => current.redirects.map(redirect => ({
  path: redirect.path,
  data: renderRedirect(redirect, hexo.config.url, urlFor)
})))

hexo.extend.filter.register('after_generate', () => verifyRedirectTargets(current.redirects, hexo.route))
