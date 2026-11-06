'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { Readable } = require('node:stream')
const { buildRedirects, renderRedirect, verifyRedirectTargets, routePath } = require('../lib/content-redirects')

function routes (entries) {
  const calls = []
  return {
    calls,
    list: () => Object.keys(entries),
    get: path => {
      calls.push(path)
      const value = entries[path]
      return value === undefined ? undefined : Readable.from(Array.isArray(value) ? value : [value])
    }
  }
}

test('配置 URL 解码后与原生归档路径匹配，原生路由不做 URL 解码', () => {
  const entries = [{ from: '/categories/Android-项目实践/', to: '/categories/%E9%A1%B9%E7%9B%AE%E5%AE%9E%E8%B7%B5/' }]
  const before = structuredClone(entries)
  const result = buildRedirects(entries)
  assert.equal(result[0].path, 'categories/Android-项目实践/index.html')
  assert.equal(result[0].targetPath, 'categories/项目实践/index.html')
  assert.equal(routePath('/'), 'index.html')
  assert.equal(routePath('/tags/%E6%9D%83%E9%99%90/'), 'tags/%E6%9D%83%E9%99%90/index.html')
  assert.equal(routePath('tags/权限/index.html'), 'tags/权限/index.html')
  assert.deepEqual(entries, before)
})

test('配置来源的中文、编码形式不能重复，也不能覆盖现有原生路由', () => {
  const source = '/tags/权限/'
  const encoded = '/tags/%E6%9D%83%E9%99%90/'
  assert.throws(() => buildRedirects([{ from: source, to: '/tags/' }, { from: encoded, to: '/projects/' }]), /来源重复/)
  assert.throws(() => buildRedirects([{ from: source, to: '/tags/' }], new Set(['tags/权限/index.html'])), /覆盖现有页面/)
  assert.throws(() => buildRedirects([{ from: encoded, to: '/tags/' }], new Set(['tags/权限/'])), /覆盖现有页面/)
})

test('原生百分号文件不影响兼容校验，也不与解码后的文件名混淆', async () => {
  const nativePaths = ['img/100%.png', 'img/literal%20.png', 'img/literal .png', 'img/%E6.png']
  for (const path of nativePaths) assert.equal(routePath(path), path)
  const redirects = buildRedirects([{ from: '/old/', to: '/projects/#calendar' }], new Set(nativePaths))
  await assert.doesNotReject(() => verifyRedirectTargets(redirects, routes({
    ...Object.fromEntries(nativePaths.map(path => [path, 'asset'])),
    'projects/index.html': '<section id="calendar"></section>'
  })))

  const encodedFilename = 'tags/%E6%9D%83%E9%99%90/index.html'
  assert.doesNotThrow(() => buildRedirects([{ from: '/tags/权限/', to: '/projects/' }], new Set([encodedFilename])))
  const target = buildRedirects([{ from: '/old/', to: '/tags/权限/' }])
  await assert.rejects(() => verifyRedirectTargets(target, routes({ [encodedFilename]: '<p>另一个文件</p>' })), /目标页面不存在/)
})

test('拒绝自环与兼容跳转链，包含编码不同但指向同一来源的情况', () => {
  assert.throws(() => buildRedirects([{ from: '/old/', to: '/old/' }]), /自身/)
  assert.throws(() => buildRedirects([{ from: '/旧/', to: '/%E6%97%A7/#heading' }]), /自身/)
  assert.throws(() => buildRedirects([{ from: '/first/', to: '/second/' }, { from: '/second/', to: '/target/' }]), /另一兼容页/)
})

