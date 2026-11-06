'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const { spawn } = require('node:child_process')
const { setTimeout: delay } = require('node:timers/promises')
const { createRequire } = require('node:module')
const Hexo = require('hexo')
const hexoRequire = createRequire(require.resolve('hexo'))
const { parse, stringify } = hexoRequire('hexo-front-matter')

const repository = path.resolve(__dirname, '..')
const resourceFixtures = new Map([
  ['img/navigation-resources/100%.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01, 0x00, 0xff])],
  ['img/navigation-resources/literal%20.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x02, 0x00, 0xff])],
  ['img/navigation-resources/literal .png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x03, 0x00, 0xff])]
])

function makeFixture () {
  const directory = fs.mkdtempSync(path.join(repository, 'node_modules/.cache-navigation-'))
  for (const item of ['source', 'lib', 'scripts', '_config.yml', '_config.butterfly.yml', 'package.json']) {
    fs.cpSync(path.join(repository, item), path.join(directory, item), { recursive: true })
  }
  fs.symlinkSync(path.join(repository, 'node_modules'), path.join(directory, 'node_modules'), 'dir')
  fs.appendFileSync(path.join(directory, 'source/_data/navigation.yml'), '  - 增量专用标签\n')
  // 保留已有自定义组件，并加入不应参与发布统计的草稿。
  fs.writeFileSync(path.join(directory, 'source/_data/widget.yml'),
    'top:\n  - id_name: existing-top\n    name: 原有顶部\n    html: preserved-top\nbottom:\n  - id_name: existing-bottom\n    name: 原有底部\n    html: preserved-bottom\n')
  fs.mkdirSync(path.join(directory, 'source/_drafts'), { recursive: true })
  fs.writeFileSync(path.join(directory, 'source/_drafts/unpublished.md'),
    '---\ntitle: 不应发布的草稿\ndate: 2026-01-01\ncategories: [未登记草稿分类]\ntags: [未登记草稿标签]\n---\n草稿正文\n')
  // 文件名中的百分号和空格是不同资源，不能按 URL 编码合并。
  for (const [resourcePath, bytes] of resourceFixtures) {
    const file = path.join(directory, 'source', resourcePath)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, bytes)
  }
  return directory
}

async function readRouteBytes (app, name) {
  const stream = app.route.get(name)
  assert(stream, `路由不存在：${name}`)
  const chunks = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

async function readRoute (app, name) {
  return (await readRouteBytes(app, name)).toString('utf8')
}

function occurrences (text, value) {
  return text.split(value).length - 1
}

function topicSection (html, id) {
  const match = html.match(new RegExp(`<section class="content-topic" id="${id}">([\\s\\S]*?)</section>`))
  assert(match, `缺少专题 ${id}`)
  return match[1]
}

function topicCount (html, id) {
  return Number(topicSection(html, id).match(/class="content-count">(\d+) 篇/)[1])
}

function categoryCounts (html) {
  return [...html.matchAll(/<section class="content-category">[\s\S]*?class="content-count">(\d+) 篇/g)].map(match => Number(match[1]))
}

function tagCounts (html, className = 'content-tag-list') {
  const list = html.match(new RegExp(`<ul class="${className}">([\\s\\S]*?)</ul>`))
  assert(list, `缺少标签列表 ${className}`)
  return new Map([...list[1].matchAll(/<span>([^<]+)<\/span><span class="content-count">(\d+) 篇/g)]
    .map(match => [match[1], Number(match[2])]))
}

function sidebarCategoryCounts (html) {
  return new Map([...html.matchAll(/class="card-category-list-name">([^<]+)<\/span><span class="card-category-list-count">(\d+)<\/span>/g)]
    .map(match => [match[1], Number(match[2])]))
}

function authorPostCount (html) {
  const start = html.indexOf('class="card-widget card-info')
  assert(start >= 0, '缺少作者卡片')
  const card = html.slice(start).split('<div class="card-widget', 1)[0]
  const count = card.match(/class="headline">文章<\/div><div class="length-num">(\d+)<\/div>/)
  assert(count, '缺少作者卡片文章数')
  return Number(count[1])
}

function writeMetadata (file, original, patch) {
  fs.writeFileSync(file, stringify({ ...parse(original), ...patch }, { prefixSeparator: true }))
}

async function availablePort () {
  const server = net.createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

async function eventually (check, message) {
  const deadline = Date.now() + 20000
  let failure
  while (Date.now() < deadline) {
    try { return await check() } catch (error) { failure = error }
    await delay(100)
  }
  throw new Error(`${message}：${failure && failure.message}`, { cause: failure })
}

async function runCli (directory) {
  const executable = path.join(path.dirname(require.resolve('hexo/package.json')), 'bin/hexo')
  const child = spawn(process.execPath, [executable, 'generate'], {
    cwd: directory, env: { ...process.env, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe']
  })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  const timeout = setTimeout(() => child.kill('SIGKILL'), 30000)
  try {
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', resolve)
    })
    return { code, output }
  } finally { clearTimeout(timeout) }
}

test('真实 Hexo 构建、校验失败恢复与同进程预览更新', { timeout: 180000 }, async t => {
  const directory = makeFixture()
  const app = new Hexo(directory, { silent: true })
  let server
  t.after(async () => {
    app.unwatch()
    if (server) await new Promise(resolve => server.close(resolve))
    await app.exit()
    fs.rmSync(directory, { recursive: true, force: true })
  })
  await app.init()
  await app.load()
  // 数量由本次临时站点的原始文章计算，后续新增正式文章不会被迁移时的总数限制。
  const published = app.locals.get('posts').toArray().map(post => parse(post.raw))
  const catalog = app.locals.get('data').navigation
  const expectedCategories = catalog.categories.map(category => published.filter(post => post.categories.includes(category.name)).length)
  const expectedTopics = Object.fromEntries(catalog.topics.map(topic => [topic.id, published.filter(post => post.topic === topic.id).length]))
  const expectedTags = new Map()
  for (const post of published) for (const tag of post.tags) expectedTags.set(tag, (expectedTags.get(tag) || 0) + 1)
  const nextOrder = topic => Math.max(0, ...published.filter(post => post.topic === topic).map(post => post.topic_order || 0)) + 1

  await t.test('迁移基线、原生系列、兼容路由及组件保持正确', async () => {
    const topics = await readRoute(app, 'projects/index.html')
    const categories = await readRoute(app, 'categories/index.html')
    const tags = await readRoute(app, 'tags/index.html')
    assert.deepEqual(categoryCounts(categories), expectedCategories)
    for (const [id, count] of Object.entries(expectedTopics)) assert.equal(topicCount(topics, id), count)
    assert.deepEqual(tagCounts(tags), expectedTags)
    assert.equal(tagCounts(tags, 'content-sidebar-tags').size, Math.min(12, expectedTags.size))
    assert.equal(occurrences(topics, 'class="content-index content-index-topics"'), 1)
    assert.equal(occurrences(topics, 'id="content-navigation-tags"'), 1)
    assert.match(topics, /preserved-top/)
    assert.match(topics, /preserved-bottom/)
    assert(topics.indexOf('id="existing-bottom"') < topics.indexOf('id="content-navigation-tags"'))
    assert(!topics.includes('不应发布的草稿'))
    assert.equal(app.locals.get('posts').length, published.length)
    assert.equal(app.locals.get('data').widget.bottom.length, 1)
    assert(!app.model('Page').findOne({ source: 'projects/index.md' }).content.includes('content-index-topics'))
    const calendar = await readRoute(app, 'calendar-01-requirements/index.html')
    const card = calendar.slice(calendar.indexOf('class="card-widget card-post-series"'))
      .split('<div class="card-widget', 1)[0]
    const links = [...card.matchAll(/<a class="title" href="([^"]+)"/g)].map(match => match[1])
    assert.deepEqual(links, ['/calendar-01-requirements/', '/calendar-02-architecture/', '/calendar-03-reminder/'])
    assert(!calendar.includes('id="content-navigation-tags"'))
    const sitemap = await readRoute(app, 'sitemap.xml')
    assert(sitemap.includes('https://surpasslike.github.io/projects/'))
    for (const item of app.locals.get('data').redirects) {
      const html = await readRoute(app, app.route.format(item.from))
      assert.match(html, /http-equiv="refresh"/)
      assert.match(html, /rel="canonical"/)
      assert(!sitemap.includes(`<loc>https://surpasslike.github.io${item.from}</loc>`))
    }
    await app.load()
    assert.equal(occurrences(await readRoute(app, 'projects/index.html'), 'class="content-index content-index-topics"'), 1)
    assert.equal(occurrences(await readRoute(app, 'tags/index.html'), 'id="content-navigation-tags"'), 1)
  })

  await t.test('合法百分号资源在真实生成中保留原始路径和字节', async () => {
    for (const [resourcePath, bytes] of resourceFixtures) {
      assert(app.model('Asset').findOne({ path: resourcePath }), `原始资源路径丢失：${resourcePath}`)
      assert.deepEqual(await readRouteBytes(app, resourcePath), bytes, `路由内容混淆：${resourcePath}`)
    }
    const result = await runCli(directory)
    assert.equal(result.code, 0, result.output)
    assert.doesNotMatch(result.output, /ERROR|Render HTML failed|Failed to @extend/)
    for (const [resourcePath, bytes] of resourceFixtures) {
      assert.deepEqual(fs.readFileSync(path.join(directory, 'public', resourcePath)), bytes, `构建产物内容混淆：${resourcePath}`)
    }
  })

  const file = path.join(directory, 'source/_posts/calendar-01-requirements.md')
  const original = fs.readFileSync(file, 'utf8')
  const failures = [
    ['未知分类', { categories: ['未知分类'] }, /categories.*未登记/],
    ['未知标签', { tags: ['未知标签'] }, /tags.*未登记/],
    ['未知专题', { topic: 'unknown' }, /topic.*未登记/],
    ['原始重复标签', { tags: ['需求分析', '需求分析'] }, /tags.*重复/],
    ['零序号', { topic_order: 0 }, /topic_order.*正整数/],
    ['负序号', { topic_order: -1 }, /topic_order.*正整数/],
    ['小数序号', { topic_order: 1.5 }, /topic_order.*正整数/],
    ['字符串序号', { topic_order: '1' }, /topic_order.*正整数/],
    ['没有专题却编号', { topic: null, topic_order: 1 }, /topic_order.*topic/],
    ['同专题重复序号', { topic_order: 2 }, /topic_order.*重复/]
  ]
  for (const [name, patch, message] of failures) {
    await t.test(`${name} 会阻止真实生成，修正后恢复`, async () => {
      writeMetadata(file, original, patch)
      await assert.rejects(app.load(), message)
      fs.writeFileSync(file, original)
      await app.load()
      assert.equal(topicCount(await readRoute(app, 'projects/index.html'), 'calendar'), expectedTopics.calendar)
    })
  }

  await t.test('命令行构建遇到非法元数据返回失败状态', async () => {
    writeMetadata(file, original, { tags: ['需求分析', '需求分析'] })
    try {
      const result = await runCli(directory)
      assert.notEqual(result.code, 0, result.output)
      assert.match(result.output, /重复标签/)
    } finally { fs.writeFileSync(file, original) }
    await app.load()
  })

  await t.test('侧栏保留标识冲突明确失败，不覆盖已有组件', async () => {
    const widgetFile = path.join(directory, 'source/_data/widget.yml')
    const widgetSource = fs.readFileSync(widgetFile, 'utf8')
    fs.writeFileSync(widgetFile, widgetSource.replace('id_name: existing-bottom', 'id_name: content-navigation-tags'))
    try { await assert.rejects(app.load(), /保留标识.*冲突/) } finally { fs.writeFileSync(widgetFile, widgetSource) }
    await app.load()
    assert.match(await readRoute(app, 'projects/index.html'), /preserved-bottom/)
  })

  await t.test('同一预览进程新增、改归属与删除后实时更新', async () => {
    const port = await availablePort()
    server = await app.call('server', { ip: '127.0.0.1', port })
    const base = `http://127.0.0.1:${port}`
    const get = async pathname => {
      const response = await fetch(base + pathname)
      assert.equal(response.status, 200)
      return response.text()
    }
    const before = tagCounts(await get('/tags/'))
    // 生成期间浏览器仍能读取旧路由，不能让它回填新一轮侧栏的旧缓存。
    let readPreviousRoute = true
    app.extend.filter.register('before_generate', async () => {
      if (readPreviousRoute) {
        readPreviousRoute = false
        await get('/tags/')
      }
    }, 30)
    const scratch = path.join(directory, 'source/_posts/navigation-live-check.md')
    const initial = {
      title: '增量校验 <文章> & 标题', description: '摘要含 <script> 与 & 字符', date: new Date('2026-05-01T00:00:00Z'),
      categories: ['项目实践'], tags: ['Kotlin', 'Flow', '增量专用标签'], topic: 'calendar', topic_order: nextOrder('calendar'), _content: '临时验收文章。\n'
    }
    fs.writeFileSync(scratch, stringify({ ...initial }, { prefixSeparator: true }))
    await eventually(async () => {
      const topics = await get('/projects/')
      assert.equal(topicCount(topics, 'calendar'), expectedTopics.calendar + 1)
      assert.match(topics, /增量校验 &lt;文章&gt; &amp; 标题/)
      assert.match(topics, /摘要含 &lt;script&gt; 与 &amp; 字符/)
      assert.deepEqual(categoryCounts(await get('/categories/')), expectedCategories.map((count, i) => count + (i === 0 ? 1 : 0)))
      const tags = await get('/tags/')
      assert.equal(tagCounts(tags).get('Kotlin'), before.get('Kotlin') + 1)
      assert.equal(tagCounts(tags).get('增量专用标签'), 1)
      assert.equal(tagCounts(tags, 'content-sidebar-tags').get('Kotlin'), before.get('Kotlin') + 1)
      assert.equal(authorPostCount(tags), published.length + 1)
      assert.equal(sidebarCategoryCounts(tags).get('项目实践'), expectedCategories[0] + 1)
    }, '新增文章未刷新')
    writeMetadata(file, original, { topic_order: nextOrder('calendar') + 1 })
    await eventually(async () => {
      const section = topicSection(await get('/projects/'), 'calendar')
      assert(section.indexOf('navigation-live-check/') < section.indexOf('calendar-01-requirements/'))
    }, '阅读顺序调整未刷新')
    fs.writeFileSync(file, original)
    await eventually(async () => {
      const section = topicSection(await get('/projects/'), 'calendar')
      assert(section.indexOf('calendar-01-requirements/') < section.indexOf('navigation-live-check/'))
    }, '阅读顺序恢复未刷新')
    fs.writeFileSync(scratch, stringify({ ...initial, categories: ['学习笔记'], tags: ['Kotlin'], topic: 'compose', topic_order: nextOrder('compose') }, { prefixSeparator: true }))
    await eventually(async () => {
      const topics = await get('/projects/')
      assert.equal(topicCount(topics, 'calendar'), expectedTopics.calendar)
      assert.equal(topicCount(topics, 'compose'), expectedTopics.compose + 1)
      assert.deepEqual(categoryCounts(await get('/categories/')), expectedCategories.map((count, i) => count + (i === 1 ? 1 : 0)))
      const html = await get('/tags/')
      const tags = tagCounts(html)
      assert.equal(tags.get('Flow'), before.get('Flow'))
      assert(!tags.has('增量专用标签'))
      assert.equal(sidebarCategoryCounts(html).get('项目实践'), expectedCategories[0])
      assert.equal(sidebarCategoryCounts(html).get('学习笔记'), expectedCategories[1] + 1)
    }, '专题和标签调整未刷新')
    fs.unlinkSync(scratch)
    await eventually(async () => {
      const topics = await get('/projects/')
      assert.equal(topicCount(topics, 'compose'), expectedTopics.compose)
      assert(!topics.includes('增量校验'))
      assert.deepEqual(categoryCounts(await get('/categories/')), expectedCategories)
      const tags = await get('/tags/')
      assert.deepEqual(tagCounts(tags), before)
      assert.equal(tagCounts(tags, 'content-sidebar-tags').get('Kotlin'), before.get('Kotlin'))
      assert.equal(occurrences(tags, 'id="content-navigation-tags"'), 1)
      assert.equal(authorPostCount(tags), published.length)
      assert.deepEqual(sidebarCategoryCounts(tags), new Map(catalog.categories.map((category, i) => [category.name, expectedCategories[i]])))
    }, '删除文章未刷新')
  })
})
