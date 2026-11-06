'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { buildNavigation, renderIndex, renderTagWidget, compareNames, escapeHtml } = require('../lib/content-navigation')

function input () {
  return {
    catalog: {
      categories: [{ name: '项目实践', description: '实践记录' }, { name: '学习笔记', description: '知识梳理' }],
      tags: ['Kotlin', 'Flow', '协程'],
      topics: [{ id: 'calendar', title: 'Calendar 应用实践', description: '日程管理' }, { id: 'empty', title: '待续专题', description: '继续积累' }]
    },
    categoryPaths: { 项目实践: 'categories/项目实践/', 学习笔记: 'categories/学习笔记/' },
    tagPaths: { Kotlin: 'tags/Kotlin/', Flow: 'tags/Flow/', 协程: 'tags/协程/' },
    posts: [{
      source: '_posts/flow.md', path: 'flow/', title: 'Flow 笔记', description: '数据流', date: 1000,
      metadata: { categories: ['学习笔记'], tags: ['Kotlin', 'Flow'], topic: 'calendar', topic_order: 1 }
    }]
  }
}

function variant (metadata, fields = {}) {
  const value = input()
  Object.assign(value.posts[0].metadata, metadata)
  Object.assign(value.posts[0], fields)
  return value
}

test('分类、标签、专题从发布文章计算，不创建空标签归档', () => {
  const value = input()
  const before = structuredClone(value)
  const index = buildNavigation(value)
  assert.deepEqual(index.categories.map(({ name, count, path }) => ({ name, count, path })), [
    { name: '项目实践', count: 0, path: null }, { name: '学习笔记', count: 1, path: 'categories/学习笔记/' }
  ])
  assert.deepEqual(index.tags.map(tag => tag.name), ['Flow', 'Kotlin'])
  assert.equal(index.topics[0].posts[0].category, '学习笔记')
  assert.equal(index.topics[1].posts.length, 0)
  assert.deepEqual(value, before, '不修改输入元数据和目录')
})

test('普通文章不强制加入专题，空白可选字段视为未填写', () => {
  const index = buildNavigation(variant({ topic: null, topic_order: null }))
  assert.equal(index.tags.length, 2)
  assert.equal(index.topics[0].posts.length, 0)
})

for (const [name, metadata, field] of [
  ['没有分类', { categories: [] }, 'categories'],
  ['多个分类', { categories: ['学习笔记', '项目实践'] }, 'categories'],
  ['分类不是数组', { categories: '学习笔记' }, 'categories'],
  ['未知分类', { categories: ['随笔'] }, 'categories'],
  ['未知标签', { tags: ['错误标签'] }, 'tags'],
  ['重复原始标签', { tags: ['Kotlin', 'Kotlin'] }, 'tags'],
  ['没有标签', { tags: [] }, 'tags'],
  ['过多标签', { tags: ['Kotlin', 'Flow', '协程', '四', '五'] }, 'tags'],
  ['标签不是数组', { tags: 'Kotlin' }, 'tags'],
  ['未知专题', { topic: 'unknown' }, 'topic'],
  ['专题不是标识字符串', { topic: ['calendar'] }, 'topic'],
  ['空专题字符串', { topic: '' }, 'topic'],
  ['无专题却编号', { topic: undefined }, 'topic_order'],
  ['零序号', { topic_order: 0 }, 'topic_order'],
  ['负序号', { topic_order: -1 }, 'topic_order'],
  ['小数序号', { topic_order: 1.5 }, 'topic_order'],
  ['字符串序号', { topic_order: '1' }, 'topic_order'],
  ['非有限序号', { topic_order: Infinity }, 'topic_order']
]) {
  test(`${name}应明确失败`, () => {
    assert.throws(() => buildNavigation(variant(metadata)), error => {
      assert.match(error.message, /_posts\/flow\.md/)
      assert(error.message.includes(field))
      return true
    })
  })
}

test('同专题编号冲突报告两篇文章，不限制不同专题使用相同编号', () => {
  const value = input()
  value.posts.push({ ...value.posts[0], source: '_posts/other.md', path: 'other/', metadata: { ...value.posts[0].metadata } })
  assert.throws(() => buildNavigation(value), /other\.md.*topic_order.*flow\.md.*重复/)
  value.posts[1].metadata.topic = 'empty'
  assert.doesNotThrow(() => buildNavigation(value))
})

test('编号文章优先；未编号文章按日期和路径排序', () => {
  const value = input()
  const create = (path, date, order) => ({ ...value.posts[0], source: path, path, date, metadata: { ...value.posts[0].metadata, topic_order: order } })
  value.posts = [create('z/', 1), create('b/', 4), create('a/', 4), create('second/', 0, 2), create('first/', 99, 1)]
  assert.deepEqual(buildNavigation(value).topics[0].posts.map(post => post.path), ['first/', 'second/', 'z/', 'a/', 'b/'])
})

