'use strict'

const nameCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'variant' })

function compareStrings (left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function compareNames (left, right) {
  return nameCollator.compare(left, right) || compareStrings(left, right)
}

function escapeHtml (value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character])
}

function fail (source, field, reason) {
  throw new Error(`${source}：${field} ${reason}`)
}

function isRecord (value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function checkText (value, source, field) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    fail(source, field, '必须是非空字符串，且不能包含首尾空格')
  }
}

function validateCatalog (catalog) {
  const source = '内容目录'
  if (!isRecord(catalog)) fail(source, 'catalog', '必须是对象')
  for (const field of ['categories', 'tags', 'topics']) {
    if (!Array.isArray(catalog[field])) fail(source, field, '必须是数组')
  }
  if (!catalog.categories.length) fail(source, 'categories', '至少登记一个分类')
  if (!catalog.tags.length) fail(source, 'tags', '至少登记一个标签')

  const categoryNames = new Set()
  catalog.categories.forEach((category, index) => {
    const field = `categories[${index}]`
    if (!isRecord(category)) fail(source, field, '必须包含名称和说明')
    checkText(category.name, source, `${field}.name`)
    checkText(category.description, source, `${field}.description`)
    if (categoryNames.has(category.name)) fail(source, field, `分类名称重复：${category.name}`)
    categoryNames.add(category.name)
  })

  const tagNames = new Set()
  catalog.tags.forEach((tag, index) => {
    checkText(tag, source, `tags[${index}]`)
    if (tagNames.has(tag)) fail(source, 'tags', `标签名称重复：${tag}`)
    tagNames.add(tag)
  })

  const topicIds = new Set()
  const topicTitles = new Set()
  catalog.topics.forEach((topic, index) => {
    const field = `topics[${index}]`
    if (!isRecord(topic)) fail(source, field, '必须包含标识、标题和说明')
    if (typeof topic.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(topic.id)) {
      fail(source, `${field}.id`, '必须是小写字母开头的字母、数字或连字符标识')
    }
    checkText(topic.title, source, `${field}.title`)
    checkText(topic.description, source, `${field}.description`)
    if (topicIds.has(topic.id)) fail(source, field, `专题标识重复：${topic.id}`)
    if (topicTitles.has(topic.title)) fail(source, field, `专题标题重复：${topic.title}`)
    topicIds.add(topic.id)
    topicTitles.add(topic.title)
  })
  return { categoryNames, tagNames, topicIds }
}

function registeredPath (paths, name, field) {
  const path = Object.prototype.hasOwnProperty.call(paths, name) ? paths[name] : undefined
  if (typeof path !== 'string' || !path) fail('内容目录', field, `找不到有效归档路径：${name}`)
  return path
}

function compareTopicPosts (left, right) {
  const leftNumbered = left.order !== undefined
  const rightNumbered = right.order !== undefined
  if (leftNumbered !== rightNumbered) return leftNumbered ? -1 : 1
  if (leftNumbered && left.order !== right.order) return left.order - right.order
  return left.date - right.date || compareStrings(left.path, right.path)
}

