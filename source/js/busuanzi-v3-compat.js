(() => {
  // 兼容 Butterfly 旧版节点 ID，避免直接修改 node_modules 中的主题模板。
  const idAliases = [
    ['busuanzi_value_site_uv', 'busuanzi_site_uv'],
    ['busuanzi_value_site_pv', 'busuanzi_site_pv'],
    ['busuanzi_value_page_pv', 'busuanzi_page_pv']
  ]

  let mappedCount = 0
  idAliases.forEach(([legacyId, currentId]) => {
    const legacyNode = document.getElementById(legacyId)
    if (!legacyNode || document.getElementById(currentId)) return

    legacyNode.id = currentId
    mappedCount += 1
  })

  if (mappedCount > 0) {
    console.debug(`[Busuanzi] 已兼容 ${mappedCount} 个新版统计节点`)
  }
})()