for (const value of [
  'https://other.example/path/', '//other.example/', 'relative/', '/path', '/path/?query=1',
  '/parent/../target/', '/parent/%2e%2e/target/', '/./target/', '/tags//name/',
  '/tags%2fname/', '/tags%5cname/', '/tags/%252e%252e/', '/tags/%25/',
  '/bad%GG/', '/bad/%E6/', '/bad/\u0000/', '/bad/%00/', '/bad/%0a/',
  '/bad/quote"/', '/bad/%22/', '/bad/\'/', '/bad/<script>/', '/bad/space here/',
  '/bad/#', '/bad/#first#second', '/bad/#%GG', '/bad/#%0a', '/bad\\path/'
]) {
  test(`拒绝无效站内路径 ${JSON.stringify(value)}`, () => {
    assert.throws(() => buildRedirects([{ from: '/old/', to: value }]), /兼容路由/)
    assert.throws(() => buildRedirects([{ from: value, to: '/target/' }]), /兼容路由/)
  })
}

test('来源不允许锚点，配置项必须是对象', () => {
  assert.throws(() => buildRedirects([{ from: '/old/#section', to: '/target/' }]), /来源不能带锚点/)
  for (const value of [null, [], 'text']) assert.throws(() => buildRedirects([value]), /配置无效/)
  assert.throws(() => buildRedirects({}), /配置必须是数组/)
})

test('目标 URL 解码后读取原生路由，中文与实体锚点准确匹配', async () => {
  const redirects = buildRedirects([
    { from: '/old/', to: '/%E5%88%86%E7%B1%BB/#%E4%B8%AD%E6%96%87' },
    { from: '/other/', to: '/分类/#a&b' }
  ])
  const html = Buffer.from('<section id="中文"></section><section id="a&amp;b"></section>')
  const route = routes({ '分类/index.html': [html.subarray(0, 15), html.subarray(15)] })
  await assert.doesNotReject(() => verifyRedirectTargets(redirects, route))
  assert.deepEqual(route.calls, ['分类/index.html'], '同一目标只读取一次，且跨字节块读取不损坏中文')
})

test('不存在的目标页面和锚点均使验证失败', async () => {
  const redirects = buildRedirects([{ from: '/old/', to: '/target/#calendar' }])
  await assert.rejects(() => verifyRedirectTargets(redirects, routes({})), /目标页面不存在/)
  await assert.rejects(() => verifyRedirectTargets(redirects, routes({ 'target/index.html': '<h2 id="other">其他</h2>' })), /目标锚点不存在/)
})

test('data-id、注释、脚本字符串和属性值都不能伪装成真实锚点', async () => {
  const redirects = buildRedirects([{ from: '/old/', to: '/target/#calendar' }])
  for (const html of [
    '<section data-id="calendar"></section>',
    '<!-- <section id="calendar"></section> -->',
    '<script>const html = \'<section id="calendar"></section>\'</script>',
    '<div title="example id=\'calendar\'"></div>',
    '<textarea><section id="calendar"></section></textarea>'
  ]) {
    await assert.rejects(() => verifyRedirectTargets(redirects, routes({ 'target/index.html': html })), /目标锚点不存在/)
  }
})

test('目标流错误保留失败状态，不把未完成HTML当成功', async () => {
  const redirects = buildRedirects([{ from: '/old/', to: '/target/#calendar' }])
  const route = {
    list: () => ['target/index.html'],
    get: () => Readable.from((async function * () { throw new Error('页面渲染失败') })())
  }
  await assert.rejects(() => verifyRedirectTargets(redirects, route), /页面渲染失败/)
})

test('兼容HTML包含跳转、规范地址和后备链接，并正确转义属性', () => {
  const redirect = buildRedirects([{ from: '/old/', to: '/projects/#calendar' }])[0]
  const html = renderRedirect(redirect, 'https://example.test/', path => `/blog${path}`)
  assert.match(html, /content="0;url=\/blog\/projects\/#calendar"/)
  assert.match(html, /rel="canonical" href="https:\/\/example.test\/blog\/projects\/#calendar"/)
  assert.match(html, /<a href="\/blog\/projects\/#calendar">点击继续浏览<\/a>/)
  assert.match(html, /noindex,follow/)
  const escaped = renderRedirect(redirect, 'https://example.test/', () => '/path/?text="<script>&value=\'')
  assert(!escaped.includes('<script>'))
  assert(escaped.includes('&quot;&lt;script&gt;&amp;value=&#39;'))
})