function buildNavigation ({ posts, catalog, categoryPaths = {}, tagPaths = {} }) {
  const { categoryNames, tagNames, topicIds } = validateCatalog(catalog)
  if (!Array.isArray(posts)) fail('内容索引', 'posts', '必须是文章数组')
  const categories = catalog.categories.map(category => ({ ...category, count: 0, path: null }))
  const topics = catalog.topics.map(topic => ({ ...topic, posts: [] }))
  const categoryByName = new Map(categories.map(category => [category.name, category]))
  const topicById = new Map(topics.map(topic => [topic.id, topic]))
  const tagCounts = new Map()
  const orders = new Map()

  for (const post of posts) {
    const source = post.source || post.path || '未知文章'
    const metadata = post.metadata
    if (!isRecord(metadata)) fail(source, 'front matter', '缺少原始文章元数据')
    if (!Array.isArray(metadata.categories) || metadata.categories.length !== 1) {
      fail(source, 'categories', '必须填写且仅填写一个主分类')
    }
    const category = metadata.categories[0]
    if (!categoryNames.has(category)) fail(source, 'categories', `未登记的分类：${String(category)}`)

    // 原始数组尚未经过文章关联去重，才能发现作者重复填写的标签。
    if (!Array.isArray(metadata.tags) || metadata.tags.length < 1 || metadata.tags.length > 4) {
      fail(source, 'tags', '必须填写 1–4 个标签')
    }
    const seenTags = new Set()
    for (const tag of metadata.tags) {
      if (!tagNames.has(tag)) fail(source, 'tags', `未登记的标签：${String(tag)}`)
      if (seenTags.has(tag)) fail(source, 'tags', `重复标签：${tag}`)
      seenTags.add(tag)
    }

    const hasTopic = metadata.topic !== undefined && metadata.topic !== null
    const hasOrder = metadata.topic_order !== undefined && metadata.topic_order !== null
    if (hasTopic && !topicIds.has(metadata.topic)) {
      fail(source, 'topic', `未登记的专题：${String(metadata.topic)}`)
    }
    if (hasOrder && !hasTopic) fail(source, 'topic_order', '填写阅读顺序前必须指定 topic')
    if (hasOrder && (!Number.isSafeInteger(metadata.topic_order) || metadata.topic_order <= 0)) {
      fail(source, 'topic_order', '必须是正整数，不能使用字符串')
    }
    if (hasOrder) {
      const key = `${metadata.topic}:${metadata.topic_order}`
      if (orders.has(key)) fail(source, 'topic_order', `与 ${orders.get(key)} 在同一专题内重复：${metadata.topic_order}`)
      orders.set(key, source)
    }
    if (typeof post.path !== 'string' || !post.path) fail(source, 'path', '缺少有效文章路径')
    if (hasTopic && !Number.isFinite(post.date)) fail(source, 'date', '专题文章必须具有有效发布日期')

    categoryByName.get(category).count++
    for (const tag of seenTags) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1)
    if (hasTopic) {
      topicById.get(metadata.topic).posts.push({
        title: post.title,
        description: post.description,
        path: post.path,
        category,
        date: post.date,
        order: hasOrder ? metadata.topic_order : undefined
      })
    }
  }

  for (const category of categories) {
    if (category.count) category.path = registeredPath(categoryPaths, category.name, 'categories.path')
  }
  const tags = [...tagCounts].map(([name, count]) => ({
    name, count, path: registeredPath(tagPaths, name, 'tags.path')
  })).sort((left, right) => compareNames(left.name, right.name))
  for (const topic of topics) topic.posts.sort(compareTopicPosts)
  const sidebarTags = [...tags]
    .sort((left, right) => right.count - left.count || compareNames(left.name, right.name))
    .slice(0, 12)
    .sort((left, right) => compareNames(left.name, right.name))

  return { categories, tags, topics, sidebarTags }
}

function tagList (tags, className, urlFor) {
  return `<ul class="${className}">${tags.map(tag =>
    `<li><a href="${escapeHtml(urlFor(tag.path))}"><span>${escapeHtml(tag.name)}</span><span class="content-count">${tag.count} 篇</span></a></li>`
  ).join('')}</ul>`
}

function renderIndex (kind, index, urlFor = path => path) {
  let content
  if (kind === 'categories') {
    content = `<div class="content-category-list">${index.categories.map(category => {
      const title = category.path
        ? `<a href="${escapeHtml(urlFor(category.path))}">${escapeHtml(category.name)}</a>`
        : escapeHtml(category.name)
      return `<section class="content-category"><h2>${title}<span class="content-count">${category.count} 篇</span></h2><p>${escapeHtml(category.description)}</p></section>`
    }).join('')}</div>`
  } else if (kind === 'tags') {
    content = index.tags.length ? tagList(index.tags, 'content-tag-list', urlFor) : '<p>暂无标签</p>'
  } else if (kind === 'topics') {
    const navigation = `<nav class="content-topic-nav" aria-label="专题导航"><ul>${index.topics.map(topic =>
      `<li><a href="${escapeHtml(urlFor(`/projects/#${topic.id}`))}">${escapeHtml(topic.title)}<span class="content-count">${topic.posts.length} 篇</span></a></li>`
    ).join('')}</ul></nav>`
    const sections = index.topics.map(topic => {
      const posts = topic.posts.length
        ? `<ol class="content-topic-posts">${topic.posts.map(post =>
          `<li><div class="content-post-heading"><a href="${escapeHtml(urlFor(post.path))}">${escapeHtml(post.title)}</a><span class="content-post-category">${escapeHtml(post.category)}</span></div><p>${escapeHtml(post.description)}</p></li>`
        ).join('')}</ol>`
        : '<p class="content-empty">暂无文章</p>'
      return `<section class="content-topic" id="${escapeHtml(topic.id)}"><h2>${escapeHtml(topic.title)}<span class="content-count">${topic.posts.length} 篇</span></h2><p class="content-topic-description">${escapeHtml(topic.description)}</p>${posts}</section>`
    }).join('')
    content = navigation + sections
  } else {
    fail('内容索引', 'kind', `未知索引类型：${kind}`)
  }
  return `<div class="content-index content-index-${kind}">${content}</div>`
}

function renderTagWidget (index, urlFor = path => path) {
  return tagList(index.sidebarTags, 'content-sidebar-tags', urlFor) +
    `<a class="content-all-tags" href="${escapeHtml(urlFor('/tags/'))}">全部标签</a>`
}

module.exports = { buildNavigation, renderIndex, renderTagWidget, compareNames, escapeHtml }