test('热门标签先按篇数和名称选12个，再按名称展示', () => {
  const value = input()
  value.catalog.tags = Array.from({ length: 14 }, (_, index) => `标签${index + 1}`)
  value.tagPaths = Object.fromEntries(value.catalog.tags.map(name => [name, `tags/${name}/`]))
  value.posts = value.catalog.tags.flatMap((tag, index) => Array.from({ length: index === 13 ? 3 : 1 }, (_, repeat) => ({
    source: `${index}-${repeat}.md`, path: `${index}-${repeat}/`, date: 1,
    metadata: { categories: ['学习笔记'], tags: [tag] }
  })))
  const index = buildNavigation(value)
  assert.equal(index.tags.length, 14)
  assert.equal(index.sidebarTags.length, 12)
  assert(index.sidebarTags.some(tag => tag.name === '标签14' && tag.count === 3))
  assert(!index.sidebarTags.some(tag => ['标签12', '标签13'].includes(tag.name)))
  assert.deepEqual(index.sidebarTags.map(tag => tag.name), [...index.sidebarTags.map(tag => tag.name)].sort(compareNames))
})

for (const [name, mutate] of [
  ['目录不是对象', value => { value.catalog = null }],
  ['分类目录不是数组', value => { value.catalog.categories = {} }],
  ['分类名称重复', value => { value.catalog.categories.push(value.catalog.categories[0]) }],
  ['标签名称重复', value => { value.catalog.tags.push('Kotlin') }],
  ['专题标识重复', value => { value.catalog.topics.push({ ...value.catalog.topics[0], title: '其他标题' }) }],
  ['专题标题重复', value => { value.catalog.topics.push({ ...value.catalog.topics[0], id: 'other' }) }],
  ['专题锚点不稳定', value => { value.catalog.topics[0].id = '不合法 id' }],
  ['目录名称含首尾空格', value => { value.catalog.tags[0] = ' Kotlin' }],
  ['活跃分类缺少归档', value => { delete value.categoryPaths['学习笔记'] }],
  ['活跃标签缺少归档', value => { delete value.tagPaths.Kotlin }]
]) {
  test(`${name}应在生成前拒绝`, () => {
    const value = input()
    mutate(value)
    assert.throws(() => buildNavigation(value), /内容目录/)
  })
}

test('每次调用重新计算，文章增删和改归属不污染旧结果', () => {
  const value = input()
  const first = buildNavigation(value)
  value.posts[0].metadata.topic = 'empty'
  value.posts[0].metadata.tags = ['协程']
  const second = buildNavigation(value)
  assert.equal(first.topics[0].posts.length, 1)
  assert.equal(second.topics[0].posts.length, 0)
  assert.equal(second.topics[1].posts.length, 1)
  assert.deepEqual(second.tags.map(tag => tag.name), ['协程'])
  value.posts.length = 0
  assert.equal(buildNavigation(value).tags.length, 0)
})

test('渲染保留空专题锚点，链接统一使用urlFor并转义', () => {
  const value = input()
  value.posts[0].title = '<script>alert("标题")</script>'
  value.posts[0].description = '正文 <img src=x onerror="x"> & 说明'
  value.catalog.topics[1].title = '空的 <专题>'
  const index = buildNavigation(value)
  const urlFor = path => `/blog/${path.replace(/^\//, '')}?a=1&b="2"`
  const html = renderIndex('topics', index, urlFor)
  assert.match(html, /id="empty"/)
  assert.match(html, /暂无文章/)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /&lt;img src=x onerror=&quot;x&quot;&gt;/)
  assert(!html.includes('<script>'))
  assert(!html.includes('<img '))
  assert.match(html, /href="\/blog\/flow\/\?a=1&amp;b=&quot;2&quot;"/)
  assert.match(html, /class="content-post-category">学习笔记/)
  assert.match(renderIndex('categories', index, urlFor), /content-category-list/)
  assert(!renderIndex('categories', index, urlFor).includes('href="null"'))
  assert.match(renderIndex('tags', index, urlFor), /content-tag-list/)
  const widget = renderTagWidget(index, urlFor)
  assert.match(widget, /content-sidebar-tags/)
  assert.match(widget, /全部标签/)
  assert(!widget.includes('card-widget'))
  assert.equal(escapeHtml('&<>"\''), '&amp;&lt;&gt;&quot;&#39;')
})

test('索引显示顺序与目录一致，未知页面类型明确失败', () => {
  const index = buildNavigation(input())
  const categories = renderIndex('categories', index)
  assert(categories.indexOf('项目实践') < categories.indexOf('学习笔记'))
  const topics = renderIndex('topics', index)
  assert(topics.indexOf('id="calendar"') < topics.indexOf('id="empty"'))
  assert.throws(() => renderIndex('unknown', index), /未知索引类型/)
})
